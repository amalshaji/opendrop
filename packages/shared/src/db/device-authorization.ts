import type { DeviceTokenExchangeResult } from "./repository";

type BlockedDeviceTokenExchange = Exclude<DeviceTokenExchangeResult, { status: "issued" }>;

interface DeviceAuthorizationForExchange {
  id: string;
  status: string;
  userId: string | null;
  label: string | null;
  deviceName: string | null;
  userAgent: string | null;
  expiresAt: string;
}

export type DeviceTokenExchangeDecision =
  | {
      kind: "issue";
      authorization: Omit<DeviceAuthorizationForExchange, "status" | "userId"> & {
        status: "approved";
        userId: string;
      };
    }
  | { kind: "blocked"; result: BlockedDeviceTokenExchange };

export function decideDeviceTokenExchange(
  authorization: DeviceAuthorizationForExchange,
  now = Date.now()
): DeviceTokenExchangeDecision {
  if (new Date(authorization.expiresAt).getTime() < now) {
    return { kind: "blocked", result: { status: "expired", expiresAt: authorization.expiresAt } };
  }
  switch (authorization.status) {
    case "approved":
      if (!authorization.userId) throw new Error("Approved device authorization has no user.");
      return {
        kind: "issue",
        authorization: {
          id: authorization.id,
          status: "approved",
          userId: authorization.userId,
          label: authorization.label,
          deviceName: authorization.deviceName,
          userAgent: authorization.userAgent,
          expiresAt: authorization.expiresAt
        }
      };
    case "pending":
      return { kind: "blocked", result: { status: "pending", expiresAt: authorization.expiresAt } };
    case "rejected":
      return { kind: "blocked", result: { status: "rejected", expiresAt: authorization.expiresAt } };
    case "exchanged":
      return { kind: "blocked", result: { status: "already_exchanged", expiresAt: authorization.expiresAt } };
    default:
      throw new Error(`Unsupported device authorization status: ${authorization.status}`);
  }
}
