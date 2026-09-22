create table if not exists user_goals (
  id bigint primary key default 1,
  duration_goal_minutes integer not null default 480,
  efficiency_goal_pct numeric not null default 95,
  min_wake_time time not null default '07:00',
  max_wake_time time not null default '08:00',
  updated_at timestamptz not null default now(),
  constraint user_goals_singleton check (id = 1)
);

insert into user_goals (id) values (1)
on conflict (id) do nothing;

-- No insert/delete policy: the one row is seeded above and never removed.
drop trigger if exists user_goals_set_updated_at on user_goals;
create trigger user_goals_set_updated_at
before update on user_goals
for each row execute function set_updated_at();

alter table user_goals enable row level security;

drop policy if exists "authenticated users can read user_goals" on user_goals;
create policy "authenticated users can read user_goals"
  on user_goals for select
  using (auth.uid() is not null);

drop policy if exists "authenticated users can update user_goals" on user_goals;
create policy "authenticated users can update user_goals"
  on user_goals for update
  using (auth.uid() is not null);
