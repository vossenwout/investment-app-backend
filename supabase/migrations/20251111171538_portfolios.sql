create extension if not exists "pgcrypto";

create table if not exists public.portfolios (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    name text not null check (char_length(name) > 0),
    benchmark_ticker text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.asset_tickers (
    ticker text primary key,
    status text not null default 'active',
    last_fetched_at timestamptz,
    last_fetch_error text,
    retry_after timestamptz,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists asset_tickers_status_idx on public.asset_tickers (status, last_fetched_at);

create table if not exists public.reference_tickers (
    ticker text primary key,
    name text not null,
    exchange text not null,
    asset_type text,
    is_etf boolean not null default false,
    is_active boolean not null default true,
    last_seen_at timestamptz not null default timezone('utc', now()),
    source text not null default 'nasdaq_directory',
    data jsonb,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists reference_tickers_active_idx on public.reference_tickers (is_active, exchange);

create table if not exists public.portfolio_positions (
    id uuid primary key default gen_random_uuid(),
    portfolio_id uuid not null references public.portfolios (id) on delete cascade,
    ticker text not null references public.asset_tickers (ticker),
    quantity numeric(20, 6) not null check (quantity > 0),
    cost_basis numeric(20, 6),
    notes text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    unique (portfolio_id, ticker)
);

create index if not exists portfolio_positions_portfolio_id_idx on public.portfolio_positions (portfolio_id);
create index if not exists portfolio_positions_ticker_idx on public.portfolio_positions (ticker);

create table if not exists public.asset_quotes (
    ticker text primary key references public.asset_tickers (ticker),
    currency text not null default 'USD',
    last_price numeric(20, 6) not null,
    price_source text not null default 'yahoo_finance',
    last_price_at timestamptz not null,
    fetched_at timestamptz not null default timezone('utc', now()),
    source_metadata jsonb,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.portfolio_metrics (
    portfolio_id uuid primary key references public.portfolios (id) on delete cascade,
    as_of timestamptz not null default timezone('utc', now()),
    metrics jsonb not null default '{}'::jsonb,
    stale boolean not null default true,
    stale_reason text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$;

create or replace function public.ensure_asset_ticker_exists()
returns trigger
language plpgsql
as $$
begin
    if new.ticker is null then
        return new;
    end if;

    new.ticker := upper(new.ticker);
    insert into public.asset_tickers (ticker)
    values (new.ticker)
    on conflict (ticker) do nothing;
    return new;
end;
$$;

create or replace function public.mark_metrics_stale_from_positions()
returns trigger
language plpgsql
as $$
declare
    target_portfolio uuid;
begin
    if tg_op = 'DELETE' then
        target_portfolio := old.portfolio_id;
    else
        target_portfolio := new.portfolio_id;
    end if;

    insert into public.portfolio_metrics (portfolio_id, stale, stale_reason)
    values (target_portfolio, true, 'positions_changed')
    on conflict (portfolio_id) do update
    set stale = true,
        stale_reason = excluded.stale_reason;

    return null;
end;
$$;

create or replace function public.ensure_portfolio_metrics_row()
returns trigger
language plpgsql
as $$
begin
    insert into public.portfolio_metrics (portfolio_id, stale, stale_reason)
    values (new.id, true, 'portfolio_initialized')
    on conflict (portfolio_id) do nothing;
    return new;
end;
$$;

create or replace function public.select_asset_tickers_for_fetch(p_batch_size integer, p_min_fetch_interval_minutes integer)
returns table(ticker text)
language sql
stable
as $$
    select ticker
    from public.asset_tickers
    where status = 'active'
      and (retry_after is null or retry_after <= timezone('utc', now()))
      and (
        last_fetched_at is null
        or timezone('utc', now()) - last_fetched_at > make_interval(mins => greatest(coalesce(p_min_fetch_interval_minutes, 0), 0))
      )
    order by coalesce(last_fetched_at, '1970-01-01'::timestamptz)
    limit greatest(coalesce(p_batch_size, 1), 1);
$$;

create or replace function public.select_stale_portfolios(p_batch_size integer)
returns table(portfolio_id uuid)
language sql
stable
as $$
    select portfolio_id
    from public.portfolio_metrics
    where stale = true
    order by updated_at nulls first
    limit greatest(coalesce(p_batch_size, 1), 1);
$$;

drop trigger if exists asset_tickers_set_updated_at on public.asset_tickers;
create trigger asset_tickers_set_updated_at
before update on public.asset_tickers
for each row
execute function public.set_updated_at();

drop trigger if exists portfolios_set_updated_at on public.portfolios;
create trigger portfolios_set_updated_at
before update on public.portfolios
for each row
execute function public.set_updated_at();

drop trigger if exists portfolios_seed_metrics_row on public.portfolios;
create trigger portfolios_seed_metrics_row
after insert on public.portfolios
for each row
execute function public.ensure_portfolio_metrics_row();

drop trigger if exists portfolio_positions_set_updated_at on public.portfolio_positions;
create trigger portfolio_positions_set_updated_at
before update on public.portfolio_positions
for each row
execute function public.set_updated_at();

drop trigger if exists portfolio_positions_ensure_ticker on public.portfolio_positions;
create trigger portfolio_positions_ensure_ticker
before insert or update on public.portfolio_positions
for each row
execute function public.ensure_asset_ticker_exists();

drop trigger if exists portfolio_positions_mark_metrics_stale on public.portfolio_positions;
create trigger portfolio_positions_mark_metrics_stale
after insert or update or delete on public.portfolio_positions
for each row
execute function public.mark_metrics_stale_from_positions();

drop trigger if exists asset_quotes_set_updated_at on public.asset_quotes;
create trigger asset_quotes_set_updated_at
before update on public.asset_quotes
for each row
execute function public.set_updated_at();

drop trigger if exists reference_tickers_set_updated_at on public.reference_tickers;
create trigger reference_tickers_set_updated_at
before update on public.reference_tickers
for each row
execute function public.set_updated_at();

drop trigger if exists portfolio_metrics_set_updated_at on public.portfolio_metrics;
create trigger portfolio_metrics_set_updated_at
before update on public.portfolio_metrics
for each row
execute function public.set_updated_at();

alter table public.portfolios enable row level security;
alter table public.portfolio_positions enable row level security;
alter table public.asset_quotes enable row level security;
alter table public.portfolio_metrics enable row level security;
alter table public.asset_tickers enable row level security;
alter table public.reference_tickers enable row level security;

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

create policy "Service role manages asset quotes"
on public.asset_quotes
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "Service role manages asset tickers"
on public.asset_tickers
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "Users read metrics for owned portfolios"
on public.portfolio_metrics
for select
using (
    portfolio_id in (
        select id from public.portfolios where owner_id = auth.uid()
    )
);

create policy "Service role manages portfolio metrics"
on public.portfolio_metrics
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "Reference tickers are readable by anyone"
on public.reference_tickers
for select
using (true);

create policy "Service role manages reference tickers"
on public.reference_tickers
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create index if not exists portfolio_metrics_stale_idx on public.portfolio_metrics (stale);
