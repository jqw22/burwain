import Link from "next/link";
import { SectionText } from "@/app/handbook/section-text";
import { ukDate } from "@/lib/me";
import { newsHtmlForDisplay, type NewsPost } from "@/lib/news";

// Club news posts, pinned ones first then newest first. Each shows a few lines with Read more.
export function NewsList({ posts, isAdmin }: { posts: NewsPost[]; isAdmin: boolean }) {
  if (posts.length === 0) return <p className="text-slate-500">No club news yet.</p>;
  return (
    <ul className="divide-y divide-slate-200">
      {posts.map((p) => (
        <li key={p.id} id={`post-${p.id}`} className="scroll-mt-4 py-4 first:pt-0 last:pb-0">
          <article aria-label={p.title}>
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <h3 className="font-semibold text-slate-900">
                  {p.pinned && (
                    <span className="mr-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">Pinned</span>
                  )}
                  {p.title}
                </h3>
                <p className="text-sm text-slate-500">{ukDate(p.created_at)}</p>
              </div>
              {isAdmin && (
                <Link
                  href={`/news/${p.id}/edit`}
                  aria-label={`Edit ${p.title}`}
                  className="shrink-0 rounded border border-slate-400 px-3 py-1 text-sm font-medium text-slate-800 hover:border-sky-800 hover:bg-sky-50 hover:text-sky-900"
                >
                  Edit
                </Link>
              )}
            </div>
            <SectionText title={p.title} html={newsHtmlForDisplay(p.body)} />
          </article>
        </li>
      ))}
    </ul>
  );
}

export const addPostLink = (
  <Link
    href="/news/new"
    className="rounded border border-slate-400 px-3 py-1 text-sm font-medium text-slate-800 hover:border-sky-800 hover:bg-sky-50 hover:text-sky-900"
  >
    Add post
  </Link>
);
