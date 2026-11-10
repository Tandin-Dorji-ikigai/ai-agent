import type { Metadata } from "next";
import { EntrepreneurView } from "@/components/entrepreneur-view";

export const metadata: Metadata = { title: "Entrepreneur | Mentoring Agent" };

export default function EntrepreneurPage() {
  return <EntrepreneurView />;
}
