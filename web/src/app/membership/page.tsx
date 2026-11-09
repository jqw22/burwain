import { redirect } from "next/navigation";

// Members renew from Your details; joining and changing membership type are done by club admins.
// The old join page is kept in _kept/ for a future self-join process.
export default function MembershipPage() {
  redirect("/profile#renew");
}
