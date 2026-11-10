import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Entrepreneur | Mentoring Agent" };

export default function EntrepreneurPage() {
  redirect("/entrepreneur/connect");
}
