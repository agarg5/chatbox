import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load env from local .env.local first (fork's own env)
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
// Fallback to original ChatBridge .env.local
dotenv.config({ path: path.resolve(__dirname, "../../ChatBridge/.env.local") });
// Also try local .env
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey);
