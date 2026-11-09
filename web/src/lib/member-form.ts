import { text } from "./me";

const PERSON_FIELDS = [
  "title", "first_name", "last_name", "date_of_birth", "email", "mobile",
  "emergency_contact_name", "emergency_contact_mobile", "medical_details",
];

// The people on an Add new member or Join form (fields p0_..., p1_... from PersonFields).
export function peopleFromForm(form: FormData) {
  const count = Math.min(Math.max(Number(form.get("people_count") ?? 1), 1), 4);
  return Array.from({ length: count }, (_, i) => {
    const key = (f: string) => `p${i}_${f}`;
    const person: Record<string, unknown> = Object.fromEntries(PERSON_FIELDS.map((f) => [f, text(form, key(f))]));
    person.whatsapp = form.get(key("whatsapp")) === "on";
    person.medical_consent = form.get(key("medical_consent")) === "on";
    person.news_consent = form.get(key("news_consent")) === "on";
    person.directory_opt_out = form.get(key("directory_listed")) !== "on";
    person.qualifications = form
      .getAll(key("qual_name"))
      .map((name, j) => ({
        name: String(name).trim(),
        awarded_on: String(form.getAll(key("qual_awarded"))[j] ?? "") || null,
        expires_on: String(form.getAll(key("qual_expires"))[j] ?? "") || null,
      }))
      .filter((q) => q.name);
    return person;
  });
}
