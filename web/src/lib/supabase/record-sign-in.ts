import "server-only";
import { createClient } from "@supabase/supabase-js";
import { describeDevice } from "@/lib/device";
import { supabaseKey, supabaseUrl } from "./env";

// Adds a row to the login activity log (only superadmins can read it) as the person who just signed in.
// Uses the new session's token directly, as the session cookies may not be readable until the next request.
// A failure here never stops someone signing in.
export async function recordSignIn(accessToken: string | undefined, method: "code" | "link", userAgent: string | null) {
  if (!accessToken) return;
  try {
    const client = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.rpc("record_sign_in", { p_method: method, p_device: describeDevice(userAgent) });
    if (error) console.error("Could not record sign-in", error.message);
  } catch (e) {
    console.error("Could not record sign-in", e);
  }
}
