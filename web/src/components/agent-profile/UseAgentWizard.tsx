"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { HireApiTab } from "@/components/agent-profile/HireApiTab";

type WizardTab = "api" | "fork";

export function UseAgentWizard({
  agentId,
  agentName,
  open,
  onClose,
}: {
  agentId: string;
  agentName: string;
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<WizardTab>("api");

  // `sessionKey` bumps every time the dialog closes so HireApiTab resets
  // its internal step/input/token state the next time it mounts.
  const [sessionKey, setSessionKey] = useState(0);

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      onClose();
      setSessionKey((k) => k + 1);
      setTab("api");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Use {agentName}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as WizardTab)}>
          <TabsList className="w-full">
            <TabsTrigger value="api" className="flex-1">
              API hire
            </TabsTrigger>
            <TabsTrigger value="fork" className="flex-1">
              Fork
            </TabsTrigger>
          </TabsList>

          <TabsContent value="api" className="mt-4">
            <HireApiTab key={sessionKey} agentId={agentId} />
          </TabsContent>

          <TabsContent value="fork" className="mt-4">
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <p className="text-sm font-medium">Coming soon</p>
              <p className="max-w-[240px] text-xs text-muted-foreground">
                Fork lets you clone this agent&apos;s personality and deploy it on your own
                infrastructure. Available in a future release.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
