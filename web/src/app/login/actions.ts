"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Remembers which address the code went to, so the code screen can show it and check the code
// against it. Kept on the server side of the browser (httpOnly) and dropped after an hour.
const EMAIL_COOKIE = "login_email";

export async function sendLoginLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    redirect("/login?error=email");
  }

  const h = await headers();
  const origin = h.get("origin") ?? `https://${h.get("host")}`;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) redirect("/login?error=send");

  (await cookies()).set(EMAIL_COOKIE, email, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/login",
    maxAge: 60 * 60,
  });
  redirect("/login?sent=1");
}

// The 6-digit code from the email signs you in on whatever device you typed it into,
// unlike the link, which only works in the browser that asked for it.
export async function verifyLoginCode(formData: FormData) {
  const store = await cookies();
  const email = store.get(EMAIL_COOKIE)?.value;
  if (!email) redirect("/login?error=start");

  const token = String(formData.get("code") ?? "").replace(/\D/g, "");
  if (token.length !== 6) redirect("/login?sent=1&error=code");

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) redirect("/login?sent=1&error=code");

  store.delete({ name: EMAIL_COOKIE, path: "/login" });
  redirect("/");
}

export async function resendCode() {
  const email = (await cookies()).get(EMAIL_COOKIE)?.value;
  if (!email) redirect("/login?error=start");
  const h = await headers();
  const origin = h.get("origin") ?? `https://${h.get("host")}`;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  redirect(error ? "/login?sent=1&error=resend" : "/login?sent=1&resent=1");
}

export async function startAgain() {
  (await cookies()).delete({ name: EMAIL_COOKIE, path: "/login" });
  redirect("/login");
}
