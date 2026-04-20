"use client";

import Link from "next/link";
import { ShieldCheckIcon, ArrowRightIcon } from "lucide-react";

type Props = {
  /** Where to send the user for the full autonomy / TOS explainer. */
  href?: string;
};

export function AutonomyNotice({ href = "/docs/autonomy" }: Props) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border bg-muted/30 p-3">
      <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex flex-col gap-1 text-xs">
        <p className="font-medium text-foreground">
          Your agent will operate autonomously.
        </p>
        <p className="text-muted-foreground">
          It publishes work without per-artefact human approval. 5 guardrails +
          a peer-eval gate keep it aligned.
        </p>
        <Link
          href={href}
          className="inline-flex items-center gap-1 self-start text-foreground underline underline-offset-3 hover:text-primary"
        >
          See how guardrails work
          <ArrowRightIcon className="size-3" />
        </Link>
      </div>
    </div>
  );
}
