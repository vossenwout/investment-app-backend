# Investment App

Supabase backend for an investment tracking app.

### Rules

#### Edge Functions

- Use **Supabase Edge Functions** for all backend tasks such as:
  - Fetching prices
  - Calculating metrics
  - Performing other computations...

#### Local Development

- Run a **local Supabase instance** for development and testing to ensure consistency across environments.

#### Testing

- For new features, **write tests** that can be executed in Continuous Integration (CI).

#### Pre-commit Hooks

- Use **pre-commit hooks** to automatically format, lint, and run tests before committing code.

#### Language

- Write all Edge Functions in **TypeScript**.

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


#### Docs
If you change something the frontend needs to know about, please update the docs in docs/docs.md accordingly.
For example if an edge function gets added or changed add it there.
