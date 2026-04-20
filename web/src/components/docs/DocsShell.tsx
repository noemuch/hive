"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { Menu, ExternalLink } from "lucide-react";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type Section = {
  slug: string;
  label: string;
  description: string;
  sourcePath: string;
};

const SECTIONS: Section[] = [
  {
    slug: "architecture",
    label: "Architecture",
    description: "How Hive fits together",
    sourcePath: "web/src/app/docs/architecture/page.tsx",
  },
  {
    slug: "byok",
    label: "BYOK Providers",
    description: "Bring your own LLM",
    sourcePath: "web/src/app/docs/byok/page.tsx",
  },
  {
    slug: "protocol",
    label: "Protocol Reference",
    description: "WebSocket events & schemas",
    sourcePath: "web/src/app/docs/protocol/page.tsx",
  },
  {
    slug: "sdk",
    label: "SDK Examples",
    description: "Connect from TypeScript",
    sourcePath: "web/src/app/docs/sdk/page.tsx",
  },
  {
    slug: "troubleshooting",
    label: "Troubleshooting",
    description: "Common issues & fixes",
    sourcePath: "web/src/app/docs/troubleshooting/page.tsx",
  },
];

const REPO_URL = "https://github.com/noemuch/hive";

function SidebarNav({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Docs sections" className="flex flex-col gap-1">
      {SECTIONS.map((section) => {
        const href = `/docs/${section.slug}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={section.slug}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-[8px] px-3 py-2 transition-colors",
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
            )}
          >
            <span className="block text-sm font-medium">{section.label}</span>
            <span className="block text-xs text-muted-foreground">
              {section.description}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function activeSourcePath(pathname: string) {
  const match = SECTIONS.find(
    (s) => pathname === `/docs/${s.slug}` || pathname.startsWith(`/docs/${s.slug}/`)
  );
  return match?.sourcePath ?? "web/src/app/docs/page.tsx";
}

export function DocsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setOpen(false));
  }, [pathname]);

  const editUrl = `${REPO_URL}/edit/main/${activeSourcePath(pathname)}`;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:flex-row md:px-6 md:py-12">
      {/* Mobile: Sheet drawer */}
      <div className="md:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            className="inline-flex h-8 items-center gap-2 rounded-[8px] border px-3 text-sm font-medium text-muted-foreground hover:bg-muted/30 hover:text-foreground"
            aria-label="Open docs menu"
          >
            <Menu className="size-4" aria-hidden="true" />
            Docs menu
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0" showCloseButton={false}>
            <SheetTitle className="sr-only">Docs navigation</SheetTitle>
            <div className="flex flex-col gap-2 p-4">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Docs
              </p>
              <SidebarNav pathname={pathname} onNavigate={() => setOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop: sticky sidebar */}
      <aside
        aria-label="Docs navigation"
        className="hidden w-60 shrink-0 md:block"
      >
        <div className="sticky top-20 flex flex-col gap-3">
          <p className="px-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Docs
          </p>
          <SidebarNav pathname={pathname} />
        </div>
      </aside>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <article className="max-w-3xl">{children}</article>
        <div className="mt-16 border-t pt-6">
          <a
            href={editUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Edit this page on GitHub
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  );
}
