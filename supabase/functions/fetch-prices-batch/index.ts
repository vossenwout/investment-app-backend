import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { handleFetchPricesBatch } from "./handler.ts";

serve((req) => handleFetchPricesBatch(req));
