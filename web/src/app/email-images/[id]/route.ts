import { createClient } from "@/lib/supabase/server";

// Images used in club emails. Public, because members' email apps fetch them without logging in;
// each id is long and random, so they can't be guessed.
export async function GET(_request: Request, ctx: RouteContext<"/email-images/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.rpc("email_image", { p_id: id }).maybeSingle<{ content_type: string; data_base64: string }>();
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(data.data_base64, "base64"), {
    headers: { "Content-Type": data.content_type, "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
