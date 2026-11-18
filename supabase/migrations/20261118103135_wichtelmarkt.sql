-- Wichtelmarkt: schema and API
--
-- All tables live in the private schema "wm". The Data API only exposes
-- "public", so no table can be read or written from the browser. The browser
-- talks to the security-definer functions public.wm_* at the bottom, and each
-- of them returns only what the calling person is allowed to see:
--
--   * ticks on your own wishes never leave the database for you
--   * the draw happens here, and you only ever receive your own lot
--   * a donation wish is shown to its author and to whoever drew it
--
-- API functions return json: {"ok": true, ...} or {"ok": false, "error": "code"}.
-- They do not raise, because a raised error would roll back the failed-attempt
-- counter that protects the PINs.

create schema if not exists wm;
revoke all on schema wm from public, anon, authenticated;

-- ---------------------------------------------------------------- tables

create table wm.members (
  key             text primary key,
  name            text not null,
  color           text not null,
  sort            int  not null,
  is_admin        boolean not null default false,
  pin_salt        text,
  pin_hash        text,
  failed_attempts int not null default 0,
  locked_until    timestamptz
);

create table wm.sessions (
  token_hash text primary key,
  member     text not null references wm.members(key) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

create table wm.config (
  key   text primary key,
  value text not null
);

create table wm.donations (
  member     text primary key references wm.members(key) on delete cascade,
  org        text not null check (char_length(org) between 1 and 120),
  link       text not null default '' check (char_length(link) <= 500),
  note       text not null default '' check (char_length(note) <= 300),
  updated_at timestamptz not null default now()
);

-- One row per person once the draw has run: giver donates for receiver.
create table wm.assignments (
  giver    text primary key references wm.members(key) on delete cascade,
  receiver text not null unique references wm.members(key) on delete cascade,
  done     boolean not null default false,
  check (giver <> receiver)
);

create table wm.wishes (
  id         uuid primary key default gen_random_uuid(),
  owner      text not null references wm.members(key) on delete cascade,
  text       text not null check (char_length(text) between 1 and 140),
  link       text not null default '' check (char_length(link) <= 500),
  removed    boolean not null default false,
  created_at timestamptz not null default now()
);
create index wishes_owner_idx on wm.wishes(owner);

create table wm.ticks (
  wish_id    uuid primary key references wm.wishes(id) on delete cascade,
  by_member  text not null references wm.members(key) on delete cascade,
  created_at timestamptz not null default now()
);

-- Defence in depth: even if the schema were exposed one day, no policy lets
-- anon or authenticated touch a row.
alter table wm.members     enable row level security;
alter table wm.sessions    enable row level security;
alter table wm.config      enable row level security;
alter table wm.donations   enable row level security;
alter table wm.assignments enable row level security;
alter table wm.wishes      enable row level security;
alter table wm.ticks       enable row level security;

-- ---------------------------------------------------------------- the family
-- The people are data, not schema: they are not part of this repository.
-- Add them once with supabase/seed.example.sql (copy, edit, run).

-- ---------------------------------------------------------------- helpers (private)

create function wm.hash(p_salt text, p_secret text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_salt || ':' || p_secret, 'UTF8')), 'hex');
$$;

create function wm.fail(p_error text) returns json
language sql immutable set search_path = '' as $$
  select json_build_object('ok', false, 'error', p_error);
$$;

create function wm.ok() returns json
language sql immutable set search_path = '' as $$
  select json_build_object('ok', true);
$$;

-- Run once from the SQL editor: select wm.set_family_code('your-long-code');
create function wm.set_family_code(p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_salt text := gen_random_uuid()::text;
begin
  if char_length(v_code) < 8 then
    raise exception 'The family code needs at least 8 characters.';
  end if;
  insert into wm.config (key, value) values ('family_code_salt', v_salt)
    on conflict (key) do update set value = excluded.value;
  insert into wm.config (key, value) values ('family_code_hash', wm.hash(v_salt, v_code))
    on conflict (key) do update set value = excluded.value;
  return 'Family code saved.';
end $$;

-- null = no code configured yet, otherwise whether the given code matches.
create function wm.code_ok(p_code text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_salt text;
  v_hash text;
begin
  select value into v_salt from wm.config where key = 'family_code_salt';
  select value into v_hash from wm.config where key = 'family_code_hash';
  if v_salt is null or v_hash is null then return null; end if;
  return wm.hash(v_salt, lower(btrim(coalesce(p_code, '')))) = v_hash;
end $$;

-- Session token -> member key, or null.
create function wm.member_for(p_token text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_hash   text;
  v_member text;
  v_seen   timestamptz;
begin
  if p_token is null or char_length(p_token) < 32 then return null; end if;
  v_hash := wm.hash('session', p_token);
  select member, last_seen into v_member, v_seen from wm.sessions
   where token_hash = v_hash and last_seen > now() - interval '120 days';
  if v_member is null then return null; end if;
  if v_seen < now() - interval '1 day' then
    update wm.sessions set last_seen = now() where token_hash = v_hash;
  end if;
  return v_member;
end $$;

create function wm.is_admin(p_member text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select is_admin from wm.members where key = p_member), false);
$$;

-- '' stays '', a plain http(s) link is kept, anything else becomes null.
create function wm.clean_link(p_link text) returns text
language sql immutable set search_path = '' as $$
  select case
    when btrim(coalesce(p_link, '')) = '' then ''
    when char_length(btrim(p_link)) <= 500 and btrim(p_link) ~* '^https?://[^[:space:]]+$' then btrim(p_link)
    else null
  end;
$$;

-- Counts a wrong PIN. Five in a row lock the name for 15 minutes.
create function wm.count_failure(p_member text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  update wm.members set failed_attempts = failed_attempts + 1
   where key = p_member returning failed_attempts into v_n;
  if v_n >= 5 then
    update wm.members set failed_attempts = 0, locked_until = now() + interval '15 minutes'
     where key = p_member;
    return json_build_object('ok', false, 'error', 'locked', 'seconds', 900);
  end if;
  return json_build_object('ok', false, 'error', 'pin_wrong', 'attemptsLeft', 5 - v_n);
end $$;

-- ---------------------------------------------------------------- API: getting in

-- The names on the gate. Needs the family code, so a stranger learns nothing.
create function public.wm_roster(p_family_code text) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ok boolean := wm.code_ok(p_family_code);
begin
  if v_ok is null then return wm.fail('not_set_up'); end if;
  if btrim(coalesce(p_family_code, '')) = '' then return wm.fail('family_code_needed'); end if;
  if not v_ok then return wm.fail('family_code_wrong'); end if;
  return json_build_object('ok', true, 'members', (
    select coalesce(json_agg(json_build_object(
      'key', m.key, 'name', m.name, 'color', m.color, 'isAdmin', m.is_admin,
      'hasPin', m.pin_hash is not null
    ) order by m.sort), '[]'::json)
    from wm.members m));
end $$;

-- First visit sets the PIN, later visits check it. Returns a session token.
create function public.wm_login(p_member text, p_pin text, p_family_code text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  m       wm.members%rowtype;
  v_ok    boolean := wm.code_ok(p_family_code);
  v_token text;
begin
  if v_ok is null then return wm.fail('not_set_up'); end if;
  if btrim(coalesce(p_family_code, '')) = '' then return wm.fail('family_code_needed'); end if;
  if not v_ok then return wm.fail('family_code_wrong'); end if;

  select * into m from wm.members where key = p_member for update;
  if not found then return wm.fail('member_unknown'); end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then return wm.fail('pin_format'); end if;
  if m.locked_until is not null and m.locked_until > now() then
    return json_build_object('ok', false, 'error', 'locked',
      'seconds', ceil(extract(epoch from m.locked_until - now()))::int);
  end if;

  if m.pin_hash is null then
    m.pin_salt := gen_random_uuid()::text;
    update wm.members
       set pin_salt = m.pin_salt, pin_hash = wm.hash(m.pin_salt, p_pin),
           failed_attempts = 0, locked_until = null
     where key = m.key;
  elsif wm.hash(m.pin_salt, p_pin) <> m.pin_hash then
    return wm.count_failure(m.key);
  else
    update wm.members set failed_attempts = 0, locked_until = null where key = m.key;
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into wm.sessions (token_hash, member) values (wm.hash('session', v_token), m.key);
  delete from wm.sessions where last_seen < now() - interval '120 days';
  return json_build_object('ok', true, 'token', v_token, 'member', m.key);
end $$;

create function public.wm_logout(p_token text) returns json
language plpgsql security definer set search_path = '' as $$
begin
  if p_token is not null then
    delete from wm.sessions where token_hash = wm.hash('session', p_token);
  end if;
  return wm.ok();
end $$;

-- ---------------------------------------------------------------- API: what I may see

create function public.wm_state(p_token text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_me text := wm.member_for(p_token);
begin
  if v_me is null then return wm.fail('session'); end if;
  return json_build_object(
    'ok', true,
    'me', (select json_build_object('key', m.key, 'name', m.name, 'color', m.color, 'isAdmin', m.is_admin)
             from wm.members m where m.key = v_me),
    'members', (select json_agg(json_build_object(
                  'key', m.key, 'name', m.name, 'color', m.color, 'isAdmin', m.is_admin,
                  'hasPin', m.pin_hash is not null,
                  'hasDonation', exists (select 1 from wm.donations d where d.member = m.key),
                  'donated', coalesce((select a.done from wm.assignments a where a.giver = m.key), false)
                ) order by m.sort)
                from wm.members m),
    'myDonation', (select json_build_object('org', d.org, 'link', d.link, 'note', d.note)
                     from wm.donations d where d.member = v_me),
    'drawn', exists (select 1 from wm.assignments),
    -- only my own row of the draw, joined with the wish of the person I drew
    'myLot', (select json_build_object('receiver', a.receiver, 'org', coalesce(d.org, ''),
                       'link', coalesce(d.link, ''), 'note', coalesce(d.note, ''), 'done', a.done)
                from wm.assignments a
                left join wm.donations d on d.member = a.receiver
               where a.giver = v_me),
    -- my own wishes come without any tick information; a withdrawn wish stays
    -- visible to the others only while somebody has it ticked
    'wishes', (select coalesce(json_agg(json_build_object(
                  'id', w.id, 'owner', w.owner, 'text', w.text, 'link', w.link, 'removed', w.removed,
                  'tickBy', case when w.owner = v_me then null else t.by_member end
                ) order by w.created_at, w.id), '[]'::json)
                from wm.wishes w
                left join wm.ticks t on t.wish_id = w.id
               where (w.owner = v_me and not w.removed)
                  or (w.owner <> v_me and (not w.removed or t.wish_id is not null)))
  );
end $$;

-- ---------------------------------------------------------------- API: donations and the draw

create function public.wm_save_donation(p_token text, p_org text, p_link text, p_note text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_me   text := wm.member_for(p_token);
  v_org  text := btrim(coalesce(p_org, ''));
  v_note text := btrim(coalesce(p_note, ''));
  v_link text := wm.clean_link(p_link);
begin
  if v_me is null then return wm.fail('session'); end if;
  if exists (select 1 from wm.assignments) then return wm.fail('already_drawn'); end if;
  if v_org = '' or char_length(v_org) > 120 then return wm.fail('org_invalid'); end if;
  if v_link is null then return wm.fail('link_invalid'); end if;
  if char_length(v_note) > 300 then return wm.fail('note_invalid'); end if;
  insert into wm.donations (member, org, link, note) values (v_me, v_org, v_link, v_note)
    on conflict (member) do update
      set org = excluded.org, link = excluded.link, note = excluded.note, updated_at = now();
  return wm.ok();
end $$;

-- Draws for everybody at once. Nobody gets their own name.
create function public.wm_draw(p_token text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_me   text := wm.member_for(p_token);
  v_keys text[];
  v_perm text[];
  v_good boolean;
begin
  if v_me is null then return wm.fail('session'); end if;
  lock table wm.assignments in exclusive mode;
  if exists (select 1 from wm.assignments) then return wm.fail('already_drawn'); end if;
  if exists (select 1 from wm.members m
              where not exists (select 1 from wm.donations d where d.member = m.key)) then
    return wm.fail('donations_missing');
  end if;
  select array_agg(m.key order by m.sort) into v_keys from wm.members m;
  if coalesce(array_length(v_keys, 1), 0) < 2 then return wm.fail('too_few'); end if;
  loop
    select array_agg(k order by gen_random_uuid()) into v_perm from unnest(v_keys) as k;
    select bool_and(v_keys[s] <> v_perm[s]) into v_good from generate_subscripts(v_keys, 1) as s;
    exit when v_good;
  end loop;
  insert into wm.assignments (giver, receiver)
    select v_keys[s], v_perm[s] from generate_subscripts(v_keys, 1) as s;
  return wm.ok();
end $$;

create function public.wm_set_done(p_token text, p_done boolean) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_me text := wm.member_for(p_token);
begin
  if v_me is null then return wm.fail('session'); end if;
  update wm.assignments set done = coalesce(p_done, false) where giver = v_me;
  if not found then return wm.fail('not_drawn'); end if;
  return wm.ok();
end $$;

-- ---------------------------------------------------------------- API: wish lists

create function public.wm_add_wish(p_token text, p_text text, p_link text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_me   text := wm.member_for(p_token);
  v_text text := btrim(coalesce(p_text, ''));
  v_link text := wm.clean_link(p_link);
  v_id   uuid;
begin
  if v_me is null then return wm.fail('session'); end if;
  if v_text = '' or char_length(v_text) > 140 then return wm.fail('text_invalid'); end if;
  if v_link is null then return wm.fail('link_invalid'); end if;
  if (select count(*) from wm.wishes where owner = v_me and not removed) >= 40 then
    return wm.fail('too_many');
  end if;
  insert into wm.wishes (owner, text, link) values (v_me, v_text, v_link) returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end $$;

-- Withdrawing keeps the row, so whoever ticked it still learns about it.
create function public.wm_remove_wish(p_token text, p_wish uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_me text := wm.member_for(p_token);
begin
  if v_me is null then return wm.fail('session'); end if;
  update wm.wishes set removed = true where id = p_wish and owner = v_me;
  return wm.ok();
end $$;

create function public.wm_tick(p_token text, p_wish uuid, p_on boolean) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_me      text := wm.member_for(p_token);
  v_owner   text;
  v_removed boolean;
  v_by      text;
begin
  if v_me is null then return wm.fail('session'); end if;
  select owner, removed into v_owner, v_removed from wm.wishes where id = p_wish;
  if not found then return wm.fail('wish_unknown'); end if;
  if v_owner = v_me then return wm.fail('own_wish'); end if;
  if coalesce(p_on, false) then
    if v_removed then return wm.fail('wish_removed'); end if;
    insert into wm.ticks (wish_id, by_member) values (p_wish, v_me) on conflict (wish_id) do nothing;
    select by_member into v_by from wm.ticks where wish_id = p_wish;
    if v_by <> v_me then
      return json_build_object('ok', false, 'error', 'taken', 'by', v_by);
    end if;
  else
    delete from wm.ticks where wish_id = p_wish and by_member = v_me;
  end if;
  return wm.ok();
end $$;

-- ---------------------------------------------------------------- API: admin tools
-- The admin can reset things, but gets no extra view into anyone's secrets.

create function public.wm_admin_reset_pin(p_token text, p_member text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_me text := wm.member_for(p_token);
begin
  if v_me is null then return wm.fail('session'); end if;
  if not wm.is_admin(v_me) then return wm.fail('not_admin'); end if;
  update wm.members
     set pin_salt = null, pin_hash = null, failed_attempts = 0, locked_until = null
   where key = p_member;
  if not found then return wm.fail('member_unknown'); end if;
  delete from wm.sessions where member = p_member;
  return wm.ok();
end $$;

create function public.wm_admin_reset_draw(p_token text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_me text := wm.member_for(p_token);
begin
  if v_me is null then return wm.fail('session'); end if;
  if not wm.is_admin(v_me) then return wm.fail('not_admin'); end if;
  delete from wm.assignments where true;
  return wm.ok();
end $$;

-- Clears donations, the draw, wishes and ticks. PINs and sessions stay.
create function public.wm_admin_wipe(p_token text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_me text := wm.member_for(p_token);
begin
  if v_me is null then return wm.fail('session'); end if;
  if not wm.is_admin(v_me) then return wm.fail('not_admin'); end if;
  delete from wm.ticks where true;
  delete from wm.wishes where true;
  delete from wm.assignments where true;
  delete from wm.donations where true;
  return wm.ok();
end $$;

-- ---------------------------------------------------------------- grants

revoke all on all tables in schema wm from public, anon, authenticated;
revoke execute on all functions in schema wm from public, anon, authenticated;

revoke execute on function
  public.wm_roster(text), public.wm_login(text, text, text), public.wm_logout(text),
  public.wm_state(text), public.wm_save_donation(text, text, text, text), public.wm_draw(text),
  public.wm_set_done(text, boolean), public.wm_add_wish(text, text, text),
  public.wm_remove_wish(text, uuid), public.wm_tick(text, uuid, boolean),
  public.wm_admin_reset_pin(text, text), public.wm_admin_reset_draw(text), public.wm_admin_wipe(text)
from public;

grant execute on function
  public.wm_roster(text), public.wm_login(text, text, text), public.wm_logout(text),
  public.wm_state(text), public.wm_save_donation(text, text, text, text), public.wm_draw(text),
  public.wm_set_done(text, boolean), public.wm_add_wish(text, text, text),
  public.wm_remove_wish(text, uuid), public.wm_tick(text, uuid, boolean),
  public.wm_admin_reset_pin(text, text), public.wm_admin_reset_draw(text), public.wm_admin_wipe(text)
to anon, authenticated;

notify pgrst, 'reload schema';
