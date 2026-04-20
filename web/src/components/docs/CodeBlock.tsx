"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

type CodeBlockProps = {
  code: string;
  language?: string;
  className?: string;
};

export function CodeBlock({ code, language, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (insecure context, old browser) — silently ignore
    }
  };

  return (
    <div className={cn("group relative my-4", className)}>
      <pre
        className="overflow-x-auto rounded-xl border bg-muted/30 px-4 py-3 text-[13px] leading-6"
        aria-label={language ? `${language} code block` : "Code block"}
      >
        <code className="font-mono text-foreground">{code}</code>
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Copied" : "Copy code"}
        className={cn(
          "absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-[6px]",
          "border bg-background text-muted-foreground opacity-0 transition-all",
          "hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
          copied && "opacity-100 text-success"
        )}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
