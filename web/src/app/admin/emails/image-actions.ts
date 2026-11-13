"use server";

import { revalidatePath } from "next/cache";
import { emailImageUrl } from "@/lib/email-images";
import { meWithRole } from "@/lib/me";

export type UploadResult = { ok: true; url: string } | { ok: false; error: string };

const TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_BYTES = 3 * 1024 * 1024;

// Saves an image for use in emails (already made smaller in the browser). With logo=on it becomes the
// club logo shown at the top of emails, replacing any earlier one.
export async function uploadEmailImage(form: FormData): Promise<UploadResult> {
  const { supabase, personId, allowed } = await meWithRole("admin");
  if (!allowed) return { ok: false, error: "Only club admins can add email images." };
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Please choose a picture." };
  if (!TYPES.includes(file.type)) return { ok: false, error: "Please choose a JPEG, PNG, GIF or WebP picture." };
  if (file.size > MAX_BYTES) return { ok: false, error: "That picture is too big. Please choose one under 3 MB." };
  const isLogo = form.get("logo") === "on";

  const hex = `\\x${Buffer.from(await file.arrayBuffer()).toString("hex")}`;
  if (isLogo) await supabase.from("email_images").update({ is_logo: false }).eq("is_logo", true);
  const { data, error } = await supabase
    .from("email_images")
    .insert({ content_type: file.type, data: hex, is_logo: isLogo, created_by: personId })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return { ok: false, error: "We couldn't save that picture. Please try again." };
  if (isLogo) revalidatePath("/admin/emails");
  return { ok: true, url: await emailImageUrl(data.id) };
}

export async function removeLogo() {
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return;
  await supabase.from("email_images").update({ is_logo: false }).eq("is_logo", true);
  revalidatePath("/admin/emails");
}
