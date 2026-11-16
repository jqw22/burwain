"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { meWithRole } from "@/lib/me";
import { cleanNewsHtml } from "@/lib/news";

// Admins add or change a club news post. The text is cleaned so only simple formatting and the
// club's own pictures are kept.
export async function saveNewsPost(form: FormData) {
  const id = String(form.get("id") ?? "");
  const { supabase, personId, allowed } = await meWithRole("admin");
  if (!allowed) redirect("/");
  const title = String(form.get("title") ?? "").trim();
  const body = cleanNewsHtml(String(form.get("body") ?? ""));
  const pinned = form.get("pinned") === "on";
  const back = id ? `/news/${encodeURIComponent(id)}/edit` : "/news/new";
  if (!title) redirect(`${back}?error=title`);
  if (!body) redirect(`${back}?error=body`);

  const result = id
    ? await supabase.from("news_posts").update({ title, body, pinned, updated_by: personId }).eq("id", id).select("id")
    : await supabase.from("news_posts").insert({ title, body, pinned, created_by: personId, updated_by: personId }).select("id");
  if (result.error || !result.data?.length) redirect(`${back}?error=save`);
  revalidatePath("/");
  revalidatePath("/news");
  redirect(`/?news=saved#post-${result.data[0].id}`);
}

export async function deleteNewsPost(form: FormData) {
  const id = String(form.get("id") ?? "");
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) redirect("/");
  const { data, error } = await supabase.from("news_posts").delete().eq("id", id).select("id");
  if (error || !data?.length) redirect(`/news/${encodeURIComponent(id)}/edit?error=delete`);
  revalidatePath("/");
  revalidatePath("/news");
  redirect("/?news=deleted");
}
