"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ImageButton, insertAtCursor } from "@/components/image-button";
import { SaveButton } from "@/components/save-button";
import { PLACEHOLDERS, PURPOSES, fillPlaceholders, imageMarker, textToHtml, unknownPlaceholders, withLogo } from "@/lib/email";
import { saveTemplate } from "./actions";

type Template = { id: string; name: string; purpose: string; subject: string; body: string };

const input = "mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2";

// Edit a template on the left, see it filled in with example member details on the right.
export function TemplateForm({ template, examples, logoUrl }: { template: Template | null; examples: Record<string, string>; logoUrl: string | null }) {
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const unknown = unknownPlaceholders(`${subject} ${body}`);
  const textarea = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form action={saveTemplate} aria-label={template ? `Edit ${template.name}` : "Add an email template"} className="space-y-4">
        <input type="hidden" name="id" value={template?.id ?? ""} />
        <label className="block">
          <span className="text-sm font-medium">Template name</span>
          <input name="name" required defaultValue={template?.name ?? ""} className={input} />
          <span className="mt-1 block text-xs text-slate-500">Only admins see this.</span>
        </label>
        <label className="block">
          <span className="text-sm font-medium">Used for</span>
          <select name="purpose" defaultValue={template?.purpose ?? "general"} className={input}>
            {Object.entries(PURPOSES).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-slate-500">Renewal reminders are sent from the Members list. You can have several, e.g. a first and a final reminder.</span>
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
          <span className="mt-1 block text-xs text-slate-500">Plain text. Leave a blank line between paragraphs. Links work as they are.</span>
        </label>
        <ImageButton onUploaded={(url) => setBody((b) => insertAtCursor(textarea.current, b, imageMarker(url)))} />
        {unknown.length > 0 && (
          <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
            Not recognised: {unknown.map((k) => `{${k}}`).join(", ")}. Please use one of the placeholders listed below.
          </p>
        )}
        <div className="flex items-center gap-4">
          <SaveButton>{template ? "Save template" : "Add template"}</SaveButton>
          <Link href="/admin/emails" className="text-sm text-slate-600 underline">Cancel</Link>
        </div>
        <details className="rounded border border-slate-200 p-3 text-sm" open>
          <summary className="cursor-pointer font-medium">Placeholders you can use</summary>
          <p className="mt-2 text-slate-600">Type these, including the curly brackets. Each is replaced with that member&apos;s details.</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {PLACEHOLDERS.map((p) => (
              <div key={p.key} className="contents">
                <dt className="font-mono">{`{${p.key}}`}</dt>
                <dd className="text-slate-700">{p.label}</dd>
              </div>
            ))}
          </dl>
        </details>
      </form>

      <section aria-label="Preview" className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-sm font-medium text-slate-600">Preview, with example member details</h3>
        <div className="mt-3 rounded border border-slate-200 bg-white p-4">
          <p className="border-b border-slate-100 pb-2 text-sm">
            <span className="text-slate-500">Subject: </span>
            <strong>{fillPlaceholders(subject, examples)}</strong>
          </p>
          {/* Built from escaped text by textToHtml, so it's safe to show as HTML. */}
          <div className="mt-3 break-words" dangerouslySetInnerHTML={{ __html: withLogo(textToHtml(fillPlaceholders(body, examples)), logoUrl) }} />
        </div>
      </section>
    </div>
  );
}
