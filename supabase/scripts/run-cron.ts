#!/usr/bin/env -S deno run --allow-env --allow-net --allow-read
import { loadSync } from "https://deno.land/std@0.208.0/dotenv/mod.ts";
import { existsSync } from "https://deno.land/std@0.208.0/fs/exists.ts";
import { resolve } from "https://deno.land/std@0.208.0/path/mod.ts";

type FunctionTarget = {
  path: string;
  description: string;
};

const FUNCTIONS: Record<string, FunctionTarget> = {
  "fetch-prices-batch": {
    path: "/functions/v1/fetch-prices-batch",
    description: "Refresh asset quotes in batches",
  },
  "recalc-metrics-batch": {
    path: "/functions/v1/recalc-metrics-batch",
    description: "Recompute metrics for stale portfolios",
  },
  "sync-reference-tickers": {
    path: "/functions/v1/sync-reference-tickers",
    description: "Refresh NASDAQ/NYSE ticker catalog",
  },
};

function loadEnvFromFile(envFile: string): void {
  if (!envFile) return;
  const resolved = resolve(envFile);
  if (!existsSync(resolved)) {
    console.warn(`[warn] Env file ${resolved} not found. Falling back to existing environment.`);
    return;
  }

  try {
    const parsed = loadSync({
      envPath: resolved,
      examplePath: null,
      defaultsPath: null,
      export: true,
      allowEmptyValues: true,
    });
    for (const [key, value] of Object.entries(parsed)) {
      if (Deno.env.get(key) === undefined) {
        Deno.env.set(key, value);
      }
    }
    console.log(`[info] Loaded environment variables from ${resolved}`);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.warn(`[warn] Failed to load env file ${resolved}: ${err.message}`);
  }
}

function usage(): never {
  const names = Object.entries(FUNCTIONS)
    .map(([name, target]) => `  - ${name}: ${target.description}`)
    .join("\n");
  console.error(
    `Usage: deno run -A supabase/scripts/run-cron.ts <function-name>\n\n` +
      `Available functions:\n${names}\n\n` +
      `Optional env vars:\n` +
      `  ENV_FILE       Path to env file (defaults to .env.local)\n` +
      `  API_URL        Override API base URL (defaults to http://127.0.0.1:54321)\n` +
      `  SERVICE_ROLE_KEY  Override service-role key`
  );
  Deno.exit(1);
}

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

async function main(): Promise<void> {
  const envFile = Deno.env.get("ENV_FILE") ?? ".env.local";
  loadEnvFromFile(envFile);

  const functionName = Deno.args[0];
  if (!functionName) {
    usage();
  }

  const target = FUNCTIONS[functionName];
  if (!target) {
    console.error(`Unknown function "${functionName}".`);
    usage();
  }

  const apiUrl = normalizeBaseUrl(Deno.env.get("API_URL") ?? "http://127.0.0.1:54321");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
  if (!serviceRoleKey) {
    console.error("SERVICE_ROLE_KEY is required (set it in .env.local or your shell).");
    Deno.exit(1);
  }

  const endpoint = `${apiUrl}${target.path}`;
  console.log(`[info] Invoking ${functionName} → ${endpoint}`);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  const bodyText = await response.text();
  try {
    const parsed = JSON.parse(bodyText);
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log(bodyText);
  }

  if (!response.ok) {
    console.error(`[error] Function returned HTTP ${response.status}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
