import Link from "next/link";
import { NotAllowed } from "@/components/admin";
import { meWithRole } from "@/lib/me";
import { NewsError } from "../errors";
import { NewsForm } from "../news-form";

export default async function NewNewsPostPage({ searchParams }: PageProps<"/news/new">) {
  const { error } = await searchParams;
  const { allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;
  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-slate-600 underline underline-offset-2 hover:text-sky-900">
          ← Back to Home
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Add a news post</h1>
        <p className="mt-1 text-sm text-slate-600">Everyone who is signed in will see it in Club news on the Home page.</p>
      </div>
      <NewsError error={error} />
      <NewsForm post={null} />
    </div>
  );
}
