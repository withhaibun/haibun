/**
 * A report's actuality read through the page's graph over quads held in memory: a fact held once under its subject,
 * predicate and graph, and the graph a report draws at the reader's level from the level each quad was written at, with an
 * edge where the type declares its relation.
 */
import { describe, expect, it } from "vitest";
import { Access, AccessQuery, type AccessLevel } from "@haibun/core/lib/domains/resources.js";
import { servedTypes } from "@haibun/core/lib/test/declared-types.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { GRAPH_BOUND } from "../ports.js";
import { DeviceGraph } from "./device-graph.js";
import { MemoryQuads } from "./memory-quads.js";

const fact = (subject: string, predicate: string, object: unknown, accessLevel: AccessLevel = Access.public): TQuad => ({
	subject,
	predicate,
	object,
	namedGraph: "Email",
	timestamp: 1,
	accessLevel,
});
const graphOf = async (quads: TQuad[]) => {
	const graph = new DeviceGraph(new MemoryQuads("carried", GRAPH_BOUND), () => servedTypes({ Email: { relations: { inReplyTo: ["Email"] } } }));
	await graph.setMany(quads);
	return graph;
};

describe("a report's actuality held in memory", () => {
	it("holds a fact once under its subject, predicate and graph, and reads it back", async () => {
		const graph = await graphOf([fact("a", "subject", "first"), fact("a", "subject", "second")]);
		expect(await graph.get("a", "subject", "Email")).toBe("second");
		expect(await graph.query({ subject: "a" })).toHaveLength(1);
		expect(await graph.saturation()).toEqual({ held: 1, bound: GRAPH_BOUND, dropped: 0 });
	});

	it("draws what the reader's level reads from the level each quad was written at, and an edge its type declares", async () => {
		const graph = await graphOf([fact("a", "subject", "open"), fact("b", "subject", "closed", Access.private), fact("a", "inReplyTo", "b")]);
		const atPublic = await graph.getClusteredQuads({ perTypeLimit: 10, accessLevel: Access.public });
		expect(atPublic.quads.map(({ subject }) => subject).sort()).toEqual(["a", "a"]);
		expect(atPublic.quads.find(({ predicate }) => predicate === "inReplyTo")?.objectType, "an edge to the type its relation reaches").toBe("Email");
		expect((await graph.getClusteredQuads({ perTypeLimit: 10, accessLevel: Access.private })).quads).toHaveLength(3);
		expect((await graph.getClusteredQuads({ perTypeLimit: 10, accessLevel: AccessQuery.all })).quads, "a read of every level reads at the widest").toHaveLength(3);
	});
});
