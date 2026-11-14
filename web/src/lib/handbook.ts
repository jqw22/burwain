import "server-only";
import sanitizeHtml from "sanitize-html";

export type HandbookSection = { slug: string; title: string; body: string; updated_at: string };

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h3", "h4", "p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a",
    "table", "thead", "tbody", "tr", "th", "td", "blockquote",
  ],
  allowedAttributes: { a: ["href"], ol: ["start", "type"] },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  transformTags: {
    // The section title is the main heading, so any headings typed or pasted in become sub-headings.
    h1: "h3",
    h2: "h3",
    h5: "h4",
    h6: "h4",
    div: "p",
    b: "strong",
    i: "em",
  },
  // Drop empty paragraphs and headings (left behind by pasting or pressing Enter twice).
  exclusiveFilter: (frame) => ["p", "h3", "h4"].includes(frame.tag) && !frame.text.trim(),
};

// Only simple formatting survives: headings, paragraphs, bold/italic/underline, lists, links and tables.
// Anything else (scripts, styles, pasted fonts and colours) is stripped before saving.
export function cleanHandbookHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS).trim();
}

// The same cleaning when showing a section, with links opening in a new tab.
export function handbookHtmlForDisplay(html: string): string {
  return sanitizeHtml(html, {
    ...OPTIONS,
    allowedAttributes: { ...OPTIONS.allowedAttributes, a: ["href", "target", "rel"] },
    transformTags: {
      ...OPTIONS.transformTags,
      a: (tagName, attribs) => ({ tagName, attribs: { href: attribs.href ?? "", target: "_blank", rel: "noopener noreferrer" } }),
    },
  });
}
