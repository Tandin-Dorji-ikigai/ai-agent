"use client";

import type { ReactNode } from "react";
import type { DemoState } from "@/lib/state-types";
import { useDemo } from "./demo-state";
import { Button, Card, Notice } from "./ui";

// Renders a view only when the database is configured and seeded.
// Otherwise it explains the one thing to do next.
export function DemoGate({ children }: { children: (state: DemoState) => ReactNode }) {
  const { state, error, act, busy } = useDemo();

  if (error?.code === "SUPABASE_NOT_CONFIGURED") {
    return (
      <Card className="mx-auto max-w-xl">
        <h1 className="text-lg font-semibold">Connect the database</h1>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>
            Copy <code className="font-mono text-ink">.env.example</code> to <code className="font-mono text-ink">.env.local</code>.
          </li>
          <li>
            Set <code className="font-mono text-ink">SUPABASE_URL</code> and <code className="font-mono text-ink">SUPABASE_SERVICE_ROLE_KEY</code> from your
            Supabase project settings.
          </li>
          <li>Apply the migrations in supabase/migrations (see README), then restart the dev server.</li>
        </ol>
      </Card>
    );
  }

  if (error?.code === "MIGRATIONS_REQUIRED") {
    return (
      <Card className="mx-auto max-w-xl">
        <h1 className="text-lg font-semibold">Update the database</h1>
        <p className="mt-2 text-sm text-muted">
          Supabase is connected, but it is missing tables or columns this version of the app needs. The server log names what is missing.
        </p>
        <h2 className="mt-4 text-sm font-semibold">A project that is already set up (most likely)</h2>
        <p className="mt-1 text-sm text-muted">
          Apply only the new migrations: run <code className="font-mono text-ink">npx supabase db push</code>, or ask the backend owner to.
          Do not run APPLY_ALL.sql here: it would stop at the first table that already exists.
        </p>
        <h2 className="mt-4 text-sm font-semibold">A brand-new, empty project</h2>
        <ol className="mt-1 list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>
            Open your Supabase project → <span className="font-medium text-ink">SQL Editor</span> → New query.
          </li>
          <li>
            Paste all of <code className="font-mono text-ink">supabase/APPLY_ALL.sql</code> and click <span className="font-medium text-ink">Run</span>.
          </li>
          <li>Refresh this page, then click <span className="font-medium text-ink">Load demo data</span>.</li>
        </ol>
      </Card>
    );
  }

  if (error && !state) {
    return (
      <div className="mx-auto max-w-xl">
        <Notice tone="danger" title="The app cannot load the demo data">
          {error.message}
        </Notice>
      </div>
    );
  }

  if (!state) {
    return <p className="text-sm text-muted">Loading the demo...</p>;
  }

  if (!state.seeded) {
    return (
      <Card className="mx-auto max-w-xl">
        <h1 className="text-lg font-semibold">The demo database is empty</h1>
        <p className="mt-2 text-sm text-muted">Load Pema, the 15 fictional mentors, the approved resources and the YDF credit.</p>
        <Button className="mt-4" busy={busy === "reset"} onClick={() => act("reset", "/api/demo/reset")}>
          Load demo data
        </Button>
      </Card>
    );
  }

  return <>{children(state)}</>;
}

/** Shows the most recent failed action, if any. */
export function LastError() {
  const { lastError, clearLastError } = useDemo();
  if (!lastError) return null;
  return (
    <div className="mb-4">
      <Notice tone="danger" title="That did not work">
        <p>{lastError.message}</p>
        <Button variant="ghost" className="mt-1" onClick={clearLastError}>
          Dismiss
        </Button>
      </Notice>
    </div>
  );
}
