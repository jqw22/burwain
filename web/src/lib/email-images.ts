import "server-only";

import { siteOrigin } from "@/app/admin/members/remind/render";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

export async function emailImageUrl(id: string) {
  return `${await siteOrigin()}/email-images/${id}`;
}

// The club logo shown at the top of emails, or null if none has been uploaded.
export async function logoUrl(supabase: Client) {
  const { data } = await supabase.from("email_images").select("id").eq("is_logo", true).maybeSingle<{ id: string }>();
  return data ? emailImageUrl(data.id) : null;
}
