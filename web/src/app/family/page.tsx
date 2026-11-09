import { redirect } from "next/navigation";

// The family now lives on the Your details page.
export default function FamilyPage() {
  redirect("/profile#family");
}
