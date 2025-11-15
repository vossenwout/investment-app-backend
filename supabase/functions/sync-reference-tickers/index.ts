import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { handleSyncReferenceTickers } from "./handler.ts";

serve((req) => handleSyncReferenceTickers(req));
