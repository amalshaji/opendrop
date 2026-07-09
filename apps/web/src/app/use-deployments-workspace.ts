import { useCallback, useEffect, useState } from "react";
import { publishedDeploymentsResponseSchema, type PublishedDeployment } from "@opendrop/shared/core";

interface UseDeploymentsWorkspaceOptions {
  active: boolean;
  setStatus: (status: string) => void;
}

export type DeploymentsState =
  | { status: "idle" | "loading" | "ready"; deployments: PublishedDeployment[] }
  | { status: "error"; deployments: PublishedDeployment[]; error: string };

export function useDeploymentsWorkspace({ active, setStatus }: UseDeploymentsWorkspaceOptions) {
  const [state, setState] = useState<DeploymentsState>({ status: "idle", deployments: [] });

  const loadDeployments = useCallback(async () => {
    setState((current) => ({ status: "loading", deployments: current.deployments }));
    setStatus("Loading published drops...");
    try {
      const response = await fetch("/api/deployments", { credentials: "include" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(responseError(payload));
      }
      const result = publishedDeploymentsResponseSchema.safeParse(payload);
      if (!result.success) throw new Error("The server returned an invalid published-drops response.");
      setState({ status: "ready", deployments: result.data.deployments });
      setStatus("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Published drops could not be loaded.";
      setState((current) => ({ status: "error", deployments: current.deployments, error: message }));
      setStatus(message);
    }
  }, [setStatus]);

  useEffect(() => {
    if (active) void loadDeployments();
  }, [active, loadDeployments]);

  return { state, loadDeployments };
}

function responseError(payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return "Published drops could not be loaded.";
}
