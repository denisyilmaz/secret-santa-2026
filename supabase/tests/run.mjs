// Runs the migration in an in-process Postgres (PGlite) and checks the rules
// that matter: who may see what. Usage: npm run test:sql
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, '..', 'migrations');
const db = new PGlite();
let passed = 0;
const failed = [];
const check = (name, cond, detail) => {
  if (cond) passed++;
  else failed.push(name + (detail === undefined ? '' : ' -> ' + JSON.stringify(detail)));
};

// Supabase ships these roles; a bare Postgres does not.
await db.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin;');
for (const f of readdirSync(migrations).sort()) await db.exec(readFileSync(join(migrations, f), 'utf8'));
// The people are not part of the migration: seed five for the test.
await db.exec(`insert into wm.members (key, name, color, sort, is_admin) values
  ('anna', 'Anna', 'pink', 1, false), ('ben', 'Ben', 'yellow', 2, false), ('clara', 'Clara', 'green', 3, false),
  ('dora', 'Dora', 'red', 4, false), ('emil', 'Emil', 'teal', 5, true);`);

// Call an API function the way the browser does: as role anon.
const api = async (fn, ...args) => {
  await db.exec('set role anon');
  try {
    const r = await db.query(`select public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(', ')}) as r`, args);
    return r.rows[0].r;
  } finally {
    await db.exec('reset role');
  }
};
const asAnon = async (sql) => {
  await db.exec('set role anon');
  try { await db.query(sql); return 'allowed'; } catch (e) { return 'denied'; } finally { await db.exec('reset role'); }
};

const CODE = 'Tannenbaum-2026';
const people = ['anna', 'ben', 'clara', 'dora', 'emil'];

// --- nothing works before setup, tables are closed
check('roster before setup', (await api('wm_roster', CODE)).error === 'not_set_up');
await db.query('select wm.set_family_code($1)', [CODE]);
for (const t of ['members', 'sessions', 'config', 'donations', 'assignments', 'wishes', 'ticks']) {
  check(`anon cannot read wm.${t}`, (await asAnon(`select * from wm.${t}`)) === 'denied');
}
check('anon cannot set family code', (await asAnon(`select wm.set_family_code('hackhackhack')`)) === 'denied');
check('anon cannot call wm.member_for', (await asAnon(`select wm.member_for('x')`)) === 'denied');

// --- family code
check('roster needs code', (await api('wm_roster', '')).error === 'family_code_needed');
check('roster rejects wrong code', (await api('wm_roster', 'falsch-falsch')).error === 'family_code_wrong');
const roster = await api('wm_roster', '  tannenbaum-2026 ');
check('roster with code', roster.ok && roster.members.map((m) => m.key).join() === people.join(), roster);
check('roster: no PINs yet', roster.members.every((m) => m.hasPin === false));

// --- login
check('login rejects wrong code', (await api('wm_login', 'emil', '1234', 'nope-nope')).error === 'family_code_wrong');
check('login rejects bad pin format', (await api('wm_login', 'emil', '12a4', CODE)).error === 'pin_format');
check('login rejects unknown member', (await api('wm_login', 'grinch', '1234', CODE)).error === 'member_unknown');
const tok = {};
for (const [i, p] of people.entries()) {
  const r = await api('wm_login', p, '100' + i, CODE);
  check(`first login sets PIN: ${p}`, r.ok && r.token.length === 64, r);
  tok[p] = r.token;
}
const wrong = await api('wm_login', 'dora', '9999', CODE);
check('wrong PIN counted', wrong.error === 'pin_wrong' && wrong.attemptsLeft === 4, wrong);
for (let i = 0; i < 3; i++) await api('wm_login', 'dora', '9999', CODE);
check('fifth wrong PIN locks', (await api('wm_login', 'dora', '9999', CODE)).error === 'locked');
check('locked even with right PIN', (await api('wm_login', 'dora', '1003', CODE)).error === 'locked');
await db.exec(`update wm.members set locked_until = null where key = 'dora'`);
const again = await api('wm_login', 'dora', '1003', CODE);
check('right PIN works after lock ends', again.ok === true, again);
check('state rejects junk token', (await api('wm_state', 'x'.repeat(64))).error === 'session');

// --- donations
check('draw refused while wishes are missing', (await api('wm_draw', tok.emil)).error === 'donations_missing');
check('bad link refused', (await api('wm_save_donation', tok.emil, 'Org', 'javascript:alert(1)', '')).error === 'link_invalid');
check('empty org refused', (await api('wm_save_donation', tok.emil, '  ', '', '')).error === 'org_invalid');
for (const p of people) {
  const r = await api('wm_save_donation', tok[p], 'Org von ' + p, 'https://example.org/' + p, 'Notiz ' + p);
  check(`donation saved: ${p}`, r.ok === true, r);
}
let s = await api('wm_state', tok.clara);
check('before draw: I see my own donation', s.myDonation.org === 'Org von clara');
check('before draw: no lot, not drawn', s.myLot === null && s.drawn === false);
check('before draw: other donations are not in my state', !JSON.stringify(s).includes('Org von emil'));
check('members flagged hasDonation', s.members.every((m) => m.hasDonation));

// --- draw
check('draw works', (await api('wm_draw', tok.anna)).ok === true);
check('second draw refused', (await api('wm_draw', tok.emil)).error === 'already_drawn');
check('donation locked after draw', (await api('wm_save_donation', tok.emil, 'Neu', '', '')).error === 'already_drawn');
const receivers = [];
for (const p of people) {
  s = await api('wm_state', tok[p]);
  receivers.push(s.myLot.receiver);
  check(`${p} did not draw self`, s.myLot.receiver !== p);
  check(`${p} sees the wish of the person drawn`, s.myLot.org === 'Org von ' + s.myLot.receiver);
  const others = people.filter((q) => q !== p && q !== s.myLot.receiver);
  check(`${p} sees no third-party donation`, others.every((q) => !JSON.stringify(s).includes('Org von ' + q)));
}
check('everybody is drawn exactly once', [...receivers].sort().join() === [...people].sort().join(), receivers);
check('set done', (await api('wm_set_done', tok.ben, true)).ok === true);
s = await api('wm_state', tok.emil);
check('done shows on the light chain', s.members.find((m) => m.key === 'ben').donated === true
  && s.members.filter((m) => m.donated).length === 1);

// --- wishes and secret ticks
const w1 = (await api('wm_add_wish', tok.emil, 'Kuechenmesser', '')).id;
const w2 = (await api('wm_add_wish', tok.emil, 'Wollsocken', 'https://example.org/socken')).id;
const w3 = (await api('wm_add_wish', tok.emil, 'Kopfhoerer', '')).id;
const w4 = (await api('wm_add_wish', tok.clara, 'Roman', '')).id;
check('wish link validated', (await api('wm_add_wish', tok.clara, 'x', 'ftp://nope')).error === 'link_invalid');
check('owner cannot tick own wish', (await api('wm_tick', tok.emil, w1, true)).error === 'own_wish');
check('clara ticks w1', (await api('wm_tick', tok.clara, w1, true)).ok === true);
const taken = await api('wm_tick', tok.dora, w1, true);
check('second tick is refused, names the first', taken.error === 'taken' && taken.by === 'clara', taken);
check('dora cannot untick clara\'s tick', (await api('wm_tick', tok.dora, w1, false)).ok === true
  && (await api('wm_state', tok.dora)).wishes.find((w) => w.id === w1).tickBy === 'clara');

s = await api('wm_state', tok.emil);
const mine = s.wishes.filter((w) => w.owner === 'emil');
check('owner sees own wishes', mine.length === 3);
check('owner gets no tick info on own wishes', mine.every((w) => w.tickBy === null), mine);
check('owner state never mentions the ticker for own wish',
  !JSON.stringify(mine).includes('clara'));
s = await api('wm_state', tok.dora);
check('others see who ticked', s.wishes.find((w) => w.id === w1).tickBy === 'clara');
check('others see unticked as null', s.wishes.find((w) => w.id === w2).tickBy === null);

// withdrawing: a ticked wish stays visible to others, an unticked one vanishes
await api('wm_remove_wish', tok.emil, w1);
await api('wm_remove_wish', tok.emil, w3);
check('nobody else can withdraw my wish', (await api('wm_remove_wish', tok.dora, w2)).ok === true
  && (await api('wm_state', tok.emil)).wishes.some((w) => w.id === w2));
s = await api('wm_state', tok.emil);
check('owner no longer sees withdrawn wishes', !s.wishes.some((w) => w.id === w1 || w.id === w3));
s = await api('wm_state', tok.clara);
check('ticker still sees withdrawn ticked wish', s.wishes.find((w) => w.id === w1)?.removed === true);
check('withdrawn unticked wish is gone for others', !s.wishes.some((w) => w.id === w3));
check('cannot tick a withdrawn wish', (await api('wm_tick', tok.dora, w3, true)).error === 'wish_removed');
check('untick own tick', (await api('wm_tick', tok.clara, w1, false)).ok === true);
check('emil ticks clara\'s wish', (await api('wm_tick', tok.emil, w4, true)).ok === true);
s = await api('wm_state', tok.clara);
check('clara cannot see the tick on her wish', s.wishes.find((w) => w.id === w4).tickBy === null);

// --- admin
check('non-admin cannot reset draw', (await api('wm_admin_reset_draw', tok.clara)).error === 'not_admin');
check('non-admin cannot reset PIN', (await api('wm_admin_reset_pin', tok.clara, 'emil')).error === 'not_admin');
check('non-admin cannot wipe', (await api('wm_admin_wipe', tok.clara)).error === 'not_admin');
check('admin state has no extra secrets', (() => {
  const keys = Object.keys(s).sort().join();
  return keys === 'drawn,me,members,myDonation,myLot,ok,wishes';
})());
check('admin resets a PIN', (await api('wm_admin_reset_pin', tok.emil, 'dora')).ok === true);
check('reset PIN ends that person\'s sessions', (await api('wm_state', tok.dora)).error === 'session');
check('roster shows PIN is gone', (await api('wm_roster', CODE)).members.find((m) => m.key === 'dora').hasPin === false);

// --- the draw is fair: 5 people have 44 valid outcomes, none with a fixed point
const seen = new Map();
let selfDraws = 0;
for (let i = 0; i < 400; i++) {
  await api('wm_admin_reset_draw', tok.emil);
  await api('wm_draw', tok.emil);
  const rows = (await db.query('select giver, receiver from wm.assignments order by giver')).rows;
  if (rows.some((r) => r.giver === r.receiver) || new Set(rows.map((r) => r.receiver)).size !== 5) selfDraws++;
  const k = rows.map((r) => r.receiver).join();
  seen.set(k, (seen.get(k) || 0) + 1);
}
check('400 draws: never a self-draw, always a full permutation', selfDraws === 0);
check('400 draws: many different outcomes, at most 44', seen.size > 30 && seen.size <= 44, seen.size);

check('admin wipes', (await api('wm_admin_wipe', tok.emil)).ok === true);
s = await api('wm_state', tok.emil);
check('wipe clears wishes, donations and draw', s.wishes.length === 0 && s.myDonation === null && !s.drawn);
check('wipe keeps PINs', s.members.filter((m) => m.hasPin).length === 4);
check('logout ends the session', (await api('wm_logout', tok.clara)).ok && (await api('wm_state', tok.clara)).error === 'session');

console.log(`${passed} checks passed, ${failed.length} failed` + (seen.size ? ` (distinct draw outcomes: ${seen.size})` : ''));
if (failed.length) { console.log(failed.map((f) => '  FAILED: ' + f).join('\n')); process.exit(1); }
