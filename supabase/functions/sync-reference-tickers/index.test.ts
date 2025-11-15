import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  mergeDirectoryTickers,
  parseNasdaqDirectory,
  parseOtherListedDirectory,
} from "./handler.ts";

Deno.test("parseNasdaqDirectory filters headers, tests, and maps fields", () => {
  const sample =
    `Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
AAPL|Apple Inc.|Q|N|N|100|N|N
FAKE|Fake Test|Q|Y|N|100|N|N
NEXT|NextShares Inc|Q|N|N|100|N|Y
File Creation Time: 20240101|`;

  const parsed = parseNasdaqDirectory(sample);
  assertEquals(parsed.length, 1);
  const [entry] = parsed;
  assertEquals(entry.ticker, "AAPL");
  assertEquals(entry.name, "Apple Inc.");
  assertEquals(entry.exchange, "NASDAQ");
  assertEquals(entry.asset_type, "EQUITY");
  assertEquals(entry.is_etf, false);
  assertEquals(entry.data?.roundLotSize, 100);
});

Deno.test("parseOtherListedDirectory normalizes symbols and ignores test issues", () => {
  const sample =
    `ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
BRK.B|Berkshire Hathaway Inc. Class B|N|BRK.B|N|1|N|
ZZZZ|Test|N|ZZZZ|N|1|Y|
File Creation Time: 20240101|`;

  const parsed = parseOtherListedDirectory(sample);
  assertEquals(parsed.length, 1);
  const [entry] = parsed;
  assertEquals(entry.ticker, "BRK.B");
  assertEquals(entry.exchange, "NYSE");
  assertEquals(entry.asset_type, "EQUITY");
  assertEquals(entry.data?.roundLotSize, 1);
});

Deno.test("mergeDirectoryTickers keeps first occurrence of ticker", () => {
  const nasdaq = [{
    ticker: "AAPL",
    name: "Apple Inc.",
    exchange: "NASDAQ",
    asset_type: "EQUITY",
    is_etf: false,
    source: "nasdaq_directory",
    data: null,
  }];
  const other = [{
    ticker: "AAPL",
    name: "Apple Replacement",
    exchange: "NYSE",
    asset_type: "EQUITY",
    is_etf: false,
    source: "otherlisted_directory",
    data: null,
  }];

  const merged = mergeDirectoryTickers(nasdaq, other);
  assertEquals(merged.length, 1);
  assertEquals(merged[0].name, "Apple Inc.");
  assertEquals(merged[0].source, "nasdaq_directory");
});
