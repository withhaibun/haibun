/**
 * graph-expansion — reveal a node's bounded neighborhood in the shared graph
 * snapshot when the user selects it. Generic: the overview and any external
 * viewer call it the same way; it knows nothing about which view it serves.
 *
 * Each neighbor is brought in as its own node (so it renders, not merely as an
 * edge endpoint) in both directions, the node + neighbors are pinned so streamed
 * data can't evict them, and labels are filled by the merge's one shared rule.
 * Bounded per call by the server's neighborhood limits.
 */
import { conduit } from "./hypermedia.js";
import { getAvailableSteps, requireStep } from "./rpc-registry.js";
import { getRels } from "./rels-cache.js";
import { appAccessLevel, idOf } from "./util.js";
import { mergeQuadsIntoSnapshot, pinSubjects } from "./quads-snapshot.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";

/** Incoming-edge page size; the server caps this at 100, so a hub stays bounded. */
const INCOMING_LIMIT = 100;

type ProjectedVertex = Record<string, unknown>;
type EdgeRow = { type: string; target: ProjectedVertex };

/** A projected vertex's scalar properties as quads (no edges) — so a revealed neighbor renders as a node. */
function vertexPropsToQuads(label: string, vertex: ProjectedVertex, timestamp: number): TQuad[] {
	const subject = idOf(vertex);
	if (!subject) return [];
	const quads: TQuad[] = [];
	for (const [k, v] of Object.entries(vertex)) {
		if (k.startsWith("_") || k.startsWith("@") || k === "id") continue;
		if (v === undefined || v === null) continue;
		quads.push({ subject, predicate: k, object: v, namedGraph: label, timestamp });
	}
	return quads;
}

/**
 * Fetch a node's outgoing + incoming neighborhood (server-bounded), bring the node
 * and every neighbor into the snapshot as pinned nodes, and merge. Returns the set
 * of graph types touched so the caller can expand them. A non-individual graph
 * (no rels) has no neighborhood and returns empty.
 */
export async function expandNeighborhood(label: string, id: string): Promise<Set<string>> {
	const types = new Set<string>();
	if (!getRels(label)) return types;
	await getAvailableSteps();
	const accessLevel = appAccessLevel();
	const [out, inc] = await Promise.all([
		conduit().follow<{ vertex: ProjectedVertex; edges: EdgeRow[] }>(
			{ method: requireStep("getIndividualWithEdges"), params: { label, id, accessLevel } },
			`graph-expansion: outgoing ${label}:${id}`,
		),
		conduit().follow<{ edges: EdgeRow[]; total: number }>(
			{ method: requireStep("getIncomingEdges"), params: { label, id, accessLevel, limit: INCOMING_LIMIT, offset: 0 } },
			`graph-expansion: incoming ${label}:${id}`,
		),
	]);
	if (!out?.vertex) return types;

	const timestamp = Date.now();
	const quads: TQuad[] = [...vertexPropsToQuads(label, out.vertex, timestamp)];
	const pinned = new Set<string>([id]);
	types.add(label);
	for (const e of out.edges ?? []) {
		const targetLabel = String(e.target["@type"] ?? "");
		const targetId = idOf(e.target);
		if (!targetLabel || !targetId) continue;
		quads.push({ subject: id, predicate: e.type, object: targetId, namedGraph: label, objectType: targetLabel, timestamp });
		quads.push(...vertexPropsToQuads(targetLabel, e.target, timestamp));
		pinned.add(targetId);
		types.add(targetLabel);
	}
	for (const e of inc.edges ?? []) {
		const sourceLabel = String(e.target["@type"] ?? "");
		const sourceId = idOf(e.target);
		if (!sourceLabel || !sourceId) continue;
		quads.push({ subject: sourceId, predicate: e.type, object: id, namedGraph: sourceLabel, objectType: label, timestamp });
		quads.push(...vertexPropsToQuads(sourceLabel, e.target, timestamp));
		pinned.add(sourceId);
		types.add(sourceLabel);
	}

	pinSubjects(pinned);
	mergeQuadsIntoSnapshot(quads);
	return types;
}
