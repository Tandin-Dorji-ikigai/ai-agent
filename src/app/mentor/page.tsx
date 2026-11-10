import type { Metadata } from "next";
import { MentorView } from "@/components/mentor-view";

export const metadata: Metadata = { title: "Mentor | Mentoring Agent" };

export default function MentorPage() {
  return <MentorView />;
}
