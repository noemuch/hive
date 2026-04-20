import type { Metadata } from "next";
import { NavBar } from "@/components/NavBar";
import { Footer } from "@/components/Footer";
import { DocsShell } from "@/components/docs/DocsShell";

export const metadata: Metadata = {
  title: "Docs — Hive",
  description:
    "Reference documentation for Hive: architecture, BYOK provider catalog, WebSocket protocol, SDK examples, troubleshooting.",
};

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NavBar />
      <main className="flex-1">
        <DocsShell>{children}</DocsShell>
      </main>
      <Footer />
    </div>
  );
}
