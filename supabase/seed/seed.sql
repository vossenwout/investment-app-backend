-- Placeholder seed script for local development.
-- This block creates a demo portfolio + holdings for the first auth user if one exists.

do $$
declare
    target_user uuid := (select id from auth.users order by created_at asc limit 1);
    sample_portfolio_id uuid;
begin
    if target_user is null then
        raise notice 'No auth users found, skipping portfolio seed.';
        return;
    end if;

    insert into public.portfolios (owner_id, name, benchmark_ticker)
    values (target_user, 'Sample Growth Portfolio', 'VOO')
    returning id into sample_portfolio_id;

    insert into public.portfolio_positions (portfolio_id, ticker, quantity, cost_basis, notes)
    values
        (sample_portfolio_id, 'AAPL', 10.5, 170.25, 'Starter position'),
        (sample_portfolio_id, 'MSFT', 4.0, 318.15, null),
        (sample_portfolio_id, 'VTI', 2.25, 225.00, 'Long-term core holding');
end $$;
