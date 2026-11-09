import Link from "next/link";
import { sendLoginLink } from "./actions";

const ERRORS: Record<string, string> = {
  email: "Please enter a valid email address.",
  send: "We couldn't send the login link. Please try again in a minute.",
  link: "That login link has expired or was already used. Please request a new one.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const sent = params.sent === "1";
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;

  return (
    <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold">Sign in</h1>
      {sent ? (
        <p className="mt-4 text-slate-700" role="status">
          Check your email for a login link. It works once and expires after an hour.
        </p>
      ) : (
        <>
          <p className="mt-2 text-slate-600">
            Enter the email address the club has for you and we&apos;ll send you a login link.
          </p>
          {error && (
            <p className="mt-4 rounded bg-red-50 p-3 text-red-800" role="alert">
              {error}
            </p>
          )}
          <form action={sendLoginLink} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium">Email address</span>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <button
              type="submit"
              className="w-full rounded bg-sky-800 px-4 py-2 font-medium text-white hover:bg-sky-900"
            >
              Email me a login link
            </button>
          </form>
          <p className="mt-6 text-sm text-slate-600">
            Not a member yet?{" "}
            <Link href="/join" className="text-sky-800 underline">
              Join Burwain
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
