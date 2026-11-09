"use server";

import { redirect } from "next/navigation";
import { meWithRole, text } from "@/lib/me";

export async function acceptApplication(form: FormData) {
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) redirect("/admin/applications?error=accept");
  const { data, error } = await supabase.rpc("accept_application", { p_id: String(form.get("id")) });
  if (error) redirect(`/admin/applications?error=${error.message.includes("already uses that email") ? "email" : "accept"}`);
  redirect(`/admin/members/${data}?saved=accepted`);
}

export async function declineApplication(form: FormData) {
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) redirect("/admin/applications?error=decline");
  const { error } = await supabase.rpc("decline_application", {
    p_id: String(form.get("id")),
    p_reason: text(form, "reason") ?? "",
  });
  redirect(`/admin/applications?${error ? "error" : "saved"}=decline`);
}
