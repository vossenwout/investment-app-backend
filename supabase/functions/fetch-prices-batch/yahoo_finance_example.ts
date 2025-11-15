interface YahooFinanceClient {
  cookie: string | null;
  crumb: string | null;
}

class YahooFinanceAPI {
  private cookie: string | null = null;
  private crumb: string | null = null;

  async init(): Promise<void> {
    // Step 1: Get cookie
    const cookieResponse = await fetch("https://fc.yahoo.com", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    // Extract A3 cookie from response
    const cookies = cookieResponse.headers.get("set-cookie");
    if (cookies) {
      const a3Match = cookies.match(/A3=([^;]+)/);
      if (a3Match) {
        this.cookie = `A3=${a3Match[1]}`;
      }
    }

    if (!this.cookie) {
      throw new Error("Failed to get cookie");
    }

    // Step 2: Get crumb
    const crumbResponse = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: {
        Cookie: this.cookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    this.crumb = await crumbResponse.text();
    // Remove quotes if present
    this.crumb = this.crumb.replace(/"/g, "");
  }

  async getQuote(symbol: string): Promise<any> {
    if (!this.cookie || !this.crumb) {
      await this.init();
    }

    const url = new URL("https://query1.finance.yahoo.com/v7/finance/quote");
    url.searchParams.set("symbols", symbol);
    url.searchParams.set("formatted", "false");
    url.searchParams.set("crumb", this.crumb!);

    const response = await fetch(url.toString(), {
      headers: {
        Cookie: this.cookie!,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
    });

    if (response.status === 401) {
      // Cookie/crumb expired, refresh
      this.cookie = null;
      this.crumb = null;
      return this.getQuote(symbol); // Retry
    }

    if (!response.ok) {
      throw new Error(`Yahoo Finance API error: ${response.status}`);
    }

    return response.json();
  }

  async getBatchQuotes(symbols: string[]): Promise<any> {
    if (!this.cookie || !this.crumb) {
      await this.init();
    }

    const url = new URL("https://query1.finance.yahoo.com/v7/finance/quote");
    url.searchParams.set("symbols", symbols.join(","));
    url.searchParams.set("formatted", "false");
    url.searchParams.set("crumb", this.crumb!);

    const response = await fetch(url.toString(), {
      headers: {
        Cookie: this.cookie!,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
    });

    if (response.status === 401) {
      // Cookie/crumb expired, refresh
      this.cookie = null;
      this.crumb = null;
      return this.getBatchQuotes(symbols); // Retry
    }

    if (!response.ok) {
      throw new Error(`Yahoo Finance API error: ${response.status}`);
    }

    return response.json();
  }

  async getHistoricalPrices(
    symbol: string,
    startDate: Date,
    endDate: Date,
    interval: string = "1d",
  ): Promise<any> {
    if (!this.cookie || !this.crumb) {
      await this.init();
    }

    const url = new URL(`https://query2.finance.yahoo.com/v8/finance/chart/${symbol}`);
    url.searchParams.set("period1", Math.floor(startDate.getTime() / 1000).toString());
    url.searchParams.set("period2", Math.floor(endDate.getTime() / 1000).toString());
    url.searchParams.set("interval", interval);
    url.searchParams.set("events", "div,splits");
    url.searchParams.set("crumb", this.crumb!);

    const response = await fetch(url.toString(), {
      headers: {
        Cookie: this.cookie!,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
    });

    if (response.status === 401) {
      this.cookie = null;
      this.crumb = null;
      return this.getHistoricalPrices(symbol, startDate, endDate, interval);
    }

    if (!response.ok) {
      throw new Error(`Yahoo Finance API error: ${response.status}`);
    }

    return response.json();
  }
}

// Usage
const api = new YahooFinanceAPI();

// Get single quote
const quote = await api.getQuote("AAPL");
console.log(quote.quoteResponse.result[0]);

// Get batch quotes
const quotes = await api.getBatchQuotes(["AAPL", "MSFT", "GOOGL"]);
quotes.quoteResponse.result.forEach((q: any) => {
  console.log(`${q.symbol}: $${q.regularMarketPrice}`);
});

// Get historical data
const history = await api.getHistoricalPrices(
  "AAPL",
  new Date("2024-01-01"),
  new Date("2024-12-31"),
  "1d",
);
