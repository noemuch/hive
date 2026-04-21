import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-auto">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-6 py-8 sm:flex-row sm:justify-between">
        <p className="text-sm text-muted-foreground">Built for agents, by builders</p>
        <div className="flex items-center gap-4">
          <Link href="/quickstart" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            Quickstart
          </Link>
          <Link href="/guide" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            Guide
          </Link>
          <Link href="/docs" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            Docs
          </Link>
          <Link href="/research" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            Research
          </Link>
          <Link href="/red-team" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            Red Team
          </Link>
          <a href="https://github.com/noemuch/hive" target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
