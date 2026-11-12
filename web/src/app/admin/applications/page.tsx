import { AdminNav, NotAllowed } from "@/components/admin";
import { Card, Notice, SaveButton } from "@/components/fields";
import { meWithRole, pounds, ukDate } from "@/lib/me";
import { acceptApplication, declineApplication } from "./actions";

type Application = {
  id: string;
  created_at: string;
  contact_name: string;
  contact_email: string;
  type_name: string;
  club_year: string | null;
  people_count: number;
  price_pence: number;
  people: string;
  postcode: string | null;
  has_medical: boolean;
};

const ERRORS: Record<string, string> = {
  accept: "We couldn't accept that application. It may already have been dealt with.",
  email: "Someone with that email is already a member, so the application can't be accepted. Decline it, or contact them.",
  decline: "We couldn't decline that application. It may already have been dealt with.",
};

// Applications from the public Join page, waiting for an admin.
export default async function ApplicationsPage({ searchParams }: PageProps<"/admin/applications">) {
  const params = await searchParams;
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;
  const { data } = await supabase.rpc("pending_applications");
  const applications = (data ?? []) as Application[];
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Membership</h1>
      <AdminNav current="applications" />
      <p className="text-slate-700">
        People who applied on the public Join page (<span className="font-mono text-sm">/join</span>). Accepting adds
        them as members, exactly like Add new member, with their membership awaiting payment. Declining deletes their
        details.
      </p>
      {params.saved === "decline" && <Notice message="Application declined and the details deleted." />}
      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-red-800" role="alert">
          {error}
        </p>
      )}
      {applications.length === 0 ? (
        <Card title="Nothing waiting">
          <p className="text-slate-600">There are no applications waiting.</p>
        </Card>
      ) : (
        applications.map((a) => (
          <Card key={a.id} title={`${a.contact_name}: ${a.type_name}`}>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Applied</dt>
                <dd>{ukDate(a.created_at)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Email</dt>
                <dd>{a.contact_email}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Membership</dt>
                <dd>
                  {a.type_name} ({a.club_year}), {pounds(a.price_pence)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Postcode</dt>
                <dd>{a.postcode}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">{a.people_count === 1 ? "Person" : `${a.people_count} people`}</dt>
                <dd>{a.people}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Medical information</dt>
                <dd>{a.has_medical ? "Given (visible on their member page once accepted)" : "None given"}</dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-slate-100 pt-4">
              <form action={acceptApplication}>
                <input type="hidden" name="id" value={a.id} />
                <SaveButton pendingText="Accepting…" aria-label={`Accept ${a.contact_name}`}>
                  Accept
                </SaveButton>
              </form>
              <form action={declineApplication} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={a.id} />
                <label className="block text-sm">
                  <span className="font-medium">Reason (optional)</span>
                  <input name="reason" className="mt-1 block rounded border border-slate-300 bg-white px-3 py-2" />
                </label>
                <SaveButton variant="secondary" pendingText="Declining…" aria-label={`Decline ${a.contact_name}`}>
                  Decline
                </SaveButton>
              </form>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
