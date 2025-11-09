import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { handlePortfolioPositionsRequest } from "./handler.ts";

serve((req: Request) => handlePortfolioPositionsRequest(req));
