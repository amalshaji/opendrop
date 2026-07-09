import { useMemo, useState } from "react";
import { deviceDecisionBodySchema, deviceRequestParamsSchema } from "@opendrop/shared/core";
import { validationMessage } from "@/app/format";
import type { DeviceRequest } from "@/app/types";

interface UseDeviceApprovalOptions {
  setStatus: (status: string) => void;
  loadConnections: () => Promise<void> | void;
}

export function useDeviceApproval({ setStatus, loadConnections }: UseDeviceApprovalOptions) {
  const [deviceRequest, setDeviceRequest] = useState<DeviceRequest | null>(null);
  const deviceCode = useMemo(() => {
    const parsed = deviceRequestParamsSchema.safeParse({ userCode: new URLSearchParams(location.search).get("user_code") || "" });
    return parsed.success ? parsed.data.userCode : "";
  }, []);

  async function loadDeviceRequest() {
    const params = deviceRequestParamsSchema.safeParse({ userCode: deviceCode });
    if (!params.success) {
      setStatus(validationMessage(params.error));
      return;
    }
    const response = await fetch(`/api/device/requests/${encodeURIComponent(params.data.userCode)}`, { credentials: "include" });
    if (response.ok) {
      const result = await response.json();
      setDeviceRequest(result.request);
      setStatus("CLI request loaded.");
    } else {
      setStatus("CLI request not found or login required.");
    }
  }

  async function decideDevice(decision: "approve" | "reject") {
    const body = deviceDecisionBodySchema.safeParse({ userCode: deviceCode, decision });
    if (!body.success) {
      setStatus(validationMessage(body.error));
      return;
    }
    const response = await fetch("/api/device/approve", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body.data)
    });
    if (!response.ok) {
      setStatus("CLI connection action failed.");
      return;
    }
    setDeviceRequest((current) => (current ? { ...current, status: decision === "approve" ? "approved" : "rejected" } : current));
    setStatus(decision === "approve" ? "CLI connection approved. You can return to the terminal." : "CLI connection rejected.");
    await loadConnections();
  }

  return {
    deviceCode,
    deviceRequest,
    loadDeviceRequest,
    decideDevice
  };
}
