// Placeholders admins can use in email templates. Each is filled in per member when an email is sent.
export const PLACEHOLDERS = [
  { key: "first_name", label: "Member's first name", example: "Sam" },
  { key: "last_name", label: "Member's last name", example: "Example" },
  { key: "membership_type", label: "Their current membership type", example: "Family" },
  { key: "renewal_year", label: "The year they're renewing for", example: "2027" },
  { key: "renewal_price", label: "What renewing will cost", example: "£255" },
  { key: "renewal_link", label: "Link to log in and renew", example: "https://burwain.netlify.app/profile#renew" },
] as const;

export const PURPOSES = {
  renewal_reminder: "Renewal reminder",
  general: "General",
} as const;
export type Purpose = keyof typeof PURPOSES;

const PATTERN = /\{([a-z_]+)\}/g;

// Replaces {placeholders} with values; unknown ones are left as they are.
export function fillPlaceholders(text: string, values: Record<string, string>) {
  return text.replace(PATTERN, (whole, key: string) => values[key] ?? whole);
}

// Placeholders in the text that the app doesn't know, e.g. a typo like {firstname}.
export function unknownPlaceholders(text: string) {
  const known = new Set<string>(PLACEHOLDERS.map((p) => p.key));
  return [...new Set([...text.matchAll(PATTERN)].map((m) => m[1]))].filter((k) => !known.has(k));
}

export function exampleValues(overrides: Partial<Record<string, string>> = {}) {
  return { ...Object.fromEntries(PLACEHOLDERS.map((p) => [p.key, p.example])), ...overrides } as Record<string, string>;
}
