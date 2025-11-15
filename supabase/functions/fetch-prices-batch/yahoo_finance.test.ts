import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { YahooFinanceQuoteProvider } from "./yahoo_finance.ts";

const FIXED_NOW = new Date("2024-01-01T00:00:00Z");
const fixedNow = () => new Date(FIXED_NOW.getTime());

const COOKIE_URL = "https://fc.yahoo.com";
const CRUMB_URL = "https://query1.finance.yahoo.com/v1/test/getcrumb";
const QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";

type CredentialRecord = {
  cookie: string;
  crumb: string;
  expiresAt: string;
};

class InMemoryCredentialCache {
  record: CredentialRecord | null;
  invalidations = 0;

  constructor(record: CredentialRecord | null = null) {
    this.record = record;
  }

  load(): Promise<CredentialRecord | null> {
    return Promise.resolve(this.record);
  }

  save(record: CredentialRecord): Promise<void> {
    this.record = record;
    return Promise.resolve();
  }

  invalidate(): Promise<void> {
    this.record = null;
    this.invalidations += 1;
    return Promise.resolve();
  }
}

function makeQuoteResponse(symbol = "AAPL", price = 10, ts = 1_700_000_000): Response {
  return new Response(
    JSON.stringify({
      quoteResponse: {
        result: [
          {
            symbol,
            regularMarketPrice: price,
            regularMarketTime: ts,
            currency: "USD",
            fullExchangeName: "NASDAQ",
          },
        ],
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function toUrl(input: Request | URL | string): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

Deno.test("YahooFinanceQuoteProvider reuses cached credentials when valid", async () => {
  const cache = new InMemoryCredentialCache({
    cookie: "A3=cached",
    crumb: "crumb123",
    expiresAt: new Date(FIXED_NOW.getTime() + 60_000).toISOString(),
  });

  const calls: string[] = [];
  const fakeFetch: typeof fetch = (input, _init) => {
    const url = toUrl(input);
    calls.push(url);
    if (url.startsWith(QUOTE_URL)) {
      return Promise.resolve(makeQuoteResponse());
    }
    return Promise.reject(new Error(`Unexpected fetch ${url}`));
  };

  const provider = new YahooFinanceQuoteProvider({
    cache,
    fetchFn: fakeFetch,
    now: fixedNow,
    credentialTtlMs: 60_000,
  });

  const quotes = await provider.fetchQuotes(["aapl"]);
  assertEquals(quotes.length, 1);
  assertEquals(quotes[0].ticker, "AAPL");
  assertEquals(calls.length, 1);
  assertEquals(calls[0], `${QUOTE_URL}?symbols=AAPL&formatted=false&crumb=crumb123`);
  assertEquals(cache.invalidations, 0);
});

Deno.test("YahooFinanceQuoteProvider refreshes and stores credentials when missing", async () => {
  const cache = new InMemoryCredentialCache();
  const fakeFetch: typeof fetch = (input, _init) => {
    const url = toUrl(input);
    if (url === COOKIE_URL) {
      return Promise.resolve(
        new Response(null, {
          status: 200,
          headers: { "set-cookie": "A3=newcookie;" },
        }),
      );
    }
    if (url === CRUMB_URL) {
      return Promise.resolve(new Response("newcrumb", { status: 200 }));
    }
    if (url.startsWith(QUOTE_URL)) {
      return Promise.resolve(makeQuoteResponse());
    }
    return Promise.reject(new Error(`Unexpected fetch ${url}`));
  };

  const provider = new YahooFinanceQuoteProvider({
    cache,
    fetchFn: fakeFetch,
    now: fixedNow,
    credentialTtlMs: 90_000,
  });

  await provider.fetchQuotes(["MSFT"]);

  assertEquals(cache.record?.cookie, "A3=newcookie");
  assertEquals(cache.record?.crumb, "newcrumb");
  const expectedExpiry = new Date(FIXED_NOW.getTime() + 90_000).toISOString();
  assertEquals(cache.record?.expiresAt, expectedExpiry);
});

Deno.test("YahooFinanceQuoteProvider invalidates stale credentials after 401", async () => {
  const cache = new InMemoryCredentialCache({
    cookie: "A3=old",
    crumb: "oldcrumb",
    expiresAt: new Date(FIXED_NOW.getTime() + 60_000).toISOString(),
  });
  let quoteCalls = 0;
  const fakeFetch: typeof fetch = (input, _init) => {
    const url = toUrl(input);
    if (url.startsWith(QUOTE_URL)) {
      quoteCalls += 1;
      if (quoteCalls === 1) {
        return Promise.resolve(new Response(null, { status: 401 }));
      }
      return Promise.resolve(makeQuoteResponse("AAPL", 11, 1_700_000_100));
    }
    if (url === COOKIE_URL) {
      return Promise.resolve(
        new Response(null, {
          status: 200,
          headers: { "set-cookie": "A3=refreshed;" },
        }),
      );
    }
    if (url === CRUMB_URL) {
      return Promise.resolve(new Response("freshcrumb", { status: 200 }));
    }
    return Promise.reject(new Error(`Unexpected fetch ${url}`));
  };

  const provider = new YahooFinanceQuoteProvider({
    cache,
    fetchFn: fakeFetch,
    now: fixedNow,
    credentialTtlMs: 120_000,
  });

  const quotes = await provider.fetchQuotes(["AAPL"]);
  assertEquals(quotes[0].price, 11);
  assertEquals(quoteCalls, 2);
  assertEquals(cache.invalidations, 1);
  assertEquals(cache.record?.cookie, "A3=refreshed");
  assertEquals(cache.record?.crumb, "freshcrumb");
});
