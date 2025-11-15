import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  type CalculatedMetrics,
  calculatePortfolioMetrics,
  resolveMetricsBatchConfig,
} from "./handler.ts";

Deno.test("resolveMetricsBatchConfig returns defaults when unset", () => {
  const config = resolveMetricsBatchConfig({ get: () => undefined });
  assertEquals(config.batchSize, 50);
});

Deno.test("resolveMetricsBatchConfig clamps provided value", () => {
  const config = resolveMetricsBatchConfig({
    get: (key: string) => key === "METRICS_BATCH_SIZE" ? "0" : undefined,
  });
  assertEquals(config.batchSize, 1);
});

Deno.test("calculatePortfolioMetrics aggregates totals and handles missing quotes", () => {
  const metrics: CalculatedMetrics = calculatePortfolioMetrics(
    [
      { ticker: "AAPL", quantity: 2, cost_basis: 100 },
      { ticker: "MSFT", quantity: "3", cost_basis: "150" },
      { ticker: "GOOG", quantity: 1, cost_basis: null },
    ],
    [
      { ticker: "AAPL", last_price: 200 },
      { ticker: "MSFT", last_price: "120" },
      // GOOG quote missing on purpose
    ],
  );

  assertEquals(metrics.position_count, 3);
  assertEquals(metrics.positions_missing_quotes, 1);
  assertEquals(metrics.total_value, Number((2 * 200 + 3 * 120).toFixed(6)));
  assertEquals(metrics.total_cost_basis, Number(((2 * 100) + (3 * 150)).toFixed(6)));
  assertEquals(
    metrics.unrealized_gain,
    Number((metrics.total_value - metrics.total_cost_basis).toFixed(6)),
  );
});
