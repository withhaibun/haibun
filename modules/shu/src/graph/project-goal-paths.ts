/**
 * Pure projection from one goal's resolver finding into a combined `TGraph`.
 *
 * Each michi (path) is a chain of steps: the last step produces the goal, and
 * any earlier step in `m.steps` produces a sub-domain that fills one of the
 * goal-step's composite field slots. The projection mirrors this exactly:
 *
 *   - Step nodes are emitted up-front with `kind: "default"` and an `invokes`
 *     payload so a click handler can start the chain. Steps are shared
 *     across paths by `(stepperName, stepName)`; a step that appears in
 *     every path renders as one node with its incoming edges tagged with
 *     every participating path id. Every step also carries its
 *     `productsDomain`, so the projection builds a map
 *     `productsDomain → stepNodeId`.
 *   - Bindings flow into the LAST step (the goal producer). A composite-kind
 *     field whose `fieldDomain` has a producer step in this michi routes its
 *     sub-fields INTO that producer step instead of attaching them to the
 *     field slot; the producer step's output edge then fills the slot. So a
 *     sub-composite field whose domain is `B` and a step in the chain that
 *     produces `B` end up structurally connected: the sub-fields go into the
 *     `B`-producing step, and that step's output becomes the slot's value.
 *   - Edges are labelled with the slot or domain they carry — field name on
 *     value-into-slot edges, produced domain on producer-step output edges,
 *     binding domain on binding-to-goal-step edges. Mermaid renders the
 *     labels alongside each arrow so the reader sees which argument fills
 *     which slot without inferring it from layout.
 *   - Edges shared across paths are merged via `EdgeBag` and their `paths`
 *     array unions every participating path id; mermaid renders one arrow
 *     and the consumer's `highlightedPath` option dims the others.
 *
 * Primitive argument fields (no `fieldDomain`, or one identical to the field
 * name) render as `argument`-kind nodes so the path's entry points stand out
 * from intermediate composite slots. A typed-composite argument whose domain
 * has no producer chain still emits a separate `argument`-kind node carrying
 * the domain name — the field slot itself stays a structural `field` node
 * because the user supplies the typed value, not the slot.
 *
 * `pathId(i)` is the stable id used in `TGraphEdge.paths` and in the
 * `TGraphRenderOptions.highlightedPath` option — the consumer chooses which
 * path to emphasise by passing the same id back.
 */
import type { TBinding, TFieldBinding, TMichi } from "@haibun/core/lib/goal-resolver.js";
import type { TGraph, TGraphEdge, TGraphNode } from "./types.js";

export function pathId(index: number): string {
	return `path-${index}`;
}

function stepNodeId(stepperName: string, stepName: string): string {
	return `step:${stepperName}.${stepName}`;
}

function bindingNodeId(domain: string): string {
	return `arg:${domain}`;
}

function fieldNodeId(parentDomain: string, fieldPath: string): string {
	return `field:${parentDomain}#${fieldPath}`;
}

/**
 * Edge accumulator. Edges with the same `(from, to, kind, label)` are merged
 * so a route used by every path renders as one arrow; the merged entry's
 * `paths` is the union of every participating path id.
 */
class EdgeBag {
	private readonly byKey = new Map<string, TGraphEdge>();

	add(edge: TGraphEdge): void {
		const key = `${edge.from}|${edge.to}|${edge.kind ?? "default"}|${edge.label ?? ""}`;
		const existing = this.byKey.get(key);
		if (!existing) {
			this.byKey.set(key, { ...edge, paths: edge.paths ? [...edge.paths] : undefined });
			return;
		}
		if (!edge.paths) return;
		const merged = new Set(existing.paths ?? []);
		for (const p of edge.paths) merged.add(p);
		existing.paths = [...merged];
	}

	values(): TGraphEdge[] {
		return [...this.byKey.values()];
	}
}

type TEmitContext = {
	nodes: Map<string, TGraphNode>;
	edges: EdgeBag;
	pid: string;
	/** productsDomain → stepNodeId. Used to route a composite field through the step that produces its domain. */
	producerByDomain: Map<string, string>;
};

/**
 * Emit a top-level binding (the input to the goal step). Returns the node id
 * the binding ultimately resolves to, so the caller can connect it to the
 * step that consumes it.
 */
function emitBinding(binding: TBinding, ctx: TEmitContext): string {
	if (binding.kind === "argument") {
		const id = bindingNodeId(binding.domain);
		if (!ctx.nodes.has(id)) ctx.nodes.set(id, { id, label: binding.domain, kind: "argument" });
		return id;
	}
	if (binding.kind === "fact") {
		const id = `fact:${binding.domain}#${binding.factId}`;
		if (!ctx.nodes.has(id))
			ctx.nodes.set(id, {
				id,
				label: `${binding.domain}#${binding.factId}`,
				kind: "satisfied",
				wasGeneratedBy: { factId: binding.factId, domain: binding.domain },
			});
		return id;
	}
	// Composite binding: emit a structural node for the composite, recurse into
	// each field, draw `field → composite` edges so the assembled composite is
	// what the consuming step receives.
	const compositeId = `composite:${binding.domain}`;
	if (!ctx.nodes.has(compositeId)) ctx.nodes.set(compositeId, { id: compositeId, label: binding.domain, kind: "reachable" });
	for (const field of binding.fields) {
		emitField(field, binding.domain, "", compositeId, ctx);
	}
	return compositeId;
}

function emitField(field: TFieldBinding, parentDomain: string, parentPath: string, parentNodeId: string, ctx: TEmitContext): void {
	const fieldPath = parentPath ? `${parentPath}.${field.fieldName}` : field.fieldName;
	const fieldId = fieldNodeId(parentDomain, fieldPath);
	const fieldLabel = field.fieldDomain ? `${field.fieldName} : ${field.fieldDomain}` : field.fieldName;
	// Primitive arguments (no typed domain) render as yellow `argument` nodes
	// so the chain's entry points are visible. Typed slots and intermediate
	// composite fields stay purple — the incoming edge from the producer step
	// or typed-argument node tells the reader where the value comes from.
	const isPrimitiveArgument = field.kind === "argument" && (!field.fieldDomain || field.fieldDomain === field.fieldName);
	ctx.nodes.set(fieldId, { id: fieldId, label: fieldLabel, kind: isPrimitiveArgument ? "argument" : "field" });

	if (field.kind === "argument") {
		const argDomain = field.fieldDomain;
		if (argDomain && argDomain !== field.fieldName) {
			const argId = bindingNodeId(argDomain);
			if (!ctx.nodes.has(argId)) ctx.nodes.set(argId, { id: argId, label: argDomain, kind: "argument" });
			ctx.edges.add({ from: argId, to: fieldId, kind: "ready", paths: [ctx.pid], label: field.fieldName });
		}
	} else if (field.kind === "fact") {
		const factId = `fact:${field.fieldDomain}#${field.factId}`;
		if (!ctx.nodes.has(factId))
			ctx.nodes.set(factId, {
				id: factId,
				label: `${field.fieldDomain}#${field.factId}`,
				kind: "satisfied",
				wasGeneratedBy: { factId: field.factId, domain: field.fieldDomain ?? "" },
			});
		ctx.edges.add({ from: factId, to: fieldId, kind: "ready", paths: [ctx.pid], label: field.fieldName });
	} else {
		// Composite field. If a step in this michi produces the field's
		// domain, the field is satisfied by that step — route the sub-fields
		// into the producer step and connect the step's output to the field
		// slot. Otherwise the sub-fields attach directly to the slot
		// (primitive composite or pure user-supplied aggregate).
		const producerStepId = field.fieldDomain ? ctx.producerByDomain.get(field.fieldDomain) : undefined;
		if (producerStepId) {
			for (const sub of field.fields) emitField(sub, field.fieldDomain || parentDomain, fieldPath, producerStepId, ctx);
			ctx.edges.add({ from: producerStepId, to: fieldId, kind: "ready", paths: [ctx.pid], label: field.fieldDomain ?? "" });
		} else {
			for (const sub of field.fields) emitField(sub, field.fieldDomain || parentDomain, fieldPath, fieldId, ctx);
		}
	}
	ctx.edges.add({ from: fieldId, to: parentNodeId, kind: "ready", paths: [ctx.pid], label: field.fieldName });
}

export type TGoalPathsInput = {
	goal: string;
	finding: string;
	michi: TMichi[];
	/**
	 * Fact ids that already satisfy the goal (only meaningful when
	 * `finding === "satisfied"`). Rendered as fact nodes pointing at the
	 * goal so the diagram shows *what* satisfies it even when there are no
	 * run-again paths. Without this, a satisfied goal with empty `michi`
	 * would project to a single isolated goal node.
	 */
	factIds?: string[];
};

export function projectGoalPaths(input: TGoalPathsInput): TGraph {
	const nodes = new Map<string, TGraphNode>();
	const edges = new EdgeBag();
	const goalId = `goal:${input.goal}`;
	const goalKind = input.finding === "satisfied" ? "satisfied" : "reachable";
	nodes.set(goalId, { id: goalId, label: input.goal, kind: goalKind });

	// Render satisfying facts as nodes pointing at the goal so a satisfied
	// resolution always has a graph to show, not just a lone goal node.
	if (input.factIds && input.factIds.length > 0) {
		for (const factId of input.factIds) {
			const id = `fact:${input.goal}#${factId}`;
			if (!nodes.has(id))
				nodes.set(id, {
					id,
					label: `${input.goal}#${factId}`,
					kind: "satisfied",
					wasGeneratedBy: { factId, domain: input.goal },
				});
			edges.add({ from: id, to: goalId, kind: "ready", label: "satisfies" });
		}
	}

	input.michi.forEach((m, pathIndex) => {
		const pid = pathId(pathIndex);

		// Emit every step in the path as a node, sharing across paths by
		// `(stepperName, stepName)` so a step used by N paths renders once.
		// EdgeBag then merges the value-into-step edges so a step common to
		// every path takes one incoming arrow tagged with every pid. The
		// resolver produces steps in dependency order (sub-producers first,
		// goal step at the tail); the projection keeps that order in `stepIds`.
		const stepIds: string[] = [];
		const producerByDomain = new Map<string, string>();
		m.steps.forEach((step) => {
			const stepId = stepNodeId(step.stepperName, step.stepName);
			stepIds.push(stepId);
			producerByDomain.set(step.productsDomain, stepId);
			if (!nodes.has(stepId)) {
				nodes.set(stepId, {
					id: stepId,
					label: step.gwta ?? `${step.stepperName}.${step.stepName}`,
					kind: "default",
					invokes: { stepperName: step.stepperName, stepName: step.stepName },
				});
			}
		});

		const lastStepId = stepIds[stepIds.length - 1];
		const ctx: TEmitContext = { nodes, edges, pid, producerByDomain };

		// Bindings are the input the goal-producing step consumes. Route them
		// directly into that step; the composite field machinery in `emitField`
		// handles producer routing for sub-domains.
		for (const binding of m.bindings) {
			const sourceId = emitBinding(binding, ctx);
			const sourceDomain = binding.kind === "composite" ? binding.domain : binding.kind === "fact" ? binding.domain : binding.domain;
			edges.add({ from: sourceId, to: lastStepId, kind: "ready", paths: [pid], label: sourceDomain });
		}

		// A bindings-less michi (e.g. a step that takes no graph-typed input)
		// still needs a visible connection from its first step to the goal.
		edges.add({ from: lastStepId, to: goalId, kind: "ready", paths: [pid], label: input.goal });
	});

	return { nodes: [...nodes.values()], edges: edges.values(), direction: "LR" };
}
