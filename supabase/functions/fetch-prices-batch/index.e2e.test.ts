// Add to index.test.ts or create a separate index.e2e.test.ts

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { handleFetchPricesBatch } from "./handler.ts";
import { createServiceRoleClient } from "../_shared/supabase.ts";

Deno.test({
  name: "E2E: fetch-prices-batch updates database",
  ignore: !Deno.env.get("SUPABASE_URL"), // Skip if Supabase not running
  async fn() {
    const client = createServiceRoleClient();
    // Setup: Insert test ticker
    const testTicker = "AAPL";
    try {
      // check for error
      const { error: insertError } = await client.from("asset_tickers").insert({
        ticker: testTicker,
        status: "active",
        last_fetched_at: null,
      });
      if (insertError) {
        console.error(`Failed to insert test ticker: ${insertError.message}`);
        Deno.exit(1);
      }
      // Execute handler with mock provider
      const request = new Request("http://localhost/fetch-prices-batch", {
        method: "POST",
      });

      const response = await handleFetchPricesBatch(request, {
        client,
        config: { batchSize: 5, minFetchIntervalMinutes: 1, errorBackoffMinutes: 60 },
      });

      // Verify response
      assertEquals(response.status, 200);
      const body = await response.json();
      assertExists(body.processedTickers);

      // Verify database state
      const { data: ticker } = await client
        .from("asset_tickers")
        .select("*")
        .eq("ticker", testTicker)
        .single();

      assertExists(ticker?.last_fetched_at);
      assertEquals(ticker?.last_fetch_error, null);

      const { data: quote } = await client
        .from("asset_quotes")
        .select("*")
        .eq("ticker", testTicker)
        .single();

      assertExists(quote);
      assertEquals(quote.ticker, testTicker);
      assertExists(quote.last_price);
    } finally {
      await client.from("asset_quotes").delete().eq("ticker", testTicker);
      await client.from("asset_tickers").delete().eq("ticker", testTicker);
    }
  },
});
