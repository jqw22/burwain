import { Card, SaveButton } from "@/components/fields";
import { unsubscribe } from "./actions";

// Linked from the bottom of every group email. A button (not just opening the link) does the
// unsubscribing, so email security scanners that open links don't unsubscribe people by accident.
export default async function UnsubscribePage({ searchParams }: PageProps<"/unsubscribe">) {
  const params = await searchParams;
  const token = typeof params.t === "string" ? params.t : "";

  if (params.done)
    return (
      <Card title="You've been unsubscribed">
        <p className="text-slate-700">
          You won&apos;t get Burwain group emails any more. You&apos;ll still get emails about your own membership, such as renewal reminders and
          login codes. If you change your mind, please contact the membership secretary.
        </p>
      </Card>
    );

  if (params.error || !token)
    return (
      <Card title="Link not recognised">
        <p className="text-slate-700">
          This unsubscribe link didn&apos;t work. Please use the link at the bottom of the latest email, or contact the membership secretary.
        </p>
      </Card>
    );

  return (
    <Card title="Unsubscribe from Burwain emails">
      <form action={unsubscribe} className="space-y-4">
        <input type="hidden" name="t" value={token} />
        <p className="text-slate-700">Press the button to stop getting group emails from Burwain.</p>
        <SaveButton pendingText="Unsubscribing…">Unsubscribe</SaveButton>
      </form>
    </Card>
  );
}
