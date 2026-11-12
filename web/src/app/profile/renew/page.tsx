import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, SaveButton } from "@/components/fields";
import { pounds, requireMe } from "@/lib/me";
import { typeDates } from "@/lib/quote";
import { renewMemberships } from "../actions";

type Type = { id: string; name: string; cover: string; annual_price_pence: number; starts_on: string; ends_on: string };
type Person = { id: string; first_name: string; last_name: string };

// Step 2 of renewing: check the choice and confirm personal details are up to date before renewing.
export default async function ConfirmRenewalPage({ searchParams }: PageProps<"/profile/renew">) {
  const params = await searchParams;
  const { supabase } = await requireMe();
  const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);
  const typeId = list(params.type_id)[0] ?? "";
  const remaining = list(params.remaining)[0] ?? "0";
  const personIds = list(params.person);
  if (!typeId) redirect("/profile#renew");
  if (personIds.length === 0) redirect("/profile?error=who#renew");

  const [{ data: typeData }, { data: peopleData }] = await Promise.all([
    supabase.from("membership_types").select("id, name, cover, annual_price_pence, starts_on, ends_on").eq("id", typeId).maybeSingle(),
    supabase.from("people").select("id, first_name, last_name").in("id", personIds),
  ]);
  const type = typeData as Type | null;
  if (!type) redirect("/profile?error=unavailable#renew");
  const people = (peopleData ?? []) as Person[];
  const names = personIds
    .map((id) => people.find((p) => p.id === id))
    .filter(Boolean)
    .map((p) => `${p!.first_name} ${p!.last_name}`)
    .join(", ");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Renew your membership</h1>
      <Card title="Your renewal">
        <p>
          <strong>{type.cover === "junior" ? "Junior" : type.name}</strong> for {names}: {pounds(type.annual_price_pence)}
        </p>
        <p className="mt-1 text-sm text-slate-600">{typeDates(type)}</p>
      </Card>
      <Card title="Are your personal details up to date?">
        <p className="text-slate-700">
          Please check your contact details, address, medical information and preferences
          {personIds.length > 1 && ", and your family's"} on Your details before you renew.
        </p>
        <form action={renewMemberships} className="mt-4 flex flex-wrap items-center gap-4">
          <input type="hidden" name="type_id" value={type.id} />
          <input type="hidden" name="remaining" value={remaining} />
          <input type="hidden" name="confirm" value="on" />
          {personIds.map((id) => (
            <input key={id} type="hidden" name="person" value={id} />
          ))}
          <SaveButton pendingText="Renewing…">Yes, they&apos;re up to date. Renew</SaveButton>
          <Link href="/profile" className="text-sky-800 underline">
            No, I need to update them first
          </Link>
        </form>
      </Card>
    </div>
  );
}
