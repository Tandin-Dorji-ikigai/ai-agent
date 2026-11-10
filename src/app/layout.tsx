import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense, type ReactNode } from "react";
import { DemoStateProvider } from "@/components/demo-state";
import MentorFlowApp from "@/components/mentorflow-app";
import { Card } from "@/components/ui/card";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MentorFlow · Your next step",
  description: "Meaningful guidance and mentorship for entrepreneurs in Bhutan.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body>
        <Suspense fallback={<Card className="mx-auto my-6 max-w-lg p-6"><p role="status">Loading MentorFlow…</p></Card>}>
          <DemoStateProvider>
            <MentorFlowApp>{children}</MentorFlowApp>
          </DemoStateProvider>
        </Suspense>
      </body>
    </html>
  );
}
