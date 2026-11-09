"use client";

import { useState } from "react";
import { Card, Checkbox, Field } from "./fields";

export const addButton =
  "rounded border border-slate-400 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:border-sky-800 hover:bg-sky-50 hover:text-sky-900";

// True once the form has been submitted (and came back with an error).
const submitted = (values: Record<string, string>) => "people_count" in values;

// Everything Your details collects for one person: details, medical information, qualifications, preferences.
export function PersonFields({
  index,
  title,
  values,
  withAddress,
  audience = "admin",
}: {
  index: number;
  title: string;
  values: Record<string, string>;
  withAddress: boolean;
  // "public" is the Join page, written to the person filling it in.
  audience?: "admin" | "public";
}) {
  const you = audience === "public";
  const k = (f: string) => `p${index}_${f}`;
  const v = (f: string) => values[k(f)];
  const [quals, setQuals] = useState(1);

  return (
    <Card title={title}>
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" name={k("title")} defaultValue={v("title")} />
          <div className="hidden sm:block" />
          <Field label="First name" name={k("first_name")} required defaultValue={v("first_name")} />
          <Field label="Last name" name={k("last_name")} required defaultValue={v("last_name")} />
          {withAddress && (
            <>
              <Field label="Address line 1" name="address_line1" required defaultValue={values.address_line1} />
              <Field label="Address line 2" name="address_line2" defaultValue={values.address_line2} />
              <Field label="Town" name="address_line3" defaultValue={values.address_line3} />
              <Field label="County" name="address_line4" defaultValue={values.address_line4} />
              <Field label="Postcode" name="postcode" required defaultValue={values.postcode} />
              <div className="hidden sm:block" />
            </>
          )}
          <Field label="Date of birth" name={k("date_of_birth")} type="date" defaultValue={v("date_of_birth")} hint="Needed for junior and U21 memberships." />
          <Field label="Email" name={k("email")} type="email" defaultValue={v("email")} hint={you ? "Adults: we'll contact you here, and it becomes your login." : "Adults: they log in with this email."} />
          <Field label="Mobile" name={k("mobile")} type="tel" defaultValue={v("mobile")} />
          <div className="self-end pb-2">
            <Checkbox label="Happy to be contacted on WhatsApp" name={k("whatsapp")} defaultChecked={v("whatsapp") === "on"} />
          </div>
          <Field label="Emergency contact name" name={k("emergency_contact_name")} defaultValue={v("emergency_contact_name")} />
          <Field label="Emergency contact mobile" name={k("emergency_contact_mobile")} type="tel" defaultValue={v("emergency_contact_mobile")} />
        </div>

        <div className="space-y-2 border-t border-slate-100 pt-4">
          <h3 className="font-medium">Medical information</h3>
          <label className="block">
            <span className="text-sm font-medium">Medical details</span>
            <textarea
              name={k("medical_details")}
              defaultValue={v("medical_details") ?? ""}
              rows={3}
              className="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2"
            />
            <span className="mt-1 block text-xs text-slate-500">
              Anything the club should know in an emergency. Only the member, their family&apos;s main contact and club admins can see it.
            </span>
          </label>
          <Checkbox
            label={you ? "I agree to the club holding this information" : "The member agrees to the club holding this information"}
            name={k("medical_consent")}
            defaultChecked={v("medical_consent") === "on"}
          />
        </div>

        <div className="space-y-2 border-t border-slate-100 pt-4">
          <h3 className="font-medium">Qualifications</h3>
          {Array.from({ length: quals }, (_, j) => (
            <div key={j} className="grid gap-4 sm:grid-cols-3">
              <Field label="Qualification" name={k("qual_name")} />
              <Field label="Awarded" name={k("qual_awarded")} type="date" />
              <Field label="Expires" name={k("qual_expires")} type="date" />
            </div>
          ))}
          {quals < 5 && (
            <button type="button" className={addButton} onClick={() => setQuals(quals + 1)}>
              Add another qualification
            </button>
          )}
        </div>

        <div className="space-y-2 border-t border-slate-100 pt-4">
          <h3 className="font-medium">Communication preferences</h3>
          {/* Both ticked to start with; after a failed save, keep what was chosen. */}
          <Checkbox
            label="Happy to receive club news by email"
            name={k("news_consent")}
            defaultChecked={submitted(values) ? v("news_consent") === "on" : true}
          />
          <Checkbox
            label="Happy to be added to the club directory"
            name={k("directory_listed")}
            defaultChecked={submitted(values) ? v("directory_listed") === "on" : true}
          />
        </div>
      </div>
    </Card>
  );
}
