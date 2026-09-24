# sleep-diary

Sleep tracker for CBT-I — a small installable PWA that replaces a paper sleep diary. Log each
night's data in under a minute; it computes time-in-bed, total sleep time, and sleep efficiency
for you, and shows trends over time. Only two people ever use it (you and your sleep therapist),
sharing one passcode.

No build step — plain HTML/CSS/JS, hosted free on GitHub Pages, with Supabase providing the
database, API, and passcode auth (via Row Level Security).

## One-time setup

### 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com), create a free account/project.
2. In the SQL editor, run each file in `supabase/migrations/`, in filename order. Together they
   create the `diary_entries` and `therapy_notes` tables, the `sleep_tag` enum, and Row Level
   Security policies that only allow access to authenticated users.
3. Under **Authentication → Sign In / Providers**, disable public sign-ups (so the login page
   can't be used to create new accounts — the RLS policy trusts that only the one user you create
   below can ever log in).
4. Under **Authentication → Users**, manually create the single shared user:
   - Email: any placeholder value, e.g. `sleep-diary@example.invalid`
   - Password: the passcode you'll share with your therapist
5. Under **Project Settings → API**, copy the **Project URL** and the **anon public** key.

### 2. Configure the app

Edit `js/config.js` with your project's URL, anon key, and shared login email (from step 1):

```js
export const SUPABASE_URL = "<your project URL>";
export const SUPABASE_ANON_KEY = "<your anon public key>";
export const SHARED_LOGIN_EMAIL = "<the placeholder email from step 1>";
```

The anon key is safe to commit — it only grants what the RLS policies allow, which is
"authenticated users only," and sign-ups are disabled.

### 3. Deploy to GitHub Pages

1. Push this repo to GitHub (already done if you're reading this from the repo).
2. In the repo's **Settings → Pages**, set **Source** to "GitHub Actions."
3. Push to `master` — `.github/workflows/deploy.yml` builds and publishes automatically. Every
   deploy stamps `sw.js`'s cache name with the commit SHA, so the service worker always picks up
   the latest files (no more manually bumping a version string).
4. Wait a minute, then open the URL GitHub gives you. Install it as an app from your phone's
   "Add to Home Screen" (Safari) or desktop browser's install prompt (Chrome/Edge).

## Local development

Serve the folder with any static file server, e.g.:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`. No build step, no dependencies to install.

## Data model

See `supabase/migrations/`. All derived figures (time in bed, total sleep time, sleep efficiency
%) are computed on the fly in `js/metrics.js` and never stored — the database only holds what you
actually entered.

## Database changes

Schema changes live as ordered SQL files under `supabase/migrations/`, named
`<timestamp>_<description>.sql` so the filename order matches the order they were written and
run. There's no migration tool tracking what's applied — this is a solo project, so the
discipline is: add a new file, run it by hand in the Supabase SQL Editor, done.

To make a change:
1. Create `supabase/migrations/<timestamp>_<description>.sql` (e.g. via `date +%Y%m%d%H%M%S`
   for the timestamp prefix).
2. Write the SQL — `create table ...` plus RLS policies, following the pattern in the existing
   migration files.
3. Run it in the Supabase SQL Editor against the live project.

Never edit a migration file once it's been run — even a small follow-up (like adding a column)
gets its own new timestamped file. Editing an already-applied file makes the repo's history
disagree with what was actually run against the live database.
