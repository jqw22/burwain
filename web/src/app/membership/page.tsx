import { redirect } from "next/navigation";

// Members renew from Your details; joining and changing membership type are done by club admins.
export default function MembershipPage() {
  redirect("/profile#renew");
}
