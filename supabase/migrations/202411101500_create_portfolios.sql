create extension if not exists "pgcrypto";

create table if not exists public.portfolios (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    name text not null check (char_length(name) > 0),
    benchmark_ticker text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.portfolio_positions (
    id uuid primary key default gen_random_uuid(),
    portfolio_id uuid not null references public.portfolios (id) on delete cascade,
    ticker text not null check (char_length(ticker) > 0),
    quantity numeric(20, 6) not null check (quantity > 0),
    cost_basis numeric(20, 6),
    notes text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    unique (portfolio_id, ticker)
);

create index if not exists portfolio_positions_portfolio_id_idx on public.portfolio_positions (portfolio_id);
create index if not exists portfolio_positions_ticker_idx on public.portfolio_positions (ticker);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$;

drop trigger if exists portfolios_set_updated_at on public.portfolios;
create trigger portfolios_set_updated_at
before update on public.portfolios
for each row
execute function public.set_updated_at();

drop trigger if exists portfolio_positions_set_updated_at on public.portfolio_positions;
create trigger portfolio_positions_set_updated_at
before update on public.portfolio_positions
for each row
execute function public.set_updated_at();

alter table public.portfolios enable row level security;
alter table public.portfolio_positions enable row level security;

create policy "Users manage their portfolios"
on public.portfolios
for all
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "Users manage positions within owned portfolios"
on public.portfolio_positions
for all
using (
    portfolio_id in (
        select id from public.portfolios where owner_id = auth.uid()
    )
)
with check (
    portfolio_id in (
        select id from public.portfolios where owner_id = auth.uid()
    )
);
