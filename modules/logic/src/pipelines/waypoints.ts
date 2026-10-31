/**
 * Waypoints' proofs on the reasoner. A proof of a line requests a waypoint's head through the waypoint effect, and this pipeline
 * runs a session of `src/rules/waypoints.n3` over the proofs of the waypoints the head reaches: a nested head is a backward goal
 * of the same session, and a step is a call of the line's proof. Each effect of the session is
 * performed once for its request, since EYE may evaluate a rule's body again. The session passes down the keys of the
 * applications above each, across the proofs of steps whose statements nest a session of their own, so a cycle that crosses
 * sessions is unknown, and it refuses a session nested past `MAX_NESTED_SESSIONS`.
 */
import { DataFactory } from "n3";
import type { Quad, Term } from "@rdfjs/types";
import { VERDICT, type TVerdict } from "@haibun/core/lib/domains/protocol.js";
import { RDF } from "@haibun/core/lib/domains/vocabularies.js";
import type { TArgsBinding, TBinding, TCloseRequest } from "../domains/logic.js";
import { RULE_SET, REASONER_NAMESPACE, type TReasonerValue } from "../domains/reasoning.js";
import { derive } from "./reason.js";
import { listItems, quadsOf, termIn } from "../derivations/n3.js";
import { list } from "../derivations/terms.js";
import type { TReasoner } from "../ports.js";

/** The most waypoint sessions that nest, each in an effect of the one above it, before a proof is refused as unknown. */
export const MAX_NESTED_SESSIONS = 5;
/** The most applications nested in one session, which bounds a proof whose arguments change at each application. */
export const MAX_APPLICATIONS = 1000;

/** What encloses a position of a proof: the keys of the applications above it, outermost first, and how many waypoint sessions. */
export type TWaypointScope = { ancestors: readonly string[]; sessions: number };

/** A line of a waypoint's proof as its session reads it: a step the proof calls, or a head applied beneath it, by its node. */
export type TProofLine = { kind: "call"; node: string } | { kind: "apply"; node: string; head: string };
/** Why a verdict isn't proved: the position of the part that gave it or a reason the engine states, as a node's close states it. */
export type TWhy = TCloseRequest["why"];
/** An application a proof opened: the arguments it read, as a binding, and its key, its head with those arguments. */
export type TApplied = { binding: TArgsBinding; key: string };

/** What a waypoint session performs through the proof of the line: each head's proof lines, the scope of a position, an
 *  application's open and close, and a step's call in its scope. */
export type TWaypointHost = {
	lines: (head: string) => readonly TProofLine[];
	scope: (path: readonly number[]) => TWaypointScope;
	open: (path: readonly number[], node: string, bindings: readonly TBinding[]) => Promise<TApplied | "refused">;
	call: (path: readonly number[], node: string, bindings: readonly TBinding[], scope: TWaypointScope) => Promise<TVerdict>;
	close: (path: readonly number[], node: string, verdict: TVerdict, why: TWhy) => Promise<void>;
};

/** What a session proves of a head: `prove`, its record and its proof, as a goal in a proof; `judge`, the proof of an application
 *  the line opened, open world, so a proof that doesn't hold leaves the head unknown; and `check`, that application's proof alone. */
export const SESSION_MODE = { prove: "prove", judge: "judge", check: "check" } as const;
export type TSessionMode = (typeof SESSION_MODE)[keyof typeof SESSION_MODE];
/** A session's request: what it proves, the head's node, head and bindings, the position its lines start after, the group they take
 *  in the line's proof, and the application the line opened where it opened one. */
export type TWaypointRequest = { mode: TSessionMode; node: string; head: string; bindings: readonly TBinding[]; base: number; group: string; opened?: TApplied };
/** A session's outcome: the verdict, why, how many positions under the head its lines took, and the parts of the proof, each a call
 *  or an application by its position and group, as the line's proof asserts them. */
export type TSessionOutcome = { verdict: TVerdict; why: TWhy; used: number; parts: string[] };

/** An application of the session: its record's position, node, head and key, the bindings its lines read, its arguments first,
 *  the position its lines start after, the group they take, and the application above it. */
type TApplication = { path: number[]; node: string; head: string; key: string; bindings: TBinding[]; base: number; group: string; above?: TApplication };

/** The IRI a value names, where it is a named node. */
const iriOf = (value: TReasonerValue | undefined): string | undefined => (typeof value === "object" && "termType" in value ? value.value : undefined);
const h = termIn(REASONER_NAMESPACE);
const ROOT = h("root").value;
const SESSION = h("session").value;
const RESULT = h("result").value;
const APPLICATION = `${REASONER_NAMESPACE}application/`;
const headIri = (head: string): string => `<${REASONER_NAMESPACE}waypoint/${encodeURIComponent(head)}>`;
const EFFECT_KIND = { open: h("open").value, call: h("call").value, close: h("close").value };
/** The group of the lines of an application the session opened, as the line's proof names its first proof. */
export const proofGroup = (attempt: number): string => `proof(${attempt})`;
/** The verdicts the rules write, and the reason they state where an application is past its bound. */
const VERDICTS: ReadonlySet<string> = new Set(Object.values(VERDICT));
const DEPTH = "depth";
const PREFIX = `@prefix h: <${REASONER_NAMESPACE}> .\n`;
/** The query of each mode: what it proves of the root, and the result it derives. */
const QUERY: Record<TSessionMode, string> = {
	prove: "{ h:session h:ancestors ?a . (h:root 0 ?a) h:applied ?r } => { h:session h:result ?r } .",
	judge: "{ h:session h:opened (?p ?k ?w) ; h:ancestors ?a . (?p ?k ?w ?a) h:verdict ?r } => { h:session h:result ?r } .",
	check: "{ h:session h:opened (?p ?k ?w) ; h:ancestors ?a . (?p ?k ?w ?a) h:checked ?r } => { h:session h:result ?r } .",
};

/** Proves a waypoint's head in a session, and returns its outcome. */
export async function waypointProof(reasoner: TReasoner, host: TWaypointHost, path: readonly number[], request: TWaypointRequest): Promise<TSessionOutcome> {
	const enclosing = host.scope(path);
	const parts: string[] = [];
	let used = 0;
	const outcome = (verdict: TVerdict, why: TWhy): TSessionOutcome => ({ verdict, why, used, parts });
	if (enclosing.sessions >= MAX_NESTED_SESSIONS) return await refusedNesting(host, path, request, outcome);
	const applications: TApplication[] = [];
	const applicationOf = (opened: TApplied, at: readonly number[], node: string, head: string, bindings: readonly TBinding[], above?: TApplication): TApplication => {
		const application = {
			path: [...at],
			node,
			head,
			key: opened.key,
			bindings: [opened.binding, ...bindings],
			base: above === undefined ? request.base : 0,
			group: above === undefined ? request.group : proofGroup(1),
			above,
		};
		applications.push(application);
		return application;
	};
	if (request.opened !== undefined) applicationOf(request.opened, path, request.node, request.head, request.bindings);
	const keysOf = (application: TApplication | undefined): string[] => (application === undefined ? [] : [...keysOf(application.above), application.key]);
	const positionOf = (application: TApplication, at: number): number[] => {
		if (application.above === undefined) used = Math.max(used, at);
		return [...application.path, application.base + at];
	};
	const whyOf = (application: TApplication | undefined, why: TReasonerValue): TWhy => {
		if (typeof why === "number") {
			if (application === undefined) throw new Error("a waypoint's proof gave a position outside an application. Check src/rules/waypoints.n3.");
			return positionOf(application, why);
		}
		return why === DEPTH ? `depth(${MAX_APPLICATIONS})` : String(why);
	};
	const applicationAt = (named: TReasonerValue | undefined): TApplication => {
		const value = iriOf(named);
		const held = value?.startsWith(APPLICATION) === true ? applications[Number(value.slice(APPLICATION.length))] : undefined;
		if (held === undefined) throw new Error(`a waypoint's proof named an application it didn't open, ${JSON.stringify(named)}. Check src/rules/waypoints.n3.`);
		return held;
	};
	const heads = reachedHeads(host, request.head);
	const effects: Record<string, (args: readonly TReasonerValue[]) => Promise<TReasonerValue>> = {
		[EFFECT_KIND.open]: async ([parentIri, at]) => {
			const parent = iriOf(parentIri) === ROOT ? undefined : applicationAt(parentIri);
			const line = parent === undefined ? { node: request.node, head: request.head } : applyLine(heads, parent.head, Number(at));
			const opensAt = parent === undefined ? [...path] : positionOf(parent, Number(at));
			const bindings = parent === undefined ? request.bindings : parent.bindings;
			const opened = await host.open(opensAt, line.node, bindings);
			if (opened === "refused") return "refused";
			applicationOf(opened, opensAt, line.node, line.head, bindings, parent);
			return [DataFactory.namedNode(`${APPLICATION}${applications.length - 1}`), opened.key, DataFactory.namedNode(headIri(line.head).slice(1, -1))];
		},
		[EFFECT_KIND.call]: async ([named, at]) => {
			const application = applicationAt(named);
			const position = positionOf(application, Number(at));
			const line = lineAt(heads, application.head, Number(at));
			const verdict = await host.call(position, line.node, application.bindings, { ancestors: [...enclosing.ancestors, ...keysOf(application)], sessions: enclosing.sessions + 1 });
			parts.push(`part(${list(position.map(String))}, ${application.group}, call(${verdict}))`);
			return verdict;
		},
		[EFFECT_KIND.close]: async ([named, result]) => {
			const application = applicationAt(named);
			const [verdict, why] = resultOf(result);
			await host.close(application.path, application.node, verdict, whyOf(application, why));
			const { above } = application;
			if (above !== undefined) parts.push(`part(${list(application.path.map(String))}, ${above.group}, node(apply, ${verdict}))`);
			return verdict;
		},
	};
	const performed = new Map<string, TReasonerValue>();
	const perform = async ([kind, ...args]: readonly TReasonerValue[]): Promise<TReasonerValue> => {
		const key = JSON.stringify([kind, ...args]);
		const held = performed.get(key);
		if (held !== undefined) return held;
		const named = iriOf(kind);
		const effect = named === undefined ? undefined : effects[named];
		if (effect === undefined)
			throw new Error(`a waypoint's proof requested the effect ${JSON.stringify(kind)}, which this pipeline doesn't perform. Check src/rules/waypoints.n3.`);
		const done = await effect(args);
		performed.set(key, done);
		return done;
	};
	const [root] = applications;
	const facts = [
		...[...heads].map(([head, lines]) => `${headIri(head)} h:proof (${lines.map(({ kind }) => JSON.stringify(kind)).join(" ")}) .`),
		`h:session h:maxDepth ${MAX_APPLICATIONS} ; h:ancestors (${enclosing.ancestors.map((key) => JSON.stringify(key)).join(" ")}) .`,
		...(root === undefined ? [] : [`h:session h:opened (<${APPLICATION}0> ${JSON.stringify(root.key)} ${headIri(root.head)}) .`]),
	];
	const effect = async (requested: readonly TReasonerValue[]) => [await perform(requested)];
	const sources = `${reasoner.rules(RULE_SET.waypoints)}\n${PREFIX}${facts.join("\n")}`;
	const derived = await derive(reasoner, sources, `${PREFIX}${QUERY[request.mode]}`, false, { effect }, "a waypoint's proof reads through its effects");
	const [verdict, why] = resultOf(sessionResult(quadsOf(derived)));
	return outcome(verdict, whyOf(applications[0], why));
}

/** The outcome of a waypoint effect nested past `MAX_NESTED_SESSIONS`: unknown, with the record of a head the session would open
 *  opened and closed with that reason. */
async function refusedNesting(
	host: TWaypointHost,
	path: readonly number[],
	request: TWaypointRequest,
	outcome: (verdict: TVerdict, why: TWhy) => TSessionOutcome,
): Promise<TSessionOutcome> {
	const why = `nesting(${MAX_NESTED_SESSIONS})`;
	if (request.mode === SESSION_MODE.prove && (await host.open(path, request.node, request.bindings)) !== "refused") await host.close(path, request.node, VERDICT.unknown, why);
	return outcome(VERDICT.unknown, why);
}

/** Each head the head reaches through its proof's applications, with its proof's lines. */
function reachedHeads(host: TWaypointHost, head: string): Map<string, readonly TProofLine[]> {
	const reached = new Map<string, readonly TProofLine[]>();
	const pending = [head];
	for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
		if (reached.has(next)) continue;
		const lines = host.lines(next);
		reached.set(next, lines);
		for (const line of lines) if (line.kind === "apply") pending.push(line.head);
	}
	return reached;
}

const lineAt = (heads: ReadonlyMap<string, readonly TProofLine[]>, head: string, at: number): TProofLine => {
	const line = heads.get(head)?.[at - 1];
	if (line === undefined) throw new Error(`a waypoint's proof named line ${at} of "${head}", which its proof doesn't hold. Check src/rules/waypoints.n3.`);
	return line;
};
const applyLine = (heads: ReadonlyMap<string, readonly TProofLine[]>, head: string, at: number): { node: string; head: string } => {
	const line = lineAt(heads, head, at);
	if (line.kind !== "apply") throw new Error(`a waypoint's proof applied line ${at} of "${head}", which is a step's call. Check src/rules/waypoints.n3.`);
	return line;
};

/** A verdict the rules wrote and why, from its list. */
function resultOf(value: TReasonerValue | undefined): [TVerdict, TReasonerValue] {
	const [verdict, why] = Array.isArray(value) ? value : [];
	if (typeof verdict !== "string" || !VERDICTS.has(verdict) || why === undefined)
		throw new Error(`a waypoint's proof gave ${JSON.stringify(value)}, which isn't a verdict with why. Check src/rules/waypoints.n3.`);
	return [verdict as TVerdict, why];
}

/** The result a session derived, as a value: a list's items, a string literal's text, or an integer. */
function sessionResult(quads: readonly Quad[]): TReasonerValue {
	const result = quads.find(({ subject, predicate }) => subject.value === SESSION && predicate.value === RESULT);
	if (result === undefined) throw new Error("a waypoint's session didn't derive its result. Check src/rules/waypoints.n3.");
	const resultValueOf = (term: Term): TReasonerValue => {
		if (term.termType === "Literal") return term.datatype.value.endsWith("#integer") ? Number(term.value) : term.value;
		if (term.termType === "BlankNode" || term.value === RDF.nil) return listItems(quads, term).map(resultValueOf);
		return term;
	};
	return resultValueOf(result.object);
}
