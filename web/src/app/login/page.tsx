import Link from "next/link";
import { cookies } from "next/headers";
import { SaveButton } from "@/components/save-button";
import { resendCode, sendLoginLink, startAgain, verifyLoginCode } from "./actions";

const ERRORS: Record<string, string> = {
  email: "Please enter a valid email address.",
  send: "We couldn't send the login email. Please try again in a minute.",
  link: "That login link has expired, was already used, or was opened in a different browser. Please request a new one, or use the 6-digit code instead.",
  code: "That code didn't work. Check the 6 digits in your latest email, or send a new code.",
  resend: "We couldn't send a new code just yet. Please wait a minute and try again.",
  start: "Please enter your email address again.",
};

// Shows enough of the address to spot a typo or the wrong autofill, e.g. "ha•••@icloud.com".
function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}${"•".repeat(3)}@${domain}`;
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const email = (await cookies()).get("login_email")?.value;
  const sent = params.sent === "1" && !!email;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;

  return (
    <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold">Sign in</h1>
      {error && (
        <p className="mt-4 rounded bg-red-50 p-3 text-red-800" role="alert">
          {error}
        </p>
      )}
      {sent && email ? (
        <>
          <p className="mt-4 text-slate-700" role="status">
            We&apos;ve emailed a 6-digit code to <strong>{maskEmail(email)}</strong>.
            {params.resent === "1" && " A new code is on its way."}
          </p>
          <form action={verifyLoginCode} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium">6-digit code</span>
              <input
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                required
                autoFocus
                className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-center font-mono text-2xl tracking-[0.5em]"
              />
            </label>
            <div className="[&>button]:w-full [&>button]:justify-center">
              <SaveButton pendingText="Signing in…">Sign in</SaveButton>
            </div>
          </form>
          <p className="mt-4 text-sm text-slate-600">
            The code works once and lasts an hour. You can also click the link in the same email, but
            only in this browser.
          </p>
          <div className="mt-6 flex flex-wrap gap-4">
            <form action={resendCode}>
              <SaveButton variant="link" pendingText="Sending…">
                Send a new code
              </SaveButton>
            </form>
            <form action={startAgain}>
              <SaveButton variant="link" pendingText="…">
                Use a different email
              </SaveButton>
            </form>
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-slate-600">
            Enter the email address the club has for you and we&apos;ll email you a 6-digit code.
          </p>
          <form action={sendLoginLink} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium">Email address</span>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                defaultValue={email}
                className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <div className="[&>button]:w-full [&>button]:justify-center">
              <SaveButton pendingText="Sending…">Email me a code</SaveButton>
            </div>
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
