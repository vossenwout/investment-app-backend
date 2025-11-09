# Investment App Supabase Backend

This repository hosts the Supabase backend for the investment app. It is designed to run locally with the Supabase CLI so you can iterate on the database schema, seed data, and Edge Functions before pushing changes to production.

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) `>= 1.150.3`
- Docker Desktop (required by the Supabase CLI for local containers)
- [Deno](https://deno.land/#installation) `>= 1.41`
- [pre-commit](https://pre-commit.com/#install) for local linting, formatting, and tests

## Initial Setup

1. Copy the environment template and fill in any secrets provided by the Supabase dashboard:

   ```bash
   cp .env.example .env.local
   ```

   Edge Functions skip env vars that start with `SUPABASE_`, so keep the duplicate aliases in the template (`API_URL`, `EDGE_FUNCTION_API_URL`, `SERVICE_ROLE_KEY`). Set `API_URL` to `http://127.0.0.1:54321` for host-side tooling, and `EDGE_FUNCTION_API_URL` to `http://host.docker.internal:54321` so the Docker container can reach the host API.

2. Ensure Docker Desktop is running, then start the local Supabase stack:

   ```bash
   supabase start
   ```

   This boots Postgres, Studio, Auth, Storage, Realtime, and the Edge runtime using the ports defined in `supabase/config.toml`.

   You can access the Supabase Studio UI at [http://localhost:54323](http://localhost:54323)

3. Apply migrations and seed data if you add any files later on:

   ```bash
   supabase db reset
   ```

4. Serve functions in watch mode (this automatically reloads on changes):

   ```bash
   supabase functions serve --env-file .env.local
   ```

5. Run formatting, linting, and tests (also wired into `pre-commit`):

   ```bash
   deno task fmt
   deno task lint
   deno task test
   ```

## Project Structure

```
.
├── supabase/
│   ├── config.toml            # Local Supabase stack configuration
│   ├── functions/
│   │   ├── health/                # Read-only health check function + tests
│   │   ├── demo-write/            # Demo function that persists records into Postgres
│   │   └── portfolio-positions/   # Authenticated add/remove holdings API
│   ├── migrations/                # Database change scripts
│   └── seed/seed.sql              # Optional bootstrap data
├── deno.jsonc                 # Shared Deno tasks & lint config
├── .pre-commit-config.yaml    # Formatting, linting, and tests
└── .env.example               # Template for local credentials
```

## Workflow Notes

- Use Edge Functions (TypeScript on Deno) for backend tasks such as fetching prices and computing metrics.
- Keep migrations in `supabase/migrations` so the CLI can replay them in CI.
- Update `supabase/seed/seed.sql` whenever the app relies on reference data.
- Run `pre-commit install` to ensure formatting, linting, and tests run prior to every commit.

## Portfolio + Position Management

- Migration `202411101500_create_portfolios.sql` adds `portfolios` (owned by an auth user) and `portfolio_positions` (per-ticker holdings) with strict RLS policies so users only touch their own rows.
- `supabase/functions/portfolio-positions` exposes an Edge Function that requires a Firebase/Supabase bearer token and supports `POST` (add/update) and `DELETE` (remove) requests.
- Frontend flow: call the function via `fetch('/functions/v1/portfolio-positions', { method: 'POST', headers: { Authorization: \`Bearer ${session.access_token}\` } ... })`, then optimistically update the UI and trigger any analytics refresh.
- Example request to add or update a holding:

  ```bash
  curl -X POST \
    -H "Authorization: Bearer <user access token>" \
    -H "content-type: application/json" \
    -d '{"portfolioId":"<uuid>","ticker":"AAPL","quantity":5,"costBasis":170.25,"notes":"Core position"}' \
    http://127.0.0.1:54321/functions/v1/portfolio-positions
  ```

- Remove a holding:

  ```bash
  curl -X DELETE \
    -H "Authorization: Bearer <user access token>" \
    -H "content-type: application/json" \
    -d '{"portfolioId":"<uuid>","ticker":"AAPL"}' \
    http://127.0.0.1:54321/functions/v1/portfolio-positions
  ```

Remember to run `supabase db reset` after pulling schema changes so the new tables and demo data are available locally.
