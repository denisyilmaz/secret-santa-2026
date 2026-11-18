# Wichtelmarkt

A small family app for Christmas: a donation Secret Santa ("Spendenwichteln") and
wish lists where the others can tick things off without the owner ever knowing.

- **Frontend:** Angular 22, standalone components, signals, zoneless. UI text is German.
- **Backend:** Supabase (Postgres). One SQL migration, no Edge Functions, no Supabase Auth.
- **Hosting:** GitHub Pages, built and published by GitHub Actions on every push to `main`.
- **Demo mode:** with no Supabase project configured, the app runs on sample data that
  stays in the browser. Good for looking at the design and for local work.

## What is public here, and what is not

This repository can be public. It holds nothing that has to stay secret:

| In the repository | Why that is fine |
| --- | --- |
| Supabase project URL and publishable key | They ship in every browser anyway. They only allow calling the `wm_*` functions. |
| The whole schema and all functions | The rules do not depend on being hidden. |
| The deploy workflow | It uses no secrets. |

| Never in the repository | Where it lives instead |
| --- | --- |
| The family code | Only in the database (hashed) and in the invite link you send. |
| The real names | Only in the database. `supabase/seed.example.sql` shows the shape. |
| Supabase secret key, database password | Nowhere near this project. The app does not need them. |

`.gitignore` already blocks `supabase/seed.sql` and any `*setup*.sql`.

What a public repository and a public page do change: anybody can find the app
and the API. Everything then rests on the family code, and behind it on the PINs.
So keep the code long, send the invite link privately, and replace the code
(`select wm.set_family_code('...')`) if it ever leaks.

## How the secrets are kept

The browser never touches a table. All tables live in a private schema (`wm`) that
the Data API does not expose. The app calls thirteen `security definer` functions
(`public.wm_*`), and each one returns only what the calling person may see:

| Secret | How it is enforced |
| --- | --- |
| Whether my own wish was ticked | `wm_state` leaves out all tick data for wishes I own. |
| Who drew whom | `wm_draw` shuffles inside Postgres. `wm_state` returns only my own row. |
| Other people's donation wishes | Returned to the author and to whoever drew that person. |
| Who may enter at all | Every call needs the family code or a session token. |

People sign in with their name and a four-digit PIN they choose on first visit.
Five wrong PINs lock that name for 15 minutes. The family code keeps strangers
from even seeing the names. The admin can reset PINs, the draw, and all entries,
but gets no extra view into anyone's lot or ticks.

Limits worth knowing:

- Whoever can open the Supabase dashboard can read every table. That is the
  project owner, by design.
- A four-digit PIN is a curtain, not a vault. The family code is the real gate.
  Wrong family codes are not rate-limited by the app, so length is what protects it.
- The page asks the server for news every 15 seconds instead of using Realtime.
  That is deliberate: Realtime delete events are not filtered per row, so a
  removed tick would tell the wish owner that a tick had existed.
- The Supabase advisor reports the `wm_*` functions as "callable without signing
  in". That is the design: they are the only door, and each one checks the family
  code or the session.

## Run it locally

```bash
npm install
npm start          # http://localhost:4200
```

With `supabaseUrl` set in `src/environments/environment.ts` the app talks to that
project. Empty the value to get the demo with sample data.

## Set up a Supabase project

1. **Create a project** in the Supabase dashboard.
2. **Run the migration.** Paste `supabase/migrations/20261118103135_wichtelmarkt.sql`
   into the SQL editor and run it once. Or with the CLI: `supabase init`,
   `supabase link --project-ref <ref>`, `supabase db push`.
3. **Add the people and the family code.** Copy `supabase/seed.example.sql` to
   `supabase/seed.sql`, put in the real names, uncomment the last line with a long
   family code, and run it in the SQL editor. `seed.sql` is ignored by git.
4. **Point the app at the project.** Put the project URL and the publishable key
   (`sb_publishable_...`, under Settings > API Keys) into
   `src/environments/environment.ts`.

The migration grants `execute` on the API functions to `anon` and `authenticated`
explicitly. Supabase projects created since 30 May 2026 no longer expose new
objects in `public` on their own, so those grants are required.

## Deploy with GitHub Actions

`.github/workflows/deploy.yml` runs the SQL test, builds the app, and publishes
`dist/wichtelmarkt-app/browser` to GitHub Pages. One-time setup in the repository:

1. Settings > Pages > Build and deployment > Source: **GitHub Actions**.
2. Push to `main`, or run the workflow by hand from the Actions tab.

The page then lives at `https://<user>.github.io/<repository>/`. The build uses a
relative base path, so it works in that subfolder and on a custom domain alike.

**Invite the family** with a link that carries the code after the `#`:
`https://<user>.github.io/<repository>/#familie=<family code>`.
The app stores the code on the device and removes it from the address bar.
Without the link, people can type the code once.

## Tests

```bash
npm run test:sql
```

Runs the migration in an in-process Postgres (PGlite) and checks 91 rules as the
`anon` role: closed tables, family code, PIN lockout, the draw (nobody draws
themselves, all 44 outcomes occur), hidden ticks, withdrawn wishes, admin limits.
The workflow runs it before every deploy.

## Where things are

```
.github/workflows/     deploy.yml: test, build, publish to GitHub Pages
supabase/migrations/   schema, functions, grants
supabase/seed.example.sql   the people and the family code, as a template
supabase/tests/        run.mjs, the SQL test
src/app/core/          types, Store (signals + polling), SupabaseApi, DemoApi, Motion
src/app/gate/          family code, name picker, PIN
src/app/spenden/       donation wish, lottery drum, lot, light chain
src/app/buden/         the wish-list booths
src/app/admin/         reset tools
src/app/fx/            canvas backdrop (drifting shapes, snow), confetti
src/app/ui/            dialogs, toasts
src/styles.css         tokens (60s Christmas look), buttons, forms, shared keyframes
```

## Motion

Everything that moves respects one switch: `Motion` (in `core/motion.ts`) reads the
system "reduce motion" setting, can be flipped in the footer, and sets
`html[data-motion]`. CSS animations stop, the canvas paints one still frame, and
confetti stays in the box.
