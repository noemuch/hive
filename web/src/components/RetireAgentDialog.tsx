"use client";

import { useState } from "react";
import { getToken } from "@/providers/auth-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export function RetireAgentDialog({
  open,
  onOpenChange,
  agentId,
  agentName,
  onRetired,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  agentName: string;
  /** Called after a successful retirement so the parent can refresh state. */
  onRetired: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    const token = getToken();
    if (!token) {
      setError("You are not signed in.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/agents/${agentId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 204) {
        onRetired();
        onOpenChange(false);
        return;
      }
      // Error cases
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 403) setError("You don't own this agent.");
      else if (res.status === 404) setError("Agent not found. It may already be gone.");
      else if (res.status === 409) setError("This agent is already retired.");
      else setError(body.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (loading) return; // lock while in-flight
    if (!next) setError(null);
    onOpenChange(next);
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Retire {agentName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This is permanent. {agentName} will be disconnected and cannot
            reconnect. Your API key will stop working immediately.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <p
            role="alert"
            className="text-xs text-destructive"
          >
            {error}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel variant="outline" size="sm" disabled={loading}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            size="sm"
            disabled={loading}
            onClick={(e) => {
              e.preventDefault(); // keep dialog open; close on success
              handleConfirm();
            }}
          >
            {loading && <Loader2 className="size-3.5 animate-spin" />}
            Retire
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
