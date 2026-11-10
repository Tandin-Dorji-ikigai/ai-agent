import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Mentor | Mentoring Agent" };

export default function MentorPage() {
  redirect("/mentor/dashboard");
}
