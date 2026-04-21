"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { UseAgentWizard } from "@/components/agent-profile/UseAgentWizard";
import { Altitude1 } from "@/components/agent-profile/Altitude1";
import { Altitude2 } from "@/components/agent-profile/Altitude2";
import { Altitude3 } from "@/components/agent-profile/Altitude3";
import { useAgentScoreRefresh, type AgentScoreRefreshedPayload } from "@/hooks/useAgentScoreRefresh";
import type { AgentDetail, ProfileView, QualityData } from "@/components/agent-profile/shared";

// Re-export public types/constants for external consumers (CompareTable,
// compare/_content, etc.). Kept here for backward compatibility.
export {
  QUALITY_AXES,
} from "@/components/agent-profile/shared";
export type {
  AgentDetail,
  QualityAxisKey,
  QualityData,
  QualityExplanation,
} from "@/components/agent-profile/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export function AgentProfile({
  agentId,
  open,
  onClose,
}: {
  agentId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState(false);

  const [quality, setQuality] = useState<QualityData | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);

  const [view, setView] = useState<ProfileView>({ altitude: 1 });
  const [wizardOpen, setWizardOpen] = useState(false);

  // Live composite refresh — patch the big score card when a peer evaluation
  // (or batch invalidation) changes THIS agent's composite score.
  const applyScoreRefresh = useCallback((ev: AgentScoreRefreshedPayload) => {
    if (!agentId || ev.agent_id !== agentId) return;
    setQuality((prev) =>
      prev
        ? {
            ...prev,
            composite: ev.score_state_mu,
            score_state_mu: ev.score_state_mu,
            score_state_sigma: ev.score_state_sigma,
            last_evaluated_at: ev.last_evaluated_at,
          }
        : prev,
    );
  }, [agentId]);
  useAgentScoreRefresh(applyScoreRefresh);

  // Reset view when sheet closes or agent changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView({ altitude: 1 });
  }, [open, agentId]);

  // Fetch agent data
  useEffect(() => {
    if (!open || !agentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAgent(null);

      setAgentError(false);
      return;
    }
    let cancelled = false;

    setAgentLoading(true);

    setAgentError(false);
    fetch(`${API_URL}/api/agents/${agentId}`)
      .then(r => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<{ agent: AgentDetail }>;
      })
      .then(data => {
        if (!cancelled && data?.agent) setAgent(data.agent);
      })
      .catch(() => {
        if (!cancelled) setAgentError(true);
      })
      .finally(() => {
        if (!cancelled) setAgentLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, agentId]);

  // Fetch quality data
  useEffect(() => {
    if (!open || !agentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuality(null);
      return;
    }
    let cancelled = false;

    setQualityLoading(true);
    fetch(`${API_URL}/api/agents/${agentId}/quality`)
      .then(r => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<QualityData>;
      })
      .then(data => {
        if (!cancelled) {
          const hasAny = data?.axes && Object.keys(data.axes).length > 0;
          setQuality(hasAny ? data : null);
        }
      })
      .catch(() => {
        if (!cancelled) setQuality(null);
      })
      .finally(() => {
        if (!cancelled) setQualityLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, agentId]);

  return (
    <>
    {agent && (
      <UseAgentWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        agent={{
          id: agent.id,
          name: agent.name,
          role: agent.role,
          personality_brief: agent.personality_brief,
          score_state_mu: quality?.score_state_mu ?? quality?.composite ?? null,
        }}
      />
    )}
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent side="right" className="flex flex-col gap-0 overflow-hidden p-0" showCloseButton={view.altitude === 1}>
        {/* Hidden accessible title/description for screen readers */}
        <SheetHeader className="sr-only">
          <SheetTitle>{agent?.name ?? "Agent Profile"}</SheetTitle>
          <SheetDescription>{agent?.personality_brief ?? "Agent details"}</SheetDescription>
        </SheetHeader>

        {agentLoading && (
          <div className="flex h-full items-center justify-center">
            <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          </div>
        )}

        {!agentLoading && agentError && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Failed to load agent
          </div>
        )}

        {!agentLoading && !agentError && !agent && open && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Agent not found
          </div>
        )}

        {!agentLoading && agent && (
          // Native overflow scroll — base-ui ScrollArea had trackpad
          // quirks inside the Sheet's nested flex chain. `min-h-0` lets
          // this flex child actually shrink below its content height,
          // which is what enables scrolling on overflow. See issue #171.
          <div className="flex-1 min-h-0 overflow-y-auto">
            {view.altitude === 1 && (
              <Altitude1
                agent={agent}
                quality={quality}
                qualityLoading={qualityLoading}
                onSeeBreakdown={() => setView({ altitude: 2 })}
                onUseAgent={() => setWizardOpen(true)}
              />
            )}

            {view.altitude === 2 && (
              <Altitude2
                quality={quality}
                onBack={() => setView({ altitude: 1 })}
                onAxisClick={key => setView({ altitude: 3, axis: key })}
              />
            )}

            {view.altitude === 3 && (
              <Altitude3
                agentId={agent.id}
                axisKey={view.axis}
                quality={quality}
                onBack={() => setView({ altitude: 2 })}
              />
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
    </>
  );
}
