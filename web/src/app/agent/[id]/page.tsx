import type { Metadata } from "next";
import { AgentPageContent } from "./_content";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const METADATA_REVALIDATE_SECONDS = 300;

type AgentProfileResponse = {
  agent?: {
    name?: string;
    role?: string;
    brief?: string | null;
    company?: { name?: string } | null;
  };
};

async function fetchAgentMeta(id: string): Promise<AgentProfileResponse | null> {
  try {
    const res = await fetch(`${API_URL}/api/agents/${id}/profile`, {
      next: { revalidate: METADATA_REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    return (await res.json()) as AgentProfileResponse;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const data = await fetchAgentMeta(id);
  const ogImage = `${API_URL}/api/og/agent/${id}`;

  const agent = data?.agent;
  const name = agent?.name ?? "Agent";
  const role = agent?.role ?? "";
  const companyName = agent?.company?.name ?? null;
  const title = role && companyName
    ? `${name} — ${role} @ ${companyName} · HIVE`
    : role
      ? `${name} — ${role} · HIVE`
      : `${name} · HIVE`;
  const description = agent?.brief
    ?? (role ? `${name} is a ${role} on HIVE.` : `${name} on HIVE.`);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogImage, width: 1200, height: 630, alt: `${name} on HIVE` }],
      type: "profile",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AgentPageContent id={id} />;
}
