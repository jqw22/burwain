"use client";

import { useRef, useState } from "react";
import { uploadEmailImage } from "@/app/admin/emails/image-actions";

const MAX_WIDTH = 1200;

// Makes a photo smaller in the browser (at most 1200 pixels wide) so emails stay quick to open.
// GIFs are left alone so animations keep working.
async function shrink(file: File): Promise<File> {
  if (file.type === "image/gif" || !file.type.startsWith("image/")) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  if (bitmap.width <= MAX_WIDTH && file.size < 500_000) return file;
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  return blob ? new File([blob], file.name, { type }) : file;
}

// "Add image" button: uploads a picture and hands back its web address.
export function ImageButton({ onUploaded, label = "Add image", logo = false }: { onUploaded: (url: string) => void; label?: string; logo?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function chosen(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("image", await shrink(file));
    if (logo) form.set("logo", "on");
    const result = await uploadEmailImage(form).catch(() => ({ ok: false as const, error: "We couldn't upload that picture. Please try again." }));
    setBusy(false);
    if (input.current) input.current.value = "";
    if (result.ok) onUploaded(result.url);
    else setError(result.error);
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="sr-only"
        aria-label={label}
        onChange={(e) => chosen(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="rounded border border-slate-400 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:border-sky-800 hover:bg-sky-50 disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? "Uploading…" : label}
      </button>
      {error && (
        <span className="text-sm text-red-800" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

// Puts an image line into a textarea's text where the cursor is (or at the end), on its own paragraph.
export function insertAtCursor(textarea: HTMLTextAreaElement | null, text: string, insert: string) {
  const at = textarea?.selectionStart ?? text.length;
  const before = text.slice(0, at).replace(/\s*$/, "");
  const after = text.slice(at).replace(/^\s*/, "");
  return `${before}${before ? "\n\n" : ""}${insert}${after ? "\n\n" : ""}${after}`;
}
