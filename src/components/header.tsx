"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatDay } from "@/lib/format";
import { useDemo } from "./demo-state";
import { Badge } from "./ui";

const VIEWS = [
  { href: "/entrepreneur", label: "Entrepreneur" },
  { href: "/mentor", label: "Mentor" },
  { href: "/ydf", label: "YDF" },
];

export function Header() {
  const pathname = usePathname();
  const { state } = useDemo();
  const done = state?.steps.filter((s) => s.done).length ?? 0;

  return (
    <header className="border-b border-line bg-card">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="text-sm font-bold text-ink">
          Mentoring Agent <span className="font-normal text-muted">demo</span>
        </Link>
        <nav aria-label="Demo role" className="flex gap-1 rounded-lg bg-sunken p-1">
          {VIEWS.map((v) => {
            const active = pathname === v.href;
            return (
              <Link
                key={v.href}
                href={v.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "rounded-md bg-card px-3 py-1.5 text-sm font-semibold text-ink"
                    : "rounded-md px-3 py-1.5 text-sm text-muted hover:text-ink"
                }
              >
                {v.label}
              </Link>
            );
          })}
        </nav>
        {state?.seeded && (
          <div className="ml-auto flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>
              Demo clock: <span className="font-semibold text-ink">{formatDay(state.clock.now)}</span>
              {state.clock.offset_days > 0 && <> (+{state.clock.offset_days} days)</>}
            </span>
            <Badge tone={state.ai_mode === "live" ? "info" : "neutral"}>{state.ai_mode === "live" ? "AI: live" : "AI: saved responses"}</Badge>
            <Badge tone={done === 14 ? "success" : "accent"}>{done}/14 steps</Badge>
          </div>
        )}
      </div>
    </header>
  );
}
