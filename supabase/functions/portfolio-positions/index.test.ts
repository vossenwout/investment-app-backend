import { assertEquals } from "https://deno.land/std@0.208.0/assert/assert_equals.ts";
import {
  type AuthService,
  handlePortfolioPositionsRequest,
  HttpError,
  type PortfolioPositionRepo,
  type PortfolioPositionRow,
  type UpsertPositionInput,
} from "./handler.ts";

class MockRepo implements PortfolioPositionRepo {
  ensureCalls: Array<{ portfolioId: string; userId: string }> = [];
  lastUpsert?: UpsertPositionInput;
  deleted?: { portfolioId: string; ticker: string };
  upsertResult: PortfolioPositionRow = {
    id: crypto.randomUUID(),
    portfolio_id: crypto.randomUUID(),
    ticker: "AAPL",
    quantity: 1,
    cost_basis: 100,
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  ensurePortfolioOwnership(portfolioId: string, userId: string): Promise<void> {
    this.ensureCalls.push({ portfolioId, userId });
    return Promise.resolve();
  }

  upsertPosition(input: UpsertPositionInput): Promise<PortfolioPositionRow> {
    this.lastUpsert = input;
    return Promise.resolve(this.upsertResult);
  }

  deletePosition(portfolioId: string, ticker: string): Promise<void> {
    this.deleted = { portfolioId, ticker };
    return Promise.resolve();
  }
}

class MockAuth implements AuthService {
  userId = "user-123";
  lastHeader: string | null = null;
  shouldThrow = false;

  resolveUserId(header: string | null): Promise<string> {
    this.lastHeader = header;
    if (this.shouldThrow) {
      return Promise.reject(new HttpError(401, "Missing bearer token"));
    }
    return Promise.resolve(this.userId);
  }
}

const samplePortfolioId = "11111111-1111-4111-8111-111111111111";

Deno.test("handlePortfolioPositionsRequest inserts or updates a position", async () => {
  const repo = new MockRepo();
  const auth = new MockAuth();
  const response = await handlePortfolioPositionsRequest(
    new Request("http://localhost/portfolio-positions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Authorization": "Bearer test",
      },
      body: JSON.stringify({
        portfolioId: samplePortfolioId,
        ticker: "msft",
        quantity: 3.5,
        costBasis: 310.25,
        notes: " long-term ",
      }),
    }),
    { repo, authService: auth },
  );

  assertEquals(response.status, 201);
  assertEquals(repo.ensureCalls[0], { portfolioId: samplePortfolioId, userId: auth.userId });
  assertEquals(repo.lastUpsert, {
    portfolioId: samplePortfolioId,
    ticker: "MSFT",
    quantity: 3.5,
    costBasis: 310.25,
    notes: "long-term",
  });
  const payload = await response.json();
  assertEquals(payload.position.ticker, "AAPL"); // from mock response
});

Deno.test("handlePortfolioPositionsRequest deletes a position", async () => {
  const repo = new MockRepo();
  const auth = new MockAuth();
  const response = await handlePortfolioPositionsRequest(
    new Request("http://localhost/portfolio-positions", {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "Authorization": "Bearer test",
      },
      body: JSON.stringify({
        portfolioId: samplePortfolioId,
        ticker: "VTI",
      }),
    }),
    { repo, authService: auth },
  );

  assertEquals(response.status, 200);
  assertEquals(repo.deleted, { portfolioId: samplePortfolioId, ticker: "VTI" });
});

Deno.test("handlePortfolioPositionsRequest rejects invalid payloads", async () => {
  const repo = new MockRepo();
  const auth = new MockAuth();
  const response = await handlePortfolioPositionsRequest(
    new Request("http://localhost/portfolio-positions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Authorization": "Bearer test",
      },
      body: JSON.stringify({
        portfolioId: samplePortfolioId,
        ticker: "",
        quantity: -1,
      }),
    }),
    { repo, authService: auth },
  );

  assertEquals(response.status, 400);
});

Deno.test("handlePortfolioPositionsRequest surfaces auth failures", async () => {
  const repo = new MockRepo();
  const auth = new MockAuth();
  auth.shouldThrow = true;
  const response = await handlePortfolioPositionsRequest(
    new Request("http://localhost/portfolio-positions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        portfolioId: samplePortfolioId,
        ticker: "AAPL",
        quantity: 1,
      }),
    }),
    { repo, authService: auth },
  );

  assertEquals(response.status, 401);
});

Deno.test("handlePortfolioPositionsRequest rejects unsupported methods", async () => {
  const repo = new MockRepo();
  const auth = new MockAuth();
  const response = await handlePortfolioPositionsRequest(
    new Request("http://localhost/portfolio-positions", {
      method: "GET",
      headers: {
        "Authorization": "Bearer test",
      },
    }),
    { repo, authService: auth },
  );

  assertEquals(response.status, 405);
});
