create table therapy_notes (
  id bigint generated always as identity primary key,
  heading text not null,
  session_date date,
  session_time time,
  body text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger therapy_notes_set_updated_at
before update on therapy_notes
for each row execute function set_updated_at();

alter table therapy_notes enable row level security;

create policy "authenticated users can read therapy_notes"
  on therapy_notes for select
  using (auth.uid() is not null);

create policy "authenticated users can insert therapy_notes"
  on therapy_notes for insert
  with check (auth.uid() is not null);

create policy "authenticated users can update therapy_notes"
  on therapy_notes for update
  using (auth.uid() is not null);

create policy "authenticated users can delete therapy_notes"
  on therapy_notes for delete
  using (auth.uid() is not null);
