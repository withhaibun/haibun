/**
 * A source's term graph as the scene draws it: the quads and clusters of the graph every projected view draws (graph-quads.ts),
 * with the styles the projection requests: its hollow nodes, the badges on its clusters, and the statements behind each node
 * and edge, which a hover shows. A node behind several formulas states each of their statements once.
 */
import { edgeKey } from "@haibun/logic/derivations/term-graph.js";
import type { TProjection } from "@haibun/logic/domains/logic.js";
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import { graphToQuads } from "../../derivations/graph-quads.js";
import type { TSceneStyles } from "../domains/graph-scene.js";

/** Between the statements behind a node. */
const BETWEEN_STATEMENTS = " · ";

export function termScene({ formulas, nodes, edges, clusters }: TProjection): { quads: TQuad[]; clusters: TCluster[]; styles: TSceneStyles } {
	const statements = new Map(formulas.map(({ name, statement }) => [name, statement]));
	const statementOf = (formula: string): string => {
		const statement = statements.get(formula);
		if (statement === undefined) throw new Error(`the term graph names the formula ${formula}, which the projection doesn't hold`);
		return statement;
	};
	const behind = new Map<string, string>();
	for (const node of nodes) behind.set(node.id, [...new Set(node.formulas.map(statementOf))].join(BETWEEN_STATEMENTS));
	for (const { from, label, to, formula } of edges) behind.set(edgeKey(from, label, to), statementOf(formula));
	const drawn = graphToQuads({ nodes: nodes.map(({ id, label, kind }) => ({ id, label, kind })), edges: edges.map(({ from, to, label }) => ({ from, to, label })) });
	const hollow = new Set(nodes.filter((node) => node.hollow).map(({ id }) => id));
	return { ...drawn, styles: { hollow, badges: new Map(clusters.map(({ kind, badge }) => [kind, badge])), behind } };
}
