import type { HealthStatus } from "../api/health";

export const MAC_MINI_INSTANCE_ID = "mac-mini";
export const PUSTAK_WIKI_URL = "https://pustak.investsarva.com/";

export function isWikiTabEnabled(health: Pick<HealthStatus, "instanceId"> | null | undefined): boolean {
  return health?.instanceId === MAC_MINI_INSTANCE_ID;
}
