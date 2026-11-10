import type { Metadata } from "next";
import { AccessForm } from "./access-form";

export const metadata: Metadata = { title: "Enter the demo · MentorFlow" };

export default function AccessPage() {
  return <AccessForm />;
}
