import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { handleHealthRequest } from "./handler.ts";

serve(handleHealthRequest);
