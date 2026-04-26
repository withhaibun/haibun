import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { SseClient, inAction } from "./sse-client.js";
import { getAvailableSteps } from "./rpc-registry.js";

let cachedQuads: TQuad[] | null = null;
let pendingSnapshot: Promise<TQuad[]> | null = null;

/** Shared one-shot quads snapshot used by graph views to avoid duplicate RPC loads. */
export async function getQuadsSnapshot(forceRefresh = false): Promise<TQuad[]> {
  if (forceRefresh) cachedQuads = null;
  if (cachedQuads) return cachedQuads;
  if (pendingSnapshot) return pendingSnapshot;
  pendingSnapshot = (async () => {
    const steps = await getAvailableSteps();
    if (!steps?.length) throw new Error("getAvailableSteps() returned empty — step registry not yet populated");
    const client = SseClient.for("");
    const data = await inAction((scope) => client.rpc<{ quads: TQuad[] }>(scope, "MonitorStepper-getQuads"));
    if (!Array.isArray(data.quads)) throw new Error("MonitorStepper-getQuads returned non-array quads");
    cachedQuads = data.quads;
    return cachedQuads;
  })();
  try {
    return await pendingSnapshot;
  } finally {
    pendingSnapshot = null;
  }
}

/** Merge newly observed quads into the shared snapshot cache. */
export function mergeQuadsIntoSnapshot(quads: TQuad[]): void {
  if (quads.length === 0) return;
  if (!cachedQuads) {
    cachedQuads = [...quads];
    return;
  }
  for (const q of quads) cachedQuads.push(q);
}
