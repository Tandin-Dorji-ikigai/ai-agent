import { notFound } from "next/navigation";
import { pageForPath, pagePaths } from "@/lib/mentorflow-routes";

// The screen stays mounted in the shared layout. This segment validates URL
// parameters and may wait for them; it has no separate instant page shell.
export const instant = false;

export function generateStaticParams() {
  return Object.values(pagePaths).filter(path => path !== "/").map(path => ({ screen: path.slice(1).split("/") }));
}

export default async function PrototypePage({ params }: { params: Promise<{ screen: string[] }> }) {
  const { screen } = await params;
  if (!pageForPath(`/${screen.join("/")}`)) notFound();
  return null;
}
