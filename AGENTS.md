# Investment App

Supabase backend for an investment tracking app. The goal of the investment app is not to offer realtime tracking, but instead
advanced analytics (alpha, beta, sharpe ratio, risk, correlation etc) on investment portfolios over time.

### Rules

#### Edge Functions

- Use Supabase Edge Functions for all backend or privileged tasks, such as:
  - Fetching or updating asset prices from external APIs (e.g. Yahoo Finance)
  - Recalculating portfolio metrics (total value, alpha, beta, etc.)
  - Performing background computations or batch processing
  - Any logic requiring the Service Role Key or access beyond a single user

- Other CRUD operations should be done directly using Supabase database calls for all simple, user-owned operations, such as:
  - Adding, Reading, Updating portfolio positions
  - These operations rely on Row Level Security (RLS) to ensure users can only access their own data.

#### Local Development

- Run a **local Supabase instance** for development and testing to ensure consistency across environments.

#### Testing

- For new features, **write tests** that can be executed in Continuous Integration (CI).

#### Pre-commit Hooks

- Use **pre-commit hooks** to automatically format, lint, and run tests before committing code.

#### Database Migrations

- **This project is in early development with nothing in production yet.**
- **Do NOT use ALTER TABLE statements** during development—only modify the CREATE TABLE statements in the original migration files.
- Group logical changes into single migration files for clarity and maintainability.
- If you need to create new migration file use `supabase migration new <migration name>`

#### Free tier

- Try to stay within the free tier limits of Supabase to avoid incurring costs. (500 000 function invocations per month, 500 MB DB, 1 GB storage etc)

#### Package Management

- **Avoid global installations.**
  Install dependencies locally to prevent system-wide configuration issues.

#### Docker

If you need docker to for example spin up supabase and get errors like Cannot connect to the Docker daemon at...
You should spin up Docker desktop yourself using:

```bash
open -a Docker
```

If you don't need docker anymore spin it down using:

```bash
pkill -SIGHUP -f /Applications/Docker.app 'docker serve'
```

#### Supabase

Spin it up with docker running using:

```bash
supabase start
```

After you are done you can spin it down using:

```bash
supabase stop
```

#### DONT USE /tmp of the system

If you need to write tmp files or inspect configs use the local /tmp folder at the root.

#### Patience when running commands

When running commands that spin up or down services like supabase, install packages, please be patient as it may take minutes to download necessary images.

#### Don't write frontend code

This repo is only for backend. It is important to think about frontend needs to plan backend,
but never implement frontend code.

#### Run git add . and pre-commit after each feature
After you finish a feature, please run:

```bash
git add .
pre-commit run --all-files
```

If any errors are found, fix them before finish your task.

Never run git commit.


#### README.md
Never modify the README.md file unless I explicitly ask you to, just tell me directly what you changed or what I should run.
