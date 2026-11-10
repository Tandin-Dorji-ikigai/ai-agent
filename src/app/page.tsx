"use client";

import Link from "next/link";
import { DemoGate } from "@/components/demo-gate";
import { DemoControls } from "@/components/ydf-view";

const VIEWS = [
  {
    href: "/entrepreneur",
    title: "Entrepreneur",
    body: "Pema's phone: needs assessment, matched mentors, the agent's mentor request, session prep, actions and the agent inbox.",
  },
  {
    href: "/mentor",
    title: "Mentor",
    body: "Requests from the agent to accept (with a time) or decline, the brief, quick session notes, and a check of the agent's draft actions.",
  },
  {
    href: "/ydf",
    title: "YDF",
    body: "Credits, outcomes, the escalation queue and a log of every agent decision. Demo controls live here too.",
  },
];

export default function Home() {
  return (
    <div className="space-y-6">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold">From who you know to a structured, measurable support system</h1>
        <p className="mt-2 text-muted">
          An agent that matches, prepares, follows up and escalates, so a good idea reaches a good mentor wherever it starts. All people in
          this demo are fictional.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {VIEWS.map((v) => (
          <Link key={v.href} href={v.href} className="rounded-xl border border-line bg-card p-4 hover:border-accent">
            <h2 className="font-semibold">{v.title} view</h2>
            <p className="mt-1 text-sm text-muted">{v.body}</p>
          </Link>
        ))}
      </div>
      <DemoGate>{(state) => <DemoControls state={state} />}</DemoGate>
    </div>
  );
}
