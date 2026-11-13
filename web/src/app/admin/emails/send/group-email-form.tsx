"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { ImageButton, insertAtCursor } from "@/components/image-button";
import { SaveButton } from "@/components/save-button";
import { fillPlaceholders, groupEmailHtml, imageMarker, unknownGroupPlaceholders } from "@/lib/email";
import { sendGroupEmail, sendGroupTest, type GroupRecipient, type SendState } from "./actions";

type Template = { id: string; name: string; subject: string; body: string };
type Status = GroupRecipient["status"];

const STATUS: Record<Status, { label: string; style: string }> = {
  current: { label: "Current", style: "bg-emerald-50 text-emerald-900" },
  future: { label: "Future", style: "bg-sky-50 text-sky-900" },
  lapsed: { label: "Lapsed", style: "bg-slate-100 text-slate-700" },
  contact: { label: "Contact", style: "bg-amber-50 text-amber-900" },
};
const GROUPS: { key: Status; label: string }[] = [
  { key: "current", label: "Current members" },
  { key: "future", label: "Future members" },
  { key: "lapsed", label: "Lapsed members" },
  { key: "contact", label: "Contacts" },
];

const input = "mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2";
const smallButton = "rounded border border-slate-300 bg-white px-2.5 py-1 text-sm text-slate-800 hover:border-sky-800 hover:bg-sky-50";

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} aria-label={title} className="scroll-mt-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Result({ state }: { state: SendState }) {
  if (!state) return null;
  return state.ok ? (
    <p className="flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 p-3 font-medium text-emerald-900" role="status">
      <span aria-hidden="true">✓</span>
      {state.message}
    </p>
  ) : (
    <p className="rounded border border-red-300 bg-red-50 p-3 text-red-800" role="alert">
      {state.message}
    </p>
  );
}

export function GroupEmailForm({
  templates,
  recipients,
  logoUrl,
  enabled,
}: {
  templates: Template[];
  recipients: GroupRecipient[];
  logoUrl: string | null;
  enabled: boolean;
}) {
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [previewId, setPreviewId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [testState, testAction] = useActionState(sendGroupTest, null);
  const [sendState, sendAction] = useActionState(async (prev: SendState, form: FormData) => {
    const result = await sendGroupEmail(prev, form);
    // After a successful send, untick everyone so the same email isn't sent twice by mistake.
    if (result?.ok) {
      setTicked(new Set());
      setConfirming(false);
    }
    return result;
  }, null);

  const subscribed = useMemo(() => recipients.filter((r) => !r.unsubscribed_at), [recipients]);
  const q = search.trim().toLowerCase();
  const shown = recipients.filter((r) => !q || `${r.first_name} ${r.last_name} ${r.email}`.toLowerCase().includes(q));
  const chosen = subscribed.filter((r) => ticked.has(r.person_id));
  const addresses = new Set(chosen.map((r) => r.email.trim().toLowerCase())).size;
  const preview = chosen.find((r) => r.person_id === previewId) ?? chosen[0] ?? null;
  const unknown = unknownGroupPlaceholders(`${subject} ${body}`);

  function chooseTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    setSubject(t?.subject ?? "");
    setBody(t?.body ?? "");
  }
  const setMany = (ids: string[], on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  const groupIds = (s: Status) => subscribed.filter((r) => r.status === s).map((r) => r.person_id);

  const values = preview ? { first_name: preview.first_name, last_name: preview.last_name } : { first_name: "Sam", last_name: "Example" };
  const previewHtml = groupEmailHtml(fillPlaceholders(body, values), { logoUrl, unsubscribeUrl: "#unsubscribe" });

  return (
    <form className="space-y-6" aria-label="Group email">
      <input type="hidden" name="template" value={templateId} />
      {preview && <input type="hidden" name="preview" value={preview.person_id} />}
      {chosen.map((r) => (
        <input key={r.person_id} type="hidden" name="p" value={r.person_id} />
      ))}

      <Section title="1. Write the email">
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium">Start from</span>
            <select value={templateId} onChange={(e) => chooseTemplate(e.target.value)} className={input}>
              <option value="">A blank email</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  Template: {t.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              A template fills in the subject and message for you. You can change them here; the saved template stays as it is.
            </span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Subject</span>
            <input name="subject" required value={subject} onChange={(e) => setSubject(e.target.value)} className={input} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Message</span>
            <textarea
              ref={textarea}
              name="body"
              required
              rows={14}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className={`${input} font-mono text-sm`}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <ImageButton onUploaded={(url) => setBody((b) => insertAtCursor(textarea.current, b, imageMarker(url)))} />
            <span className="text-xs text-slate-500">
              Plain text. Leave a blank line between paragraphs. Use {"{first_name}"} and {"{last_name}"} for each person&apos;s name. An unsubscribe link is
              added at the bottom automatically{logoUrl ? ", and the club logo at the top" : ""}.
            </span>
          </div>
          {unknown.length > 0 && (
            <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
              Group emails can only use {"{first_name}"} and {"{last_name}"}. Please remove {unknown.map((k) => `{${k}}`).join(", ")}.
            </p>
          )}
        </div>
      </Section>

      <Section title={`2. Choose who gets it (${chosen.length} ticked)`}>
        <p className="mb-3 text-sm text-slate-600">
          Members (current, future and lapsed) and contacts. Juniors and people without an email address aren&apos;t listed.
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Tick groups">
          <button type="button" className={smallButton} onClick={() => setMany(subscribed.map((r) => r.person_id), true)}>
            Tick everyone ({subscribed.length})
          </button>
          {GROUPS.map((g) => (
            <button key={g.key} type="button" className={smallButton} onClick={() => setMany(groupIds(g.key), true)}>
              + {g.label} ({groupIds(g.key).length})
            </button>
          ))}
          <button type="button" className={smallButton} onClick={() => setTicked(new Set())}>
            Untick all
          </button>
        </div>
        <label className="mb-3 block max-w-sm">
          <span className="sr-only">Search people</span>
          <input type="search" placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} className={input} />
        </label>
        <div className="max-h-[28rem] overflow-auto rounded border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-slate-600">
              <tr>
                <th className="w-10 py-2 pl-3">
                  <span className="sr-only">Send</span>
                </th>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-3">
                  <span className="sr-only">Preview</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((r) => {
                const name = `${r.first_name} ${r.last_name}`;
                const on = ticked.has(r.person_id) && !r.unsubscribed_at;
                return (
                  <tr key={r.person_id} aria-label={name} className={preview?.person_id === r.person_id ? "bg-sky-50" : undefined}>
                    <td className="py-2 pl-3">
                      <input
                        type="checkbox"
                        aria-label={`Send to ${name}`}
                        checked={on}
                        disabled={Boolean(r.unsubscribed_at)}
                        onChange={(e) => setMany([r.person_id], e.target.checked)}
                      />
                    </td>
                    <td className="py-2 pr-4 font-medium">{name}</td>
                    <td className="py-2 pr-4">{r.email}</td>
                    <td className="py-2 pr-4">
                      {r.unsubscribed_at ? (
                        <span className="rounded bg-red-50 px-2 py-0.5 text-red-800">Unsubscribed</span>
                      ) : (
                        <span className={`rounded px-2 py-0.5 ${STATUS[r.status].style}`}>{STATUS[r.status].label}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {on && (
                        <button type="button" className="text-sky-800 underline" onClick={() => setPreviewId(r.person_id)} aria-label={`Preview for ${name}`}>
                          Preview
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-3 text-slate-600">
                    Nobody matches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={preview ? `3. Preview: ${preview.first_name} ${preview.last_name}` : "3. Preview"} id="preview">
        <div className="rounded border border-slate-200 bg-white p-4">
          <p className="border-b border-slate-100 pb-2 text-sm">
            <span className="text-slate-500">To: </span>
            {preview?.email ?? "(tick someone to see their email)"}
            <br />
            <span className="text-slate-500">Subject: </span>
            <strong>{fillPlaceholders(subject, values)}</strong>
          </p>
          {/* Built from escaped text by groupEmailHtml, so it's safe to show as HTML. */}
          <div className="mt-3 break-words" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
        {enabled && (
          <div className="mt-4 space-y-3">
            <SaveButton variant="secondary" pendingText="Sending test…" formAction={testAction}>
              Send this as a test to me
            </SaveButton>
            <Result state={testState} />
          </div>
        )}
      </Section>

      <Section title="4. Send">
        {!enabled ? (
          <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Sending isn&apos;t switched on yet. It starts working once the club&apos;s email service (Resend) is set up.
          </p>
        ) : (
          <div className="space-y-3">
            <Result state={sendState} />
            {!confirming ? (
              <button
                type="button"
                disabled={addresses === 0 || !subject.trim() || !body.trim() || unknown.length > 0}
                onClick={() => setConfirming(true)}
                className="rounded bg-sky-800 px-4 py-2 font-medium text-white hover:bg-sky-950 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                Send to {addresses} {addresses === 1 ? "person" : "people"}
              </button>
            ) : (
              <div className="space-y-3 rounded border border-amber-300 bg-amber-50 p-4" role="alertdialog" aria-label="Confirm sending">
                <p className="font-medium text-amber-950">
                  You&apos;re about to email {addresses} {addresses === 1 ? "person" : "people"}. Emails can&apos;t be unsent once they&apos;ve gone.
                </p>
                <div className="flex items-center gap-4">
                  <SaveButton pendingText="Sending…" formAction={sendAction}>
                    Yes, send now
                  </SaveButton>
                  <button type="button" className="text-sm text-slate-700 underline" onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {chosen.length > addresses && (
              <p className="text-sm text-slate-600">
                Some ticked people share an email address, so they&apos;ll get one copy between them.
              </p>
            )}
          </div>
        )}
      </Section>
    </form>
  );
}
