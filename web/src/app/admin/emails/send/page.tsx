import { AdminNav, NotAllowed } from "@/components/admin";
import { logoUrl } from "@/lib/email-images";
import { emailSendingEnabled } from "@/lib/mailer";
import { meWithRole } from "@/lib/me";
import type { GroupRecipient } from "./actions";
import { GroupEmailForm } from "./group-email-form";

// Communications admin > Send email: write an email (from a template or from scratch), choose who gets it
// from members and contacts, preview it, send a test, then send.
export default async function SendGroupEmailPage() {
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;

  const [{ data: templates }, { data: recipients }, logo] = await Promise.all([
    // Renewal reminders are sent from the Members list, so they aren't offered here.
    supabase.from("email_templates").select("id, name, subject, body").eq("purpose", "general").order("name"),
    supabase.rpc("group_email_recipients"),
    logoUrl(supabase),
  ]);

  return (
    <div className="space-y-6">
      <AdminNav current="send" heading={false} />
      <h1 className="text-2xl font-semibold">Send a group email</h1>
      <GroupEmailForm
        templates={(templates ?? []) as { id: string; name: string; subject: string; body: string }[]}
        recipients={(recipients ?? []) as GroupRecipient[]}
        logoUrl={logo}
        enabled={emailSendingEnabled()}
      />
    </div>
  );
}
