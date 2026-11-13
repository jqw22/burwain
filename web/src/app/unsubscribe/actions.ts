"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function unsubscribe(form: FormData) {
  const token = String(form.get("t") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(token)) redirect("/unsubscribe?error=link");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unsubscribe_by_token", { p_token: token });
  if (error || !data) redirect("/unsubscribe?error=link");
  redirect("/unsubscribe?done=1");
}
