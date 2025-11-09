import { assertEquals, assertMatch } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildHealthPayload, handleHealthRequest } from "./handler.ts";

Deno.test("buildHealthPayload reads version and region from env", () => {
  const payload = buildHealthPayload({
    get: (key: string) => {
      if (key === "APP_VERSION") return "1.2.3";
      if (key === "SUPABASE_REGION") return "test-region";
      return undefined;
    },
  });

  assertEquals(payload.version, "1.2.3");
  assertEquals(payload.region, "test-region");
  assertEquals(payload.status, "ok");
  assertMatch(payload.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

Deno.test("handleHealthRequest returns 200 with ok payload on GET", async () => {
  const response = handleHealthRequest(new Request("http://localhost", { method: "GET" }));
  assertEquals(response.status, 200);
  const payload = await response.json();
  assertEquals(payload.status, "ok");
});

Deno.test("handleHealthRequest rejects non-GET requests", async () => {
  const response = handleHealthRequest(
    new Request("http://localhost", { method: "POST", body: "{}" }),
  );
  assertEquals(response.status, 405);
  const payload = await response.json();
  assertEquals(payload.error, "Method not allowed");
});
