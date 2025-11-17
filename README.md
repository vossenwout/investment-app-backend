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
│   │   ├── _shared/               # Shared Supabase helpers
│   │   ├── health/                # Read-only health check function + tests
│   │   ├── fetch-prices-batch/    # Cron job that refreshes asset quotes
│   │   └── recalc-metrics-batch/  # Cron job that recomputes portfolio analytics
│   ├── scripts/                   # Local helpers for invoking cron-like functions
│   ├── migrations/                # Database change scripts
│   └── seed/seed.sql              # Optional bootstrap data
├── deno.jsonc                 # Shared Deno tasks & lint config
├── .pre-commit-config.yaml    # Formatting, linting, and tests
└── .env.example               # Template for local credentials
```

## Workflow Notes

- Use Edge Functions (TypeScript on Deno) only for cron/batch tasks such as refreshing prices and recomputing metrics; user CRUD flows rely on direct Supabase client calls protected by RLS.

## Local cron helpers

`supabase/scripts/run-cron.ts` is a small Deno script that loads `.env.local` (or the file specified via `ENV_FILE`) and POSTs to the cron-oriented Edge Functions. It saves you from copying curl commands or pasting secrets by hand.

1. Start the local stack: `supabase start`.
2. Serve Edge Functions so the runtime can reach your database: `supabase functions serve --env-file .env.local --no-verify-jwt`.
3. In a new terminal, invoke whichever batch you want:
   ```bash
   deno run -A supabase/scripts/run-cron.ts fetch-prices-batch
   deno run -A supabase/scripts/run-cron.ts recalc-metrics-batch
   deno run -A supabase/scripts/run-cron.ts sync-reference-tickers
   ```

The script looks for `SERVICE_ROLE_KEY` and `API_URL` in the environment. If they are missing it automatically loads `.env.local`; override with `ENV_FILE=some.env deno run ...` or by exporting the variables yourself. Successful responses are printed as pretty JSON, and a non-200 status exits with code 1 so you can wire it into your own scheduler if desired.

### Scheduling in production

Because the Supabase CLI doesn’t expose cron commands yet, create schedules via the Supabase Dashboard:

1. Deploy the Edge Functions and set `SUPABASE_URL`, `SERVICE_ROLE_KEY`, and any batch-size env vars under **Settings → API → Functions → Environment Variables**.
2. Open **Edge Functions → (select function) → Add schedule**.
3. Enter the cron expression (e.g., `*/10 * * * *`), method `POST`, path `/functions/v1/fetch-prices-batch`, and header `Authorization: Bearer <SERVICE_ROLE_KEY>`. Repeat for `recalc-metrics-batch`.
4. Use the `run-cron.ts` helper locally anytime you need to reproduce what the hosted scheduler will do before changing the cadence or batch size.
- Keep migrations in `supabase/migrations` so the CLI can replay them in CI.
- Update `supabase/seed/seed.sql` whenever the app relies on reference data.
- Run `pre-commit install` to ensure formatting, linting, and tests run prior to every commit.

Remember to run `supabase db reset` after pulling schema changes so the new tables and demo data are available locally.
