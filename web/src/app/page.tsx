import Link from "next/link";
import { Card } from "@/components/fields";
import { shortDate, startTime, typeInfo, type CalendarEvent } from "@/lib/calendar";
import type { NewsPost } from "@/lib/news";
import { ukToday } from "@/lib/quote";
import { createClient } from "@/lib/supabase/server";
import { addPostLink, NewsList } from "./news/news-list";

const LATEST = 5;
const COMING_UP = 5;

// Home is where everyone lands after signing in.
export default async function HomePage({ searchParams }: PageProps<"/">) {
  const { news } = await searchParams;
  const supabase = await createClient();

  // First sign-in: attach this login to the member record with the same email.
  const { data: personId } = await supabase.rpc("link_my_account");

  if (!personId) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
        <h1 className="text-xl font-semibold">We couldn&apos;t find your membership</h1>
        <p className="mt-2 text-slate-700">
          You&apos;re signed in, but this email address doesn&apos;t match a member record. Please
          contact the membership secretary so they can link your account.
        </p>
      </div>
    );
  }

  const [{ data: me }, { data: isAdmin }, { data: posts, count }, { data: eventData }] = await Promise.all([
    supabase.from("people").select("first_name").eq("id", personId).single(),
    supabase.rpc("has_role", { r: "admin" }),
    supabase
      .from("news_posts")
      .select("id, title, body, pinned, created_at, updated_at", { count: "exact" })
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(LATEST),
    supabase
      .from("calendar_events")
      .select("id, event_type, title, event_date, start_time")
      .gte("event_date", ukToday())
      .order("event_date")
      .order("start_time")
      .limit(COMING_UP),
  ]);
  const events = (eventData ?? []) as CalendarEvent[];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Welcome to Burwain{me?.first_name ? `, ${me.first_name}` : ""}</h1>
      {news && (
        <p className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-900" role="status">
          {news === "deleted" ? "News post deleted." : "News post saved."}
        </p>
      )}
      {/* Club news takes two thirds of the width on a computer; the next 5 calendar events sit beside it. */}
      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2">
          <Card title="Club news" action={isAdmin ? addPostLink : undefined}>
            <NewsList posts={(posts ?? []) as NewsPost[]} isAdmin={Boolean(isAdmin)} />
            {(count ?? 0) > LATEST && (
              <p className="mt-4 border-t border-slate-200 pt-3">
                <Link href="/news" className="text-sm font-medium text-sky-800 underline underline-offset-2 hover:text-sky-950">
                  Older news
                </Link>
              </p>
            )}
          </Card>
        </div>
        <div>
          <Card title="Coming up">
            {events.length === 0 ? (
              <p className="text-sm text-slate-500">No upcoming events on the calendar yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {events.map((e) => (
                  <li key={e.id} className="py-2 first:pt-0">
                    <Link href={`/calendar#event-${e.id}`} className="group block">
                      <p className="text-sm text-slate-600">
                        {shortDate(e.event_date)} · {startTime(e.start_time)}
                        <span className={`ml-2 rounded px-1.5 py-0.5 text-xs font-medium ${typeInfo(e.event_type).badge}`}>
                          {typeInfo(e.event_type).label}
                        </span>
                      </p>
                      <p className="font-medium group-hover:text-sky-900 group-hover:underline">{e.title}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 border-t border-slate-200 pt-3">
              <Link href="/calendar" className="text-sm font-medium text-sky-800 underline underline-offset-2 hover:text-sky-950">
                Full calendar
              </Link>
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
