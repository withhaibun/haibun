/**
 * The facts of a permission's containment in its bound, which `src/rules/containment.n3` reads as ODRL 2.2 reads a ZCAP-LD
 * capability, and what the query's quads state the candidate holds beyond its bound. The facts state the read grammar: each
 * read action with each read it allows, its own level and each narrower one.
 */
import { DataFactory } from "n3";
import type { NamedNode, Quad, Term } from "@rdfjs/types";
import { ACCESS_BROADEST_FIRST, narrowerAccess } from "@haibun/core/lib/domains/resources.js";
import { EXCEEDS, NEVER_EXPIRES, readAction, type TExceeding, type TPermission } from "@haibun/core/lib/domains/actions.js";
import { SEC, XSD } from "@haibun/core/lib/domains/vocabularies.js";
import { REASONER_NAMESPACE } from "../domains/reasoning.js";
import { literalSubject, quadsText } from "./n3.js";

const { namedNode, literal, quad } = DataFactory;
const h = (name: string): NamedNode => namedNode(`${REASONER_NAMESPACE}${name}`);
/** The terms a containment's facts and query name: the candidate and its bound, a candidate's bound, a use's time, containment,
 *  an entry allowing an action, a read a read action allows, what exceeds, and the expiry that stands for a candidate that
 *  doesn't state one. */
export const CONTAINMENT_TERM = {
	candidate: h("candidate"),
	bound: h("bound"),
	boundedBy: h("boundedBy"),
	usedAt: h("usedAt"),
	containedIn: h("containedIn"),
	allows: h("allows"),
	allowsRead: h("allowsRead"),
	exceeds: h("exceeds"),
	unstatedExpiry: h("unstatedExpiry"),
	expiry: h("expiry"),
};
/** The term of each kind of what a candidate holds beyond its bound. */
export const EXCEEDING: Record<keyof typeof EXCEEDS, NamedNode> = { action: h("exceedsAction"), target: h("exceedsTarget"), expires: h("exceedsExpiry") };
const T = CONTAINMENT_TERM;
const dateTime = (at: string) => literal(at, namedNode(XSD.dateTime));

/** Each read action with each read it allows: its own level and each narrower one. */
const readGrammar = (): Quad[] =>
	ACCESS_BROADEST_FIRST.flatMap((held) =>
		ACCESS_BROADEST_FIRST.filter((asked) => narrowerAccess(held, asked) === asked).map((asked) =>
			quad(literalSubject(literal(readAction(held))), T.allowsRead, literal(readAction(asked))),
		),
	);

/** A permission's facts in ZCAP-LD's terms, as its JSON-LD expands them, about `subject`. */
export function permissionFacts(subject: NamedNode, { actions, target, expires, usedAt }: TPermission): Quad[] {
	return [
		...actions.map((action) => quad(subject, namedNode(SEC.allowedAction), literal(action))),
		...(target === undefined ? [] : [quad(subject, namedNode(SEC.invocationTarget), literal(target))]),
		...(expires === undefined ? [] : [quad(subject, namedNode(SEC.expires), dateTime(expires))]),
		...(usedAt === undefined ? [] : [quad(subject, T.usedAt, dateTime(usedAt))]),
	];
}

/** The facts every containment reads beside its permissions: the read grammar, and the expiry that stands for a candidate that
 *  doesn't state one. */
export const containmentGrammar = (): Quad[] => [...readGrammar(), quad(T.unstatedExpiry, T.expiry, literal(NEVER_EXPIRES))];

/** The facts of a candidate bounded by its bound. */
export const containmentFacts = (candidate: TPermission, bound: TPermission): string =>
	quadsText([...containmentGrammar(), quad(T.candidate, T.boundedBy, T.bound), ...permissionFacts(T.candidate, candidate), ...permissionFacts(T.bound, bound)]);

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
