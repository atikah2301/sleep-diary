# sleep-diary
Sleep tracker for CBT-I

Record daily sleep data and calculate sleep efficiency

## Database changes

Schema changes live as ordered SQL files under `supabase/migrations/`, named
`<timestamp>_<description>.sql` so the filename order matches the order
they were written and run. There's no migration tool tracking what's
applied — this is a solo project, so the discipline is: add a new file,
run it by hand in the Supabase SQL Editor (Database > SQL Editor), done.

To make a change:
1. Create `supabase/migrations/<timestamp>_<description>.sql` (e.g. via
   `date +%Y%m%d%H%M%S` for the timestamp prefix).
2. Write the SQL — `create table ...` plus RLS policies, following the
   pattern in the existing migration files.
3. Run it in the Supabase SQL Editor against the live project.
