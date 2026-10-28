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
import { ACCESS_BROADEST_FIRST, narrowerAccess } from "@haibun/core/lib/domains/resources.js";
import { EXCEEDS, NEVER_EXPIRES, readAction, type TExceeding, type TPermission } from "@haibun/core/lib/domains/actions.js";
import { REASONER_NAMESPACE, type TTriple } from "../domains/reasoning.js";

const DATE_TIME = "http://www.w3.org/2001/XMLSchema#dateTime";
/** The IRIs a containment's facts and query name: the candidate and its bound, a candidate's bound, a use's time, containment,
 *  an entry allowing an action, and what exceeds. */
export const CONTAINMENT_TERM = {
	candidate: `${REASONER_NAMESPACE}candidate`,
	bound: `${REASONER_NAMESPACE}bound`,
	boundedBy: `${REASONER_NAMESPACE}boundedBy`,
	usedAt: `${REASONER_NAMESPACE}usedAt`,
	containedIn: `${REASONER_NAMESPACE}containedIn`,
	allows: `${REASONER_NAMESPACE}allows`,
	exceeds: `${REASONER_NAMESPACE}exceeds`,
};
/** The IRI of each kind of what a candidate holds beyond its bound. */
export const EXCEEDING: Record<keyof typeof EXCEEDS, string> = {
	action: `${REASONER_NAMESPACE}exceedsAction`,
	target: `${REASONER_NAMESPACE}exceedsTarget`,
	expires: `${REASONER_NAMESPACE}exceedsExpiry`,
};
const SECURITY = "https://w3id.org/security#";
const [ALLOWED_ACTION, INVOCATION_TARGET, EXPIRES] = [`${SECURITY}allowedAction`, `${SECURITY}invocationTarget`, `${SECURITY}expires`];
/** ZCAP-LD's term for the capability a delegation narrows, which bounds it. */
export const PARENT_CAPABILITY = `${SECURITY}parentCapability`;

const PREFIXES = `@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix log: <http://www.w3.org/2000/10/swap/log#> .
@prefix math: <http://www.w3.org/2000/10/swap/math#> .
@prefix string: <http://www.w3.org/2000/10/swap/string#> .
@prefix odrl: <http://www.w3.org/ns/odrl/2/> .
@prefix sec: <${SECURITY}> .
@prefix h: <${REASONER_NAMESPACE}> .`;

/** Each read action with each read it allows: its own level and each narrower one. */
const readGrammar = (): string =>
	ACCESS_BROADEST_FIRST.map(
		(held) =>
			`${JSON.stringify(readAction(held))} h:allowsRead ${ACCESS_BROADEST_FIRST.filter((asked) => narrowerAccess(held, asked) === asked)
				.map((asked) => JSON.stringify(readAction(asked)))
				.join(", ")} .`,
	).join("\n");

/** The alignment axioms, the action grammar, target containment, the constraint on a use's time, and containment with its witness. */
export const CONTAINMENT_RULES = `${PREFIXES}
sec:invocationTarget owl:equivalentProperty odrl:target .
sec:allowedAction owl:equivalentProperty odrl:action .
sec:controller owl:equivalentProperty odrl:assignee .
{ ?p owl:equivalentProperty ?q . ?s ?p ?o } => { ?s ?q ?o } .
{ ?c sec:parentCapability ?p . ?p odrl:assignee ?a } => { ?c odrl:assigner ?a } .
{ ?c sec:parentCapability ?p } => { ?c h:boundedBy ?p } .
{ ?c sec:expires ?e } => { ?c odrl:constraint [ odrl:leftOperand odrl:dateTime ; odrl:operator odrl:lt ; odrl:rightOperand ?e ] } .
${readGrammar()}
{ ?c h:boundedBy ?b . ?b odrl:action ?held . ?c odrl:action ?a . ?held log:equalTo ?a } => { ?held h:allows ?a } .
{ ?c h:boundedBy ?b . ?b odrl:action ?held . (?held "^(.*)\\\\*$") string:scrape ?prefix . ?c odrl:action ?a . ?a string:startsWith ?prefix } => { ?held h:allows ?a } .
{ ?c h:boundedBy ?b . ?b odrl:action ?held . ?held h:allowsRead ?a . ?c odrl:action ?a } => { ?held h:allows ?a } .
{ ?c h:boundedBy ?b . ?b odrl:target ?o . ?c odrl:target ?t . ?o log:equalTo ?t } => { ?t h:within ?o } .
{ ?c h:boundedBy ?b . ?b odrl:target ?o . ?c odrl:target ?t . (?o "/") string:concatenation ?under . ?t string:startsWith ?under } => { ?t h:within ?o } .
{ ?c h:boundedBy ?b . ?b odrl:target ?o . ?o string:endsWith "/" . ?c odrl:target ?t . ?t string:startsWith ?o } => { ?t h:within ?o } .
h:exceedsAction rdfs:subPropertyOf h:exceeds .
h:exceedsTarget rdfs:subPropertyOf h:exceeds .
h:exceedsExpiry rdfs:subPropertyOf h:exceeds .
{ ?c h:boundedBy ?b . ?c odrl:action ?a . ?SCOPE log:notIncludes { ?b odrl:action ?held . ?held h:allows ?a } } => { ?c h:exceedsAction ?a } .
{ ?c h:boundedBy ?b . ?c odrl:target ?t . ?SCOPE log:notIncludes { ?b odrl:target ?o . ?t h:within ?o } } => { ?c h:exceedsTarget ?t } .
{ ?c h:boundedBy ?b . ?c odrl:constraint ?k . ?k odrl:rightOperand ?e . ?b odrl:constraint ?l . ?l odrl:rightOperand ?f . ?e math:greaterThan ?f } => { ?c h:exceedsExpiry ?e } .
{ ?c h:boundedBy ?b . ?c h:usedAt ?t . ?b odrl:constraint ?l . ?l odrl:rightOperand ?f . ?t math:notLessThan ?f } => { ?c h:exceedsExpiry ?t } .
{ ?c h:boundedBy ?b . ?b odrl:constraint ?l . ?SCOPE log:notIncludes { ?c odrl:constraint ?k } . ?SCOPE log:notIncludes { ?c h:usedAt ?t } } => { ?c h:exceedsExpiry ${JSON.stringify(NEVER_EXPIRES)} } .
{ ?p rdfs:subPropertyOf h:exceeds . ?c ?p ?w } => { ?c h:exceeds ?w } .
{ ?c h:boundedBy ?b . ?SCOPE log:notIncludes { ?c h:exceeds ?w } } => { ?c h:containedIn ?b } .`;

/** The query: what the candidate holds beyond its bound, or its containment. */
export const CONTAINMENT_QUERY = `${PREFIXES}
{ h:candidate ?p ?w . ?p rdfs:subPropertyOf h:exceeds } => { h:candidate ?p ?w } .
{ h:candidate h:containedIn h:bound } => { h:candidate h:containedIn h:bound } .`;

const dateTime = (at: string): string => `${JSON.stringify(at)}^^<${DATE_TIME}>`;

/** A permission's facts in ZCAP-LD's terms, as its JSON-LD expands them, under `iri`. */
export function permissionFacts(iri: string, { actions, target, expires, usedAt }: TPermission): string[] {
	return [
		...actions.map((action) => `<${iri}> <${ALLOWED_ACTION}> ${JSON.stringify(action)} .`),
		...(target === undefined ? [] : [`<${iri}> <${INVOCATION_TARGET}> ${JSON.stringify(target)} .`]),
		...(expires === undefined ? [] : [`<${iri}> <${EXPIRES}> ${dateTime(expires)} .`]),
		...(usedAt === undefined ? [] : [`<${iri}> <${CONTAINMENT_TERM.usedAt}> ${dateTime(usedAt)} .`]),
	];
}

/** The facts of a candidate bounded by its bound. */
export const containmentFacts = (candidate: TPermission, bound: TPermission): string =>
	[
		`<${CONTAINMENT_TERM.candidate}> <${CONTAINMENT_TERM.boundedBy}> <${CONTAINMENT_TERM.bound}> .`,
		...permissionFacts(CONTAINMENT_TERM.candidate, candidate),
		...permissionFacts(CONTAINMENT_TERM.bound, bound),
	].join("\n");

/** The value of a literal as EYE writes it, without its datatype. */
const literalValue = (term: string): string => JSON.parse(term.replace(/\^\^<[^>]*>$/, "")) as string;

/** Each witness the triples state: the permission that exceeds, as N3 writes it, and what it holds beyond its bound, by kind. */
export function witnessesIn(triples: readonly TTriple[]): (TExceeding & { subject: string })[] {
	const kinds = Object.entries(EXCEEDING) as [keyof typeof EXCEEDS, string][];
	return triples.flatMap(({ subject, predicate, object }) => kinds.filter(([, iri]) => predicate === `<${iri}>`).map(([kind]) => ({ subject, kind, value: literalValue(object) })));
}

/** Returns what the query's triples state the candidate holds beyond its bound. Throws where they state only other triples,
 *  since the rules derive the candidate's containment or what exceeds its bound. */
export function exceedingOf(triples: readonly TTriple[]): TExceeding[] {
	const exceeding = witnessesIn(triples).map(({ kind, value }) => ({ kind, value }));
	if (exceeding.length === 0 && !triples.some(({ predicate }) => predicate === `<${CONTAINMENT_TERM.containedIn}>`))
		throw new Error("the containment's proof states only other triples, and the rules derive the candidate's containment or what exceeds its bound. Check the containment rules.");
	return exceeding;
}
