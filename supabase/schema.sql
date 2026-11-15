create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'personal')),
  checks_used integer not null default 0 check (checks_used >= 0),
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.use_check(uid uuid, free_limit integer)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare allowed boolean;
begin
  update public.profiles
  set checks_used = checks_used + 1, updated_at = now()
  where id = uid and (plan = 'personal' or checks_used < free_limit)
  returning true into allowed;
  return coalesce(allowed, false);
end;
$$;

create or replace function public.refund_check(uid uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.profiles
  set checks_used = greatest(0, checks_used - 1), updated_at = now()
  where id = uid and plan = 'free';
$$;
