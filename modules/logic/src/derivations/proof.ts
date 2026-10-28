/**
 * Reads the proof EYE writes where it explains what it derived: the W3C N3 proof vocabulary (`r:Proof`, `r:Inference`,
 * `r:Extraction`), each step with what it gives, the steps it rests on and the rule it applied. EYE writes it in N3 with each
 * IRI in full, so the reader takes N3's terms, formulas, lists and blank nodes, which are what EYE's proof writes.
 */
import type { TProof, TProofStep, TTriple } from "../domains/reasoning.js";

/** The namespace of the N3 proof vocabulary. */
const REASON = "http://www.w3.org/2000/10/swap/reason#";
const RDF_TYPE = "<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>";
const reasonTerm = (name: string): string => `<${REASON}${name}>`;
const [PROOF, INFERENCE, EXTRACTION] = [reasonTerm("Proof"), reasonTerm("Inference"), reasonTerm("Extraction")];
const [GIVES, EVIDENCE, RULE] = [reasonTerm("gives"), reasonTerm("evidence"), reasonTerm("rule")];
const [COMPONENT, BECAUSE, SOURCE] = [reasonTerm("component"), reasonTerm("because"), reasonTerm("source")];

/** An N3 term as the proof writes it: an IRI or a literal as written, a formula's statements, a list, or a blank node's pairs. */
type TTerm = string | { formula: TStatement[] } | { list: TTerm[] } | { blank: Array<[string, TTerm]> };
type TStatement = { subject: TTerm; predicate: string; object: TTerm };

const TOKEN = /<[^>]*>|"(?:[^"\\]|\\.)*"(?:\^\^<[^>]*>|@[\w-]+)?|@forAll|@forSome|=>|[{}()[\];,.]|[^\s{}()[\];,.]+/g;

/** Reads the N3 statements of `text`. Throws, naming the token, where the text isn't the N3 a proof writes. */
function statementsOf(text: string): TStatement[] {
	const tokens = [...text.matchAll(TOKEN)].map(([token]) => token);
	let at = 0;
	const next = (): string => {
		const token = tokens[at];
		if (token === undefined) throw new Error("EYE's proof ended inside a statement. Read the whole of what EYE printed.");
		at += 1;
		return token;
	};
	const expect = (wanted: string): void => {
		const token = next();
		if (token !== wanted) throw new Error(`EYE's proof holds \`${token}\` where \`${wanted}\` closes its term.`);
	};
	const term = (): TTerm => {
		const token = next();
		if (token === "{") return { formula: statements("}") };
		if (token === "(") {
			const list: TTerm[] = [];
			while (tokens[at] !== ")") list.push(term());
			expect(")");
			return { list };
		}
		if (token === "[") {
			const pairs = predicateObjects("]");
			expect("]");
			return { blank: pairs };
		}
		return token;
	};
	const predicateObjects = (end: string): Array<[string, TTerm]> => {
		const pairs: Array<[string, TTerm]> = [];
		while (tokens[at] !== end && tokens[at] !== ".") {
			const predicate = next();
			pairs.push([predicate, term()]);
			while (tokens[at] === ",") {
				at += 1;
				pairs.push([predicate, term()]);
			}
			if (tokens[at] === ";") at += 1;
		}
		return pairs;
	};
	const statements = (end: string | undefined): TStatement[] => {
		const read: TStatement[] = [];
		while (at < tokens.length && tokens[at] !== end) {
			if (tokens[at] === "@forAll" || tokens[at] === "@forSome") {
				while (next() !== ".");
				continue;
			}
			const subject = term();
			if (tokens[at] === "=>") {
				at += 1;
				read.push({ subject, predicate: "=>", object: term() });
			} else for (const [predicate, object] of predicateObjects(end === undefined ? "." : end)) read.push({ subject, predicate, object });
			if (tokens[at] === ".") at += 1;
		}
		if (end !== undefined) expect(end);
		return read;
	};
	return statements(undefined);
}

/** Writes an N3 term back as N3, so a formula, a list or a blank node a triple holds reads as N3 writes it. */
const n3Of = (term: TTerm): string => {
	if (typeof term === "string") return term;
	if ("formula" in term) return `{ ${term.formula.map(({ subject, predicate, object }) => `${n3Of(subject)} ${predicate} ${n3Of(object)} .`).join(" ")} }`;
	if ("list" in term) return `( ${term.list.map(n3Of).join(" ")} )`;
	return `[ ${term.blank.map(([predicate, object]) => `${predicate} ${n3Of(object)}`).join("; ")} ]`;
};

/** The triples of a formula, each term as N3 writes it. A rule isn't a triple, so a formula's rule isn't among its triples. */
const triplesIn = (formula: TTerm): TTriple[] =>
	typeof formula === "object" && "formula" in formula
		? formula.formula.flatMap(({ subject, predicate, object }) => (predicate === "=>" ? [] : [{ subject: n3Of(subject), predicate, object: n3Of(object) }]))
		: [];

/** Reads EYE's proof: its conclusion, and each step with what it gives, its evidence, its rule and its source. Where the query
 *  selects an empty set, EYE writes an empty text, which reads as a proof that gives an empty list. */
export function proofOf(text: string): TProof {
	const bySubject = Map.groupBy(
		statementsOf(text).filter((s): s is TStatement & { subject: string } => typeof s.subject === "string"),
		({ subject }) => subject,
	);
	const steps = [...bySubject].map(([step, held]): TProofStep => {
		const objects = (predicate: string) => held.filter((s) => s.predicate === predicate).map((s) => s.object);
		const types = objects(RDF_TYPE);
		const kind = types.includes(PROOF) ? "proof" : types.includes(INFERENCE) ? "inference" : types.includes(EXTRACTION) ? "extraction" : undefined;
		if (kind === undefined) throw new Error(`EYE's proof states ${step} without a kind of step. Read a proof EYE wrote.`);
		const evidence = objects(EVIDENCE).flatMap((list) => (typeof list === "object" && "list" in list ? list.list.filter((t): t is string => typeof t === "string") : []));
		const components = objects(COMPONENT).filter((t): t is string => typeof t === "string");
		const rule = objects(RULE).find((t): t is string => typeof t === "string");
		const because = objects(BECAUSE).find((t): t is { blank: Array<[string, TTerm]> } => typeof t === "object" && "blank" in t);
		const source = because?.blank.find(([predicate]) => predicate === SOURCE)?.[1];
		return {
			step,
			kind,
			gives: objects(GIVES).flatMap(triplesIn),
			evidence: [...evidence, ...components],
			...(rule === undefined ? {} : { rule }),
			...(typeof source === "string" ? { source } : {}),
		};
	});
	if (steps.length === 0) return { gives: [], steps };
	const proof = steps.find(({ kind }) => kind === "proof");
	if (proof === undefined) throw new Error("EYE's explanation doesn't state its proof. Run EYE with its proof explanation.");
	return { gives: proof.gives, steps };
}
