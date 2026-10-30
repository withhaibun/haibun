/**
 * A permission's containment in its bound, as ODRL 2.2 reads a ZCAP-LD capability. A capability stays a ZCAP-LD document, and
 * alignment axioms give its terms their ODRL meaning: `sec:invocationTarget` is `odrl:target`, `sec:allowedAction` is
 * `odrl:action`, `sec:controller` is `odrl:assignee`, the parent's controller is the assigner, and `sec:expires` is a
 * constraint on the dateTime of a use. Only permissions and constraints apply, since a capability only narrows authority. A
 * candidate is contained in its bound where the bound allows each of its actions, covers its target, and ends at or after the
 * candidate's end, or after its use. An entry allows an action where it is the action, or a prefix ending in `*` that begins it, so `*`
 * allows every action; a read at a level allows each narrower level. A target covers itself and each path under it. The
 * candidate that exceeds its bound has a witness: each action, target and expiry the bound doesn't allow.
 */
import { DataFactory } from "n3";
import type { NamedNode, Quad, Term } from "@rdfjs/types";
import { ACCESS_BROADEST_FIRST, narrowerAccess } from "@haibun/core/lib/domains/resources.js";
import { EXCEEDS, NEVER_EXPIRES, readAction, type TExceeding, type TPermission } from "@haibun/core/lib/domains/actions.js";
import { LOG, MATH, ODRL, OWL, RDFS, SEC, STRING, XSD } from "@haibun/core/lib/domains/vocabularies.js";
import { REASONER_NAMESPACE } from "../domains/reasoning.js";
import { literalSubject, pattern, quadsText, ruleText, type TN3Pattern } from "./n3.js";

const { namedNode, literal, blankNode, quad } = DataFactory;
const h = (name: string): NamedNode => namedNode(`${REASONER_NAMESPACE}${name}`);
/** The terms a containment's facts and query name: the candidate and its bound, a candidate's bound, a use's time, containment,
 *  an entry allowing an action, a read a read action allows, a target within another, and what exceeds. */
export const CONTAINMENT_TERM = {
	candidate: h("candidate"),
	bound: h("bound"),
	boundedBy: h("boundedBy"),
	usedAt: h("usedAt"),
	containedIn: h("containedIn"),
	allows: h("allows"),
	allowsRead: h("allowsRead"),
	within: h("within"),
	exceeds: h("exceeds"),
};
/** The term of each kind of what a candidate holds beyond its bound. */
export const EXCEEDING: Record<keyof typeof EXCEEDS, NamedNode> = { action: h("exceedsAction"), target: h("exceedsTarget"), expires: h("exceedsExpiry") };
const T = CONTAINMENT_TERM;
const SCOPE = "?scope";
const dateTime = (at: string) => literal(at, namedNode(XSD.dateTime));

/** Each read action with each read it allows: its own level and each narrower one. */
const readGrammar = (): Quad[] =>
	ACCESS_BROADEST_FIRST.flatMap((held) =>
		ACCESS_BROADEST_FIRST.filter((asked) => narrowerAccess(held, asked) === asked).map((asked) =>
			quad(literalSubject(literal(readAction(held))), T.allowsRead, literal(readAction(asked))),
		),
	);

/** A rule whose body reads a candidate bounded by its bound, with what else it reads. */
const bounded = (...more: TN3Pattern[]): TN3Pattern[] => [pattern("?c", T.boundedBy, "?b"), ...more];
/** The constraint a capability's expiry states on the dateTime of a use, as ODRL states it. */
const constraint = blankNode("constraint");

/** The alignment axioms, the action grammar, target containment, the constraint on a use's time, and containment with its witness. */
export const CONTAINMENT_RULES = [
	quadsText([
		quad(namedNode(SEC.invocationTarget), namedNode(OWL.equivalentProperty), namedNode(ODRL.target)),
		quad(namedNode(SEC.allowedAction), namedNode(OWL.equivalentProperty), namedNode(ODRL.action)),
		quad(namedNode(SEC.controller), namedNode(OWL.equivalentProperty), namedNode(ODRL.assignee)),
		...readGrammar(),
		...Object.values(EXCEEDING).map((kind) => quad(kind, namedNode(RDFS.subPropertyOf), T.exceeds)),
	]),
	ruleText([pattern("?p", OWL.equivalentProperty, "?q"), pattern("?s", "?p", "?o")], [pattern("?s", "?q", "?o")]),
	ruleText([pattern("?c", SEC.parentCapability, "?p"), pattern("?p", ODRL.assignee, "?a")], [pattern("?c", ODRL.assigner, "?a")]),
	ruleText([pattern("?c", SEC.parentCapability, "?p")], [pattern("?c", T.boundedBy, "?p")]),
	ruleText(
		[pattern("?c", SEC.expires, "?e")],
		[
			pattern("?c", ODRL.constraint, constraint),
			pattern(constraint, ODRL.leftOperand, ODRL.dateTime),
			pattern(constraint, ODRL.operator, ODRL.lt),
			pattern(constraint, ODRL.rightOperand, "?e"),
		],
	),
	ruleText(bounded(pattern("?b", ODRL.action, "?held"), pattern("?c", ODRL.action, "?a"), pattern("?held", LOG.equalTo, "?a")), [pattern("?held", T.allows, "?a")]),
	ruleText(
		bounded(
			pattern("?b", ODRL.action, "?held"),
			pattern({ list: [DataFactory.variable("held"), literal("^(.*)\\*$")] }, STRING.scrape, "?prefix"),
			pattern("?c", ODRL.action, "?a"),
			pattern("?a", STRING.startsWith, "?prefix"),
		),
		[pattern("?held", T.allows, "?a")],
	),
	ruleText(bounded(pattern("?b", ODRL.action, "?held"), pattern("?held", T.allowsRead, "?a"), pattern("?c", ODRL.action, "?a")), [pattern("?held", T.allows, "?a")]),
	ruleText(bounded(pattern("?b", ODRL.target, "?o"), pattern("?c", ODRL.target, "?t"), pattern("?o", LOG.equalTo, "?t")), [pattern("?t", T.within, "?o")]),
	ruleText(
		bounded(
			pattern("?b", ODRL.target, "?o"),
			pattern("?c", ODRL.target, "?t"),
			pattern({ list: [DataFactory.variable("o"), literal("/")] }, STRING.concatenation, "?under"),
			pattern("?t", STRING.startsWith, "?under"),
		),
		[pattern("?t", T.within, "?o")],
	),
	ruleText(bounded(pattern("?b", ODRL.target, "?o"), pattern("?o", STRING.endsWith, literal("/")), pattern("?c", ODRL.target, "?t"), pattern("?t", STRING.startsWith, "?o")), [
		pattern("?t", T.within, "?o"),
	]),
	ruleText(bounded(pattern("?c", ODRL.action, "?a"), pattern(SCOPE, LOG.notIncludes, { formula: [pattern("?b", ODRL.action, "?held"), pattern("?held", T.allows, "?a")] })), [
		pattern("?c", EXCEEDING.action, "?a"),
	]),
	ruleText(bounded(pattern("?c", ODRL.target, "?t"), pattern(SCOPE, LOG.notIncludes, { formula: [pattern("?b", ODRL.target, "?o"), pattern("?t", T.within, "?o")] })), [
		pattern("?c", EXCEEDING.target, "?t"),
	]),
	ruleText(
		bounded(
			pattern("?c", ODRL.constraint, "?k"),
			pattern("?k", ODRL.rightOperand, "?e"),
			pattern("?b", ODRL.constraint, "?l"),
			pattern("?l", ODRL.rightOperand, "?f"),
			pattern("?e", MATH.greaterThan, "?f"),
		),
		[pattern("?c", EXCEEDING.expires, "?e")],
	),
	ruleText(bounded(pattern("?c", T.usedAt, "?t"), pattern("?b", ODRL.constraint, "?l"), pattern("?l", ODRL.rightOperand, "?f"), pattern("?t", MATH.notLessThan, "?f")), [
		pattern("?c", EXCEEDING.expires, "?t"),
	]),
	ruleText(
		bounded(
			pattern("?b", ODRL.constraint, "?l"),
			pattern(SCOPE, LOG.notIncludes, { formula: [pattern("?c", ODRL.constraint, "?k")] }),
			pattern(SCOPE, LOG.notIncludes, { formula: [pattern("?c", T.usedAt, "?t")] }),
		),
		[pattern("?c", EXCEEDING.expires, literal(NEVER_EXPIRES))],
	),
	ruleText([pattern("?p", RDFS.subPropertyOf, T.exceeds), pattern("?c", "?p", "?w")], [pattern("?c", T.exceeds, "?w")]),
	ruleText(bounded(pattern(SCOPE, LOG.notIncludes, { formula: [pattern("?c", T.exceeds, "?w")] })), [pattern("?c", T.containedIn, "?b")]),
].join("\n");

/** The query: what the candidate holds beyond its bound, or its containment. */
export const CONTAINMENT_QUERY = [
	ruleText([pattern(T.candidate, "?p", "?w"), pattern("?p", RDFS.subPropertyOf, T.exceeds)], [pattern(T.candidate, "?p", "?w")]),
	ruleText([pattern(T.candidate, T.containedIn, T.bound)], [pattern(T.candidate, T.containedIn, T.bound)]),
].join("\n");

/** A permission's facts in ZCAP-LD's terms, as its JSON-LD expands them, about `subject`. */
export function permissionFacts(subject: NamedNode, { actions, target, expires, usedAt }: TPermission): Quad[] {
	return [
		...actions.map((action) => quad(subject, namedNode(SEC.allowedAction), literal(action))),
		...(target === undefined ? [] : [quad(subject, namedNode(SEC.invocationTarget), literal(target))]),
		...(expires === undefined ? [] : [quad(subject, namedNode(SEC.expires), dateTime(expires))]),
		...(usedAt === undefined ? [] : [quad(subject, T.usedAt, dateTime(usedAt))]),
	];
}

/** The facts of a candidate bounded by its bound. */
export const containmentFacts = (candidate: TPermission, bound: TPermission): string =>
	quadsText([quad(T.candidate, T.boundedBy, T.bound), ...permissionFacts(T.candidate, candidate), ...permissionFacts(T.bound, bound)]);

/** Each witness the quads state: the permission that exceeds, and what it holds beyond its bound, by kind. */
export function witnessesIn(quads: readonly Quad[]): (TExceeding & { subject: Term })[] {
	const kinds = Object.entries(EXCEEDING) as [keyof typeof EXCEEDS, NamedNode][];
	return quads.flatMap(({ subject, predicate, object }) => kinds.filter(([, kind]) => kind.equals(predicate)).map(([kind]) => ({ subject, kind, value: object.value })));
}

/** Returns what the query's quads state the candidate holds beyond its bound. Throws where they state only other quads, since
 *  the rules derive the candidate's containment or what exceeds its bound. */
export function exceedingOf(quads: readonly Quad[]): TExceeding[] {
	const exceeding = witnessesIn(quads).map(({ kind, value }) => ({ kind, value }));
	if (exceeding.length === 0 && !quads.some(({ predicate }) => predicate.equals(T.containedIn)))
		throw new Error("the containment's proof states only other quads, and the rules derive the candidate's containment or what exceeds its bound. Check the containment rules.");
	return exceeding;
}
