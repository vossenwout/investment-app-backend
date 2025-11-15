import { assert } from "https://deno.land/std@0.208.0/assert/assert.ts";
import { assertEquals } from "https://deno.land/std@0.208.0/assert/assert_equals.ts";
import { assertExists } from "https://deno.land/std@0.208.0/assert/assert_exists.ts";
import { handleSyncReferenceTickers } from "./handler.ts";
import { createServiceRoleClient } from "../_shared/supabase.ts";

Deno.test({
  name: "E2E: sync-reference-tickers ingests directories and deactivates stale rows",
  ignore: !Deno.env.get("SUPABASE_URL"),
  async fn() {
    const client = createServiceRoleClient();
    const nasdaqTicker = "AAPL";
    const otherTicker = "SPY"; // Known ETF listed on NYSE Arca
    const staleTicker = "ZZZZ_SYNC_E2E";
    const tickersToCleanup = [staleTicker];

    const fixedNow = new Date("2025-01-02T03:04:05.000Z");
    const expectedTimestamp = fixedNow.toISOString();

    function assertTimestampMatches(value: string | null) {
      assertExists(value);
      assertEquals(new Date(value).toISOString(), expectedTimestamp);
    }

    try {
      await client.from("reference_tickers").delete().in("ticker", tickersToCleanup);
      await client.from("reference_tickers").upsert({
        ticker: staleTicker,
        name: "Legacy Corp",
        exchange: "NYSE",
        asset_type: "EQUITY",
        is_etf: false,
        is_active: true,
        last_seen_at: "2024-01-01T00:00:00.000Z",
        source: "e2e-test",
      });

      const request = new Request("http://localhost/sync-reference-tickers", { method: "POST" });
      const response = await handleSyncReferenceTickers(request, {
        client,
        now: () => fixedNow,
      });

      assertEquals(response.status, 200);
      const body = await response.json();
      assert(body.upserts > 0);
      assert(body.fetched.nasdaq > 0);
      assert(body.fetched.other > 0);

      const { data: rows, error } = await client
        .from("reference_tickers")
        .select("ticker, exchange, asset_type, is_etf, is_active, last_seen_at, source")
        .in("ticker", [nasdaqTicker, otherTicker])
        .order("ticker");

      if (error) {
        throw error;
      }

      assertEquals(rows?.length, 2);
      const nasdaqRow = rows?.find((row) => row.ticker === nasdaqTicker);
      const otherRow = rows?.find((row) => row.ticker === otherTicker);

      assertExists(nasdaqRow);
      assertExists(otherRow);
      assertEquals(nasdaqRow?.exchange, "NASDAQ");
      assertEquals(nasdaqRow?.asset_type, "EQUITY");
      assertEquals(nasdaqRow?.is_active, true);
      assertTimestampMatches(nasdaqRow?.last_seen_at ?? null);
      assertEquals(nasdaqRow?.source, "nasdaq_directory");

      assertEquals(otherRow?.exchange, "NYSE ARCA");
      assertEquals(otherRow?.asset_type, "ETF");
      assertEquals(otherRow?.is_etf, true);
      assertEquals(otherRow?.is_active, true);
      assertTimestampMatches(otherRow?.last_seen_at ?? null);
      assertEquals(otherRow?.source, "otherlisted_directory");

      const { data: staleRow } = await client
        .from("reference_tickers")
        .select("is_active")
        .eq("ticker", staleTicker)
        .single();

      assertEquals(staleRow?.is_active, false);
    } finally {
      await client.from("reference_tickers").delete().in("ticker", tickersToCleanup);
    }
  },
});
