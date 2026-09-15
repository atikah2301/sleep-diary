-- Run this once in your Supabase project's SQL editor (Database > SQL Editor).
-- See README.md "Setup" for the full one-time setup checklist this fits into.

create type sleep_tag as enum ('Office', 'WFH', 'No alarm');

create table diary_entries (
  id bigint generated always as identity primary key,
  entry_date date not null unique,           -- bedtime date (see README/plan for convention)
  bed_time time not null,                     -- got into bed
  sleep_time time not null,                   -- fell asleep
  awakenings_count integer not null default 0,
  awake_minutes integer not null default 0,   -- total minutes awake during those awakenings
  wake_time time not null,                    -- final wake time
  rising_time time not null,                  -- got out of bed
  tag sleep_tag,                              -- null = generic alarm-clock wake, no particular reason
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger diary_entries_set_updated_at
before update on diary_entries
for each row execute function set_updated_at();

-- Row Level Security: this is what actually enforces the passcode. Any request that
-- doesn't come from our one signed-in Supabase Auth user is rejected, regardless of
-- what the (public) frontend code does or doesn't check client-side.
alter table diary_entries enable row level security;

create policy "authenticated users can read diary_entries"
  on diary_entries for select
  using (auth.uid() is not null);

create policy "authenticated users can insert diary_entries"
  on diary_entries for insert
  with check (auth.uid() is not null);

create policy "authenticated users can update diary_entries"
  on diary_entries for update
  using (auth.uid() is not null);

create policy "authenticated users can delete diary_entries"
  on diary_entries for delete
  using (auth.uid() is not null);
