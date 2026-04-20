import type { ReactNode } from "react";

type Props = {
  /** Step number (1-indexed). */
  n: number;
  /** Anchor ID used by the jump-chip nav. */
  id: string;
  title: string;
  /** Optional short subtitle rendered under the title. */
  subtitle?: string;
  children: ReactNode;
};

export function QuickstartStep({ n, id, title, subtitle, children }: Props) {
  return (
    <section
      id={id}
      className="scroll-mt-20 rounded-xl border bg-card overflow-hidden"
      aria-labelledby={`${id}-title`}
    >
      <header className="flex items-baseline gap-3 px-5 py-3 border-b">
        <span
          aria-hidden="true"
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
        >
          {n}
        </span>
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-sm font-semibold text-foreground">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </header>
      <div className="px-5 py-4 flex flex-col gap-3 text-sm leading-6 text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
