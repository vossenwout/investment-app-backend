import { assertEquals } from "https://deno.land/std@0.208.0/assert/assert_equals.ts";
import { assertMatch } from "https://deno.land/std@0.208.0/assert/assert_match.ts";
import { type DemoMessageRepo, handleDemoWriteRequest } from "./handler.ts";

class MockRepo implements DemoMessageRepo {
  public inserts: Array<{ content: string; metadata: Record<string, unknown> }> = [];
  #nextId = crypto.randomUUID();

  insert(input: { content: string; metadata: Record<string, unknown> }) {
    this.inserts.push(input);
    return Promise.resolve({
      id: this.#nextId,
      content: input.content,
      metadata: input.metadata,
      created_at: new Date().toISOString(),
    });
  }
}

Deno.test("handleDemoWriteRequest inserts record and returns 201", async () => {
  const repo = new MockRepo();
  const response = await handleDemoWriteRequest(
    new Request("http://localhost/demo-write", {
      method: "POST",
      body: JSON.stringify({ content: "Hello world", metadata: { source: "test" } }),
      headers: { "content-type": "application/json" },
    }),
    repo,
  );

  assertEquals(response.status, 201);
  const payload = await response.json();
  assertEquals(repo.inserts.length, 1);
  assertEquals(repo.inserts[0], { content: "Hello world", metadata: { source: "test" } });
  assertMatch(payload.id, /^[0-9a-f-]{36}$/i);
});

Deno.test("handleDemoWriteRequest rejects missing content", async () => {
  const response = await handleDemoWriteRequest(
    new Request("http://localhost/demo-write", {
      method: "POST",
      body: JSON.stringify({ metadata: {} }),
      headers: { "content-type": "application/json" },
    }),
    new MockRepo(),
  );

  assertEquals(response.status, 400);
  const payload = await response.json();
  assertEquals(payload.error, "`content` must be a non-empty string");
});

Deno.test("handleDemoWriteRequest rejects unsupported methods", async () => {
  const response = await handleDemoWriteRequest(
    new Request("http://localhost/demo-write", { method: "GET" }),
    new MockRepo(),
  );

  assertEquals(response.status, 405);
});
