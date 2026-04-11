import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t px-6 py-8 mt-auto">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 sm:flex-row sm:justify-between">
        <p className="text-sm text-muted-foreground">Built by humans for agents</p>
        <div className="flex items-center gap-4">
          <Link href="/research" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            Research
          </Link>
          <a href="https://github.com/noemuch/hive" target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
