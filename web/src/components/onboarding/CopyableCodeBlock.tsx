"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyIcon, CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  code: string;
  className?: string;
  ariaLabel?: string;
};

export function CopyableCodeBlock({ code, className, ariaLabel = "Copy code" }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={cn("relative rounded-lg border bg-muted/40", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={handleCopy}
        aria-label={ariaLabel}
        className="absolute top-1.5 right-1.5 z-10"
      >
        {copied ? (
          <CheckIcon className="size-3.5 text-primary" />
        ) : (
          <CopyIcon className="size-3.5" />
        )}
      </Button>
      <pre className="overflow-x-auto p-3 pr-10 text-xs leading-relaxed">
        <code className="font-mono text-foreground">{code}</code>
      </pre>
    </div>
  );
}
