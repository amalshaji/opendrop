import { KeyRound, Terminal } from "lucide-react";
import type { DeviceRequest } from "@/app/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface DeviceApprovalPanelProps {
  deviceCode: string;
  deviceRequest: DeviceRequest | null;
  loadDeviceRequest: () => void | Promise<void>;
  decideDevice: (decision: "approve" | "reject") => void | Promise<void>;
  showConnections: () => void | Promise<void>;
}

export function DeviceApprovalPanel({
  deviceCode,
  deviceRequest,
  loadDeviceRequest,
  decideDevice,
  showConnections
}: DeviceApprovalPanelProps) {
  return (
    <Card className="settingsPanel deviceApprovalPanel">
      <CardHeader>
        <div>
          <CardTitle>Approve CLI connection</CardTitle>
          <CardDescription>The CLI opened this page. Confirm the request, then return to the terminal.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="devicePanelContent">
        <div className="deviceGrid">
          <div className="deviceCodePanel">
            <div className="inspectorLabel"><Terminal size={14} /> Request code</div>
            <strong className="deviceCodeValue">{deviceCode || "No code in URL"}</strong>
            <p>{deviceCode ? "Match this code with the one shown in your terminal before approving." : "Start CLI login again and open the complete approval URL."}</p>
            {deviceCode ? (
              <Button variant="outline" onClick={loadDeviceRequest}>Refresh request</Button>
            ) : (
              <Button variant="outline" onClick={showConnections}>Back to connections</Button>
            )}
          </div>
          {deviceRequest ? (
            <div className="deviceRequest">
              <strong>{deviceRequest.label || "OpenDrop CLI"}</strong>
              <span>{deviceRequest.deviceName || "Unknown machine"}</span>
              <span>Status: {deviceRequest.status}</span>
              {deviceRequest.status === "pending" ? (
                <div>
                  <Button onClick={() => decideDevice("approve")}>Approve connection</Button>
                  <Button variant="outline" onClick={() => decideDevice("reject")}>Reject</Button>
                </div>
              ) : (
                <div>
                  <Button variant="outline" onClick={showConnections}>
                    View connections
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="deviceRequest empty">
              <strong>{deviceCode ? "Loading request" : "No request code"}</strong>
              <span>{deviceCode ? "If this stays empty, refresh the request or start CLI login again." : "The dashboard does not start device login manually. Use the CLI to begin."}</span>
            </div>
          )}
        </div>
        <div className="deviceSecurityNote">
          <KeyRound size={16} />
          <span>Approved CLI connections appear in Settings under Connections, where they can be revoked.</span>
        </div>
      </CardContent>
    </Card>
  );
}
