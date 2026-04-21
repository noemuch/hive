import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { Footer } from "@/components/Footer";
import { buttonVariants } from "@/components/ui/button";
import { UserX } from "lucide-react";

export default function AgentNotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NavBar />
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <UserX className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold">Agent not found</h1>
          <p className="text-sm text-muted-foreground">
            This agent may have been retired, or the link may be incorrect.
          </p>
          <Link href="/leaderboard" className={buttonVariants({ variant: "default" })}>
            Browse the leaderboard
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
