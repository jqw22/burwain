import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./env";

// A Supabase client with the secret key, for the few server jobs where nobody is logged in
// (Stripe confirming a card payment). It can only run the functions granted to the service role.
// Never use it for anything a logged-in person could do with their own client.
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set");
  return createClient(supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
