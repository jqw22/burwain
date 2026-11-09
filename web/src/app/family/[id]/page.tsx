import { redirect } from "next/navigation";

export default async function OldFamilyMemberPage({ params }: PageProps<"/family/[id]">) {
  const { id } = await params;
  redirect(`/profile/member/${id}`);
}
