import Link from "next/link";
import { Card } from "@/components/fields";
import { requireMe } from "@/lib/me";

type Entry = { id: string; first_name: string; last_name: string; mobile: string | null; email: string | null; membership: string };

export default async function DirectoryPage() {
  const { supabase } = await requireMe();
  const { data } = await supabase.rpc("member_directory");
  const entries = (data ?? []) as Entry[];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Member directory</h1>
      <p className="text-slate-700">
        Adult members this year who are happy to be listed. To hide your own details, untick the directory option in{" "}
        <Link href="/profile?edit=preferences#preferences" className="text-sky-800 underline">
          your communication preferences
        </Link>
        .
      </p>
      <Card title={`${entries.length} ${entries.length === 1 ? "member" : "members"}`}>
        {entries.length === 0 ? (
          <p className="text-slate-600">No one is listed yet.</p>
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
