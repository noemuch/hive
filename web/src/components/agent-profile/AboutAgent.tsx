"use client";

import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { GitHubIcon, LinkedInIcon, WebsiteIcon, XIcon } from "@/components/SocialIcons";
import { getInitials } from "@/lib/initials";
import { cn } from "@/lib/utils";
import { Brain, Building2, Globe } from "lucide-react";

export type BuilderSocials = {
  github?: string;
  twitter?: string;
  linkedin?: string;
  website?: string;
};

export type AboutAgentProps = {
  brief: string | null;
  specializations: string[];
  languages: string[];
  memory_type: string;
  company: { id: string; name: string } | null;
  builder: {
    id: string;
    display_name: string;
    socials: BuilderSocials | null;
  } | null;
  className?: string;
};

function socialHref(kind: keyof BuilderSocials, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "#";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  switch (kind) {
    case "github":
      return `https://github.com/${trimmed.replace(/^@/, "")}`;
    case "twitter":
      return `https://x.com/${trimmed.replace(/^@/, "")}`;
    case "linkedin":
      return `https://linkedin.com/in/${trimmed}`;
    case "website":
      return `https://${trimmed}`;
  }
}

const MEMORY_LABEL: Record<string, string> = {
  "short-term": "Short-term",
  "long-term": "Long-term",
  "episodic": "Episodic",
  "none": "Stateless",
};

export function AboutAgent({
  brief,
  specializations,
  languages,
  memory_type,
  company,
  builder,
  className,
}: AboutAgentProps) {
  const memoryLabel = MEMORY_LABEL[memory_type] ?? memory_type;
  const hasSocials =
    builder?.socials &&
    (builder.socials.github ||
      builder.socials.twitter ||
      builder.socials.linkedin ||
      builder.socials.website);

  return (
    <div className={cn("rounded-xl border bg-card overflow-hidden", className)}>
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">About</h2>
      </div>

      <div className="flex flex-col gap-5 p-5">
        {brief && (
          <p className="text-sm leading-relaxed text-muted-foreground">{brief}</p>
        )}

        {(specializations.length > 0 || languages.length > 0 || memory_type) && (
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {specializations.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Specializations
                </dt>
                <dd className="flex flex-wrap gap-1.5">
                  {specializations.map((s) => (
                    <Badge key={s} variant="secondary" className="font-normal">
                      {s}
                    </Badge>
                  ))}
                </dd>
              </div>
            )}

            {languages.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <dt className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
                  <Globe className="h-3 w-3" aria-hidden="true" />
                  Languages
                </dt>
                <dd className="text-sm">{languages.join(" · ")}</dd>
              </div>
            )}

            {memory_type && (
              <div className="flex flex-col gap-1.5">
                <dt className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
                  <Brain className="h-3 w-3" aria-hidden="true" />
                  Memory
                </dt>
                <dd className="text-sm">{memoryLabel}</dd>
              </div>
            )}
          </dl>
        )}

        {company && (
          <div className="flex items-center gap-2 border-t pt-4">
            <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-xs text-muted-foreground">Works at</span>
            <Link
              href={`/company/${company.id}`}
              className="text-sm font-medium hover:underline"
            >
              {company.name}
            </Link>
          </div>
        )}

        {builder && (
          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
                aria-hidden="true"
              >
                {getInitials(builder.display_name)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{builder.display_name}</p>
                <p className="text-xs text-muted-foreground">Builder on Hive</p>
              </div>
            </div>

            {hasSocials && builder.socials && (
              <div className="flex items-center gap-3 text-muted-foreground">
                {builder.socials.github && (
                  <a
                    href={socialHref("github", builder.socials.github)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground transition-colors"
                    aria-label={`${builder.display_name} on GitHub`}
                  >
                    <GitHubIcon className="size-3.5" />
                  </a>
                )}
                {builder.socials.twitter && (
                  <a
                    href={socialHref("twitter", builder.socials.twitter)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground transition-colors"
                    aria-label={`${builder.display_name} on X`}
                  >
                    <XIcon className="size-3.5" />
                  </a>
                )}
                {builder.socials.linkedin && (
                  <a
                    href={socialHref("linkedin", builder.socials.linkedin)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground transition-colors"
                    aria-label={`${builder.display_name} on LinkedIn`}
                  >
                    <LinkedInIcon className="size-3.5" />
                  </a>
                )}
                {builder.socials.website && (
                  <a
                    href={socialHref("website", builder.socials.website)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground transition-colors"
                    aria-label={`${builder.display_name}'s website`}
                  >
                    <WebsiteIcon className="size-3.5" />
                  </a>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function AboutAgentSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card overflow-hidden", className)}>
      <div className="border-b px-4 py-3">
        <Skeleton className="h-4 w-14" />
      </div>
      <div className="flex flex-col gap-5 p-5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2.5 border-t pt-4">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-1">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      </div>
    </div>
  );
}
