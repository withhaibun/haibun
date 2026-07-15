import { z } from "zod";
import { AStepper, type TStepperStep } from "./astepper.js";
import type { TWorld } from "./world.js";
import type { TActionResult } from "../schema/protocol.js";
import { HYPERMEDIA } from "../schema/protocol.js";
import { namedInterpolation } from "./namedVars.js";
import { constructorName } from "./util/index.js";
import { normalizeDomainKey } from "./domains.js";

/**
 * Inject hypermedia markers (`_type`, `_summary`, and where applicable `_component`,
 * `id`, `view`) into a step's products. The single source of truth is the registered
 * domain: every step with a `productsDomain` gets markers; their values come from the
 * domain's `ui` configuration. Steps with `productsSchema` (no domain registration) get
 * no markers — they are local typed outputs, not domain-scoped resources. Actions never
 * emit `_type` / `_summary` themselves.
 *
 * - `_type` is the registered `ui.component` if set, else the domain key.
 * - `_summary` is `ui.summary` — either a string template or a function taking the
 *   products object. Falls back to the domain key.
 * - `_component`, `id`, `view` are injected only when the domain has `ui.component`,
 *   because those markers exist for the SPA's pane-opener and are meaningless for
 *   diagnostic/data-only domains.
 *
 * If `_component` is already present in products (a step explicitly setting its own),
 * the entire augmentation is skipped to preserve the action's intent.
 */
export function augmentViewHypermedia(world: TWorld, step: TStepperStep, actionResult: TActionResult, steppers: AStepper[]): TActionResult {
	if (!actionResult.ok || !actionResult.products) return actionResult;
	const productsDomain = step.productsDomain;
	if (!productsDomain) return actionResult;
	const products = actionResult.products as Record<string, unknown>;
	if (typeof products[HYPERMEDIA.COMPONENT] === "string") return actionResult;
	const domain = world.domains[normalizeDomainKey(productsDomain)];
	const ui = domain?.ui;
	const component = typeof ui?.component === "string" ? ui.component : undefined;
	const rawSummary = ui?.summary;
	let summary: string;
	if (typeof rawSummary === "function") summary = String((rawSummary as (p: Record<string, unknown>) => unknown)(products));
	else if (typeof rawSummary === "string") summary = rawSummary;
	else summary = productsDomain;
	const markers: Record<string, unknown> = {
		[HYPERMEDIA.TYPE]: component ?? productsDomain,
		[HYPERMEDIA.SUMMARY]: summary,
	};
	// The producing domain's own description, surfaced inline so a consumer (human, LLM, agent) can interpret the result
	// without a round-trip to `step.list` — the description travels with the data. It is the SAME text the type's view
	// shows (buildConcernCatalog reads this field too): a domain describes itself once, and a second description on its
	// schema would be a second answer to one question, free to drift from the one a reader is shown.
	if (domain?.description) markers[HYPERMEDIA.DESCRIPTION] = domain.description;
	if (component) {
		markers[HYPERMEDIA.COMPONENT] = component;
		markers.id = productsDomain;
		markers.view = productsDomain;
	}
	// Next-action affordances: enumerate every other step whose paramDomains accept this product's productsDomain as input. The consumer (SPA row menu, an LLM looking at "what can I do with this", agent navigation) reads `_links` to discover follow-on verbs without scanning step.list themselves. Same `{method, params?}` shape every other `_links` entry uses; rels are keyed by the unprefixed stepName so each affordance is named by intent rather than by step-method address.
	const links = deriveActionLinks(productsDomain, products, steppers, world);
	if (Object.keys(links).length > 0) markers[HYPERMEDIA.LINKS] = links;
	return { ...actionResult, products: { ...products, ...markers } };
}

/**
 * Walk every registered step's gwta param domains and return a `_links` map of the
 * verbs that accept this product's domain as one of their inputs. One entry per
 * matching step, keyed by the step's bare name (no stepperName prefix) so the
 * affordance is named by intent, not by method address.
 *
 * Matching is in two layers:
 *   1. direct — a step's param domain equals the product's domain.
 *   2. ref→individual — a step's param domain is a ref domain whose
 *      `topology.ranges.id` points at the product's domain. This is how
 *      `individualRefDomain(refKey, targetKey)` declares "this ref's id ranges
 *      over a targetKey individual"; the affordance derivation follows that
 *      declared range so revoke/suspend/recover (which accept the ref) link
 *      to individuals produced by issue (which produces the target).
 *
 * The params skeleton: if the product carries a top-level `id`, populate the
 * matching parameter with `{ id: <product.id> }` (the convention every individual
 * ref domain uses today — `{record: {id}}`, `{label, id}` for getIndividual,
 * etc.). Otherwise pass an empty object — the consumer fills the rest from the
 * step's own inputSchema (already in step.list).
 *
 * H1: a single derivation; no per-step authoring needed.
 */
function deriveActionLinks(
	productsDomain: string,
	products: Record<string, unknown>,
	steppers: AStepper[],
	world: TWorld,
): Record<string, { method: string; params?: Record<string, unknown> }> {
	const out: Record<string, { method: string; params?: Record<string, unknown> }> = {};
	const productId = typeof products.id === "string" ? products.id : undefined;
	const matchesProduct = (paramDomain: string): boolean => {
		if (paramDomain === productsDomain) return true;
		// Some gwta params declare a union domain (e.g. `string | page-locator`) — those carry no single-domain topology to follow, so skip them. normalizeDomainKey throws on misordered unions; guard with try/catch so a single quirky param doesn't break affordance derivation for every product the step produces.
		let refDomain: { topology?: { ranges?: { id?: string } } } | undefined;
		try {
			refDomain = world.domains?.[normalizeDomainKey(paramDomain)];
		} catch {
			return false;
		}
		const ranges = refDomain?.topology && "ranges" in refDomain.topology ? refDomain.topology.ranges : undefined;
		return ranges?.id === productsDomain;
	};
	for (const stepper of steppers) {
		const stepperName = constructorName(stepper);
		for (const [stepName, stepDef] of Object.entries(stepper.steps)) {
			if (!stepDef.gwta) continue;
			const { stepValuesMap } = namedInterpolation(stepDef.gwta);
			if (!stepValuesMap) continue;
			const matching: string[] = [];
			for (const v of Object.values(stepValuesMap)) {
				if (v.domain && matchesProduct(v.domain)) matching.push(v.term);
			}
			if (matching.length === 0) continue;
			const method = `${stepperName}-${stepName}`;
			const params: Record<string, unknown> = {};
			if (productId !== undefined) {
				for (const paramName of matching) params[paramName] = { id: productId };
			}
			out[stepName] = Object.keys(params).length > 0 ? { method, params } : { method };
		}
	}
	return out;
}

/**
 * A domain that exists only to render a view (its schema is empty, its `ui.component`
 * names the pane to open) carries no knowledge worth chaining on. Asserting such a
 * "fact" creates a loop: each affordances refresh sees the asserted view, includes
 * it in the snapshot, and the SPA re-opens the pane, accumulating duplicates.
 *
 * A domain is view-only iff it declares `ui.component` AND its registered schema
 * has no fields. Real product-bearing domains (DOMAIN_AFFORDANCES, DOMAIN_CHAIN_LINT,
 * domain-key, etc.) carry data even if they ALSO map to a view, and stay assertable.
 */
export function isViewOnlyDomain(world: TWorld, domainKey: string): boolean {
	const domain = world.domains[normalizeDomainKey(domainKey)];
	if (!domain?.ui?.component || typeof domain.ui.component !== "string") return false;
	// unrepresentable:"any" keeps the presence check working for a schema carrying a date (z.coerce.date has no JSON Schema form) — we only need to know whether it has fields, not to represent them.
	const jsonSchema = z.toJSONSchema(domain.schema, { unrepresentable: "any" }) as { properties?: Record<string, unknown>; type?: string };
	if (jsonSchema.type !== "object") return false;
	return !jsonSchema.properties || Object.keys(jsonSchema.properties).length === 0;
}
