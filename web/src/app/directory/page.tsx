import Link from "next/link";
import { Card, SaveButton } from "@/components/fields";
import { requireMe } from "@/lib/me";

type Entry = { id: string; first_name: string; last_name: string; mobile: string | null; email: string | null; membership: string };

export default async function DirectoryPage({ searchParams }: PageProps<"/directory">) {
  const params = await searchParams;
  const q = (typeof params.q === "string" ? params.q : "").trim().slice(0, 100);
  const { supabase } = await requireMe();
  const { data } = await supabase.rpc("member_directory");
  const all = (data ?? []) as Entry[];
  // Search matches any part of the name, mobile, email or membership type, ignoring case and spaces in numbers.
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const entries = all.filter((e) => {
    const haystack = [e.first_name, e.last_name, e.email, e.mobile, e.mobile?.replace(/\s/g, ""), e.membership].join(" ").toLowerCase();
    return words.every((w) => haystack.includes(w));
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Member directory</h1>
      <p className="text-slate-700">Adult members this year, and anyone who has joined for next year.</p>
      <form className="flex gap-2" role="search">
        <label className="sr-only" htmlFor="q">Search the directory</label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search by name, mobile, email or membership"
          className="w-full rounded border border-slate-300 bg-white px-3 py-2"
        />
        <SaveButton pendingText="Searching…">Search</SaveButton>
      </form>
      <Card
        title={q ? `${entries.length} of ${all.length} members matching \u201c${q}\u201d` : `${all.length} ${all.length === 1 ? "member" : "members"}`}
        action={q ? <Link href="/directory" className="text-sm text-sky-800 underline">Clear search</Link> : undefined}
      >
        {entries.length === 0 ? (
          <p className="text-slate-600">{q ? "No one matches that search." : "No one is listed yet."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-600">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Mobile</th>
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2">Membership</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 pr-4">
                      {e.last_name}, {e.first_name}
                    </td>
                    <td className="py-2 pr-4">{e.mobile}</td>
                    <td className="py-2 pr-4">
                      {e.email && (
                        <a href={`mailto:${e.email}`} className="text-sky-800 underline">
                          {e.email}
                        </a>
                      )}
                    </td>
                    <td className="py-2">{e.membership}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
