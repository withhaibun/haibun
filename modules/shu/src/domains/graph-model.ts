/** The graph model the overview and the polymorphic view draw: nodes, the edges between them, and the property keys a build merges onto a node. */
import type { TCluster } from "@haibun/core/lib/quad-types.js";
import type { TCounted } from "@haibun/core/lib/hypermedia.js";

export type GraphNode = { id: string; type: string; isCluster?: boolean; omitted?: TCounted; displayLabel?: string; properties: Record<string, unknown> };

export type GraphEdge = { from: string; to: string; predicate: string; graph: string };
export type GraphModel = { nodes: GraphNode[]; edges: GraphEdge[] };

/** Names the node property that holds the resolved HypermediaRole. The value is the id of the party (a `prov:Agent`/Principal) to which the node is attributed. `buildGraphModelFromQuads` reduces it from the node's role edges (see `roleRels`). The polymorphic view's role grouping axis reads it. */
export const HYPERMEDIA_ROLE_KEY = "hypermediaRole";

/** Names the node property that holds a party's own role predicate. The value is the highest-priority role rel (a `fromActor`/`toActor`, see `roleRels`) among the role edges that target the party. A party is one node. Its role is relational because the party is the target of a role edge, so the value comes from the incoming role edges and not from the node's `@type`. A display site maps this predicate to the party's role designation. */
export const HYPERMEDIA_ROLE_REL_KEY = "hypermediaRoleRel";

/** Names the node property that holds the site principal of the instance whose store served the node. The value is a read-time store fact stamped at the federation merge and is never persisted. HAIBUN_SITE_KEY is a different key: it holds the env override for this instance's own principal. The polymorphic view's site grouping axis reads this property. */
export const SITE_KEY = "site";

export type TBuildGraphModelOptions = {
	clusters?: TCluster[];
	/** Lists the predicates, in priority order, whose target is the node's HypermediaRole. The build merges each node's role onto `properties[HYPERMEDIA_ROLE_KEY]` where this is set, so a pure group-key selector reads the role without walking the edges again. */
	roleRels?: readonly string[];
	/** Names the responding instance's site principal. It is the serving site of every node that a cluster's `sites` doesn't override. The build merges each node's serving site onto `properties[SITE_KEY]` where this is set. */
	site?: string;
};
