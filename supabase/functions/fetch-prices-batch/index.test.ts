import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  buildQuoteUpserts,
  partitionTickers,
  type RemoteQuote,
  resolveFetchBatchConfig,
} from "./handler.ts";

Deno.test("resolveFetchBatchConfig falls back to defaults", () => {
  const config = resolveFetchBatchConfig({
    get: () => undefined,
  });

  assertEquals(config.batchSize, 25);
  assertEquals(config.minFetchIntervalMinutes, 30);
  assertEquals(config.errorBackoffMinutes, 60);
});

Deno.test("resolveFetchBatchConfig clamps overrides", () => {
  const config = resolveFetchBatchConfig({
    get: (key: string) => {
      if (key === "FETCH_BATCH_SIZE") return "1000";
      if (key === "FETCH_MIN_FETCH_INTERVAL_MINUTES") return "0";
      if (key === "FETCH_ERROR_BACKOFF_MINUTES") return "5";
      return undefined;
    },
  });

  assertEquals(config.batchSize, 500); // clamped at max
  assertEquals(config.minFetchIntervalMinutes, 1); // clamped at min
  assertEquals(config.errorBackoffMinutes, 5);
});

Deno.test("buildQuoteUpserts maps remote payload", () => {
  const quotes: RemoteQuote[] = [
    {
      ticker: "AAPL",
      price: 200.5,
      currency: "USD",
      priceTime: "2024-01-01T00:00:00Z",
      metadata: { exchange: "NASDAQ" },
    },
  ];

  const upserts = buildQuoteUpserts(quotes, "2024-01-01T00:05:00Z");
  assertEquals(upserts.length, 1);
  assertEquals(upserts[0].ticker, "AAPL");
  assertEquals(upserts[0].last_price, 200.5);
  assertEquals(upserts[0].last_price_at, "2024-01-01T00:00:00Z");
  assertEquals(upserts[0].fetched_at, "2024-01-01T00:05:00Z");
  assertEquals(upserts[0].source_metadata, { exchange: "NASDAQ" });
});

Deno.test("partitionTickers splits missing tickers", () => {
  const tickers = ["AAPL", "MSFT", "GOOG"];
  const quotes: RemoteQuote[] = [
    { ticker: "AAPL", price: 1, currency: "USD", priceTime: "", metadata: null },
  ];
  const { succeeded, missing } = partitionTickers(tickers, quotes);
  assertEquals(succeeded, ["AAPL"]);
  assertEquals(missing.sort(), ["GOOG", "MSFT"]);
});
