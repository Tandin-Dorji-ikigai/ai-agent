import type { Metadata } from "next";
import { YdfView } from "@/components/ydf-view";

export const metadata: Metadata = { title: "YDF | Mentoring Agent" };

export default function YdfPage() {
  return <YdfView />;
}
