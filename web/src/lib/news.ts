import "server-only";
import sanitizeHtml from "sanitize-html";
import { escapeHtml, IMAGE_PATTERN } from "@/lib/email";

export type NewsPost = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
};

// Pictures may only come from the club's own image store (uploaded with the Add image button).
const OWN_IMAGE = /^(https?:\/\/[^/\s"]+)?\/email-images\/[0-9a-f-]{36}$/i;

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h3", "h4", "p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a",
    "table", "thead", "tbody", "tr", "th", "td", "blockquote", "img",
  ],
  allowedAttributes: { a: ["href"], ol: ["start", "type"], img: ["src", "alt"] },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  transformTags: { h1: "h3", h2: "h3", h5: "h4", h6: "h4", div: "p", b: "strong", i: "em" },
  exclusiveFilter: (frame) =>
    (["p", "h3", "h4"].includes(frame.tag) && !frame.text.trim() && !frame.mediaChildren?.length) ||
    (frame.tag === "img" && !OWN_IMAGE.test(frame.attribs.src ?? "")),
};

// Only simple formatting and the club's own pictures survive; scripts, styles, fonts and colours go.
export function cleanNewsHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS).trim();
}

// The same cleaning when showing a post, with links opening in a new tab.
export function newsHtmlForDisplay(html: string): string {
  return sanitizeHtml(html, {
    ...OPTIONS,
    allowedAttributes: { ...OPTIONS.allowedAttributes, a: ["href", "target", "rel"] },
    transformTags: {
      ...OPTIONS.transformTags,
      a: (tagName, attribs) => ({ tagName, attribs: { href: attribs.href ?? "", target: "_blank", rel: "noopener noreferrer" } }),
    },
  });
}

// A shared page has no single reader, so the name placeholders in a group email are swapped for
// "members" ({first_name}) and dropped ({last_name}).
export function forEveryone(text: string) {
  return text
    .replace(/\{\s*first_name\s*\}/g, "members")
    .replace(/[ \t]*\{\s*last_name\s*\}/g, "");
}

function linkify(escaped: string) {
  return escaped.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}">${url}</a>`).replace(/\n/g, "<br>");
}

// A group email's plain text as a news post: paragraphs on blank lines, links, and [image: ...] pictures.
export function newsHtmlFromEmail(text: string) {
  const html = forEveryone(text)
    .trim()
    .split(/\n{2,}/)
    .map((para) => {
      const parts = para.split(IMAGE_PATTERN);
      // split() with a capture group gives text, url, text, url, ...
      return parts
        .map((part, i) => {
          if (i % 2 === 1) return `<p><img src="${escapeHtml(part)}" alt=""></p>`;
          const t = part.trim();
          return t ? `<p>${linkify(escapeHtml(t))}</p>` : "";
        })
        .join("");
    })
    .join("");
  return cleanNewsHtml(html);
}
