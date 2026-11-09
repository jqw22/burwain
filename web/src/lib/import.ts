// Turns the club's member spreadsheet into rows for the import_members() database function.

export type ImportRow = {
  household_key: string;
  first_name: string;
  last_name: string;
  title: string | null;
  date_of_birth: string | null;
  email: string | null;
  mobile: string | null;
  whatsapp: boolean;
  emergency_contact_name: string | null;
  emergency_contact_mobile: string | null;
  address_line1: string | null;
  address_line2: string | null;
  address_line3: string | null;
  address_line4: string | null;
  postcode: string | null;
  member_class: string;
};

const COLUMNS = {
  first_name: "firstname",
  last_name: "lastname",
  title: "title",
  date_of_birth: "dob",
  address_line1: "address1",
  address_line2: "address2",
  address_line3: "address3",
  address_line4: "address4",
  postcode: "postcode",
  email: "email",
  mobile: "mobile",
  whatsapp: "whatsapp(y/n)",
  emergency_contact_name: "emergencycontactname",
  emergency_contact_mobile: "emergencycontactmobile",
  member_class: "memberclass",
} as const;

const squash = (v: unknown) => String(v ?? "").toLowerCase().replace(/\s+/g, "");

function cell(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Dates arrive as real dates from Excel, or as UK text such as 04/05/1980 or 4.5.80.
export function parseDob(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  // Excel dates come back as midnight UTC; adding 12 hours guards against small time-zone shifts.
  if (v instanceof Date) return isNaN(v.getTime()) ? undefined : new Date(v.getTime() + 12 * 3600 * 1000).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return isoDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (!m) return undefined;
  let year = Number(m[3]);
  if (m[3].length === 2) year += year > new Date().getFullYear() % 100 ? 1900 : 2000;
  const d = new Date(year, Number(m[2]) - 1, Number(m[1]));
  if (d.getDate() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1) return undefined;
  return isoDate(d);
}

export function parseMemberSheet(sheet: unknown[][], knownClasses: string[]) {
  const problems: string[] = [];
  const rows: ImportRow[] = [];
  if (sheet.length === 0) return { rows, problems: ["The spreadsheet is empty."] };

  const header = sheet[0].map(squash);
  const index = Object.fromEntries(
    Object.entries(COLUMNS).map(([key, title]) => [key, header.indexOf(title)]),
  ) as Record<keyof typeof COLUMNS, number>;
  const missing = (["first_name", "last_name", "member_class"] as const).filter((k) => index[k] < 0);
  if (missing.length) {
    return { rows, problems: [`Missing column(s): ${missing.map((k) => COLUMNS[k]).join(", ")}. Check the first row has the headings.`] };
  }
  const known = new Set(knownClasses.map((c) => c.toUpperCase()));

  sheet.slice(1).forEach((raw, i) => {
    const line = i + 2;
    const get = (k: keyof typeof COLUMNS) => (index[k] >= 0 ? cell(raw[index[k]]) : null);
    if (raw.every((v) => cell(v) === null)) return;

    const first = get("first_name");
    const last = get("last_name");
    const cls = get("member_class")?.toUpperCase() ?? "";
    const dob = parseDob(index.date_of_birth >= 0 ? raw[index.date_of_birth] : null);
    if (!first || !last) problems.push(`Row ${line}: first name and last name are needed.`);
    if (!known.has(cls)) problems.push(`Row ${line}: member class "${cls || "(blank)"}" isn't one of ${[...known].join(", ")}.`);
    if (dob === undefined) problems.push(`Row ${line}: can't read the date of birth "${get("date_of_birth")}". Use DD/MM/YYYY.`);

    const postcode = get("postcode")?.toUpperCase().replace(/\s+/g, " ") ?? null;
    const address1 = get("address_line1");
    const household_key =
      postcode || address1 ? `${squash(postcode)}|${squash(address1)}` : `row-${line}`;

    rows.push({
      household_key,
      first_name: first ?? "",
      last_name: last ?? "",
      title: get("title"),
      date_of_birth: dob ?? null,
      email: get("email")?.toLowerCase() ?? null,
      mobile: get("mobile"),
      whatsapp: /^y/i.test(get("whatsapp") ?? ""),
      emergency_contact_name: get("emergency_contact_name"),
      emergency_contact_mobile: get("emergency_contact_mobile"),
      address_line1: address1,
      address_line2: get("address_line2"),
      address_line3: get("address_line3"),
      address_line4: get("address_line4"),
      postcode,
      member_class: cls,
    });
  });

  if (rows.length === 0 && problems.length === 0) problems.push("No members found below the heading row.");
  return { rows, problems };
}

// Groups rows into families for the preview.
export function families(rows: ImportRow[]) {
  const map = new Map<string, ImportRow[]>();
  for (const r of rows) map.set(r.household_key, [...(map.get(r.household_key) ?? []), r]);
  return [...map.values()];
}
