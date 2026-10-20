/**
 * TPTP FOF: the parse of one annotated formula to its tree, the refusal of a formula outside the engine's fragment with its
 * remedy, and a tree's rendering as TPTP text and in standard Unicode notation. The grammar is the TPTP syntax BNF
 * (https://www.tptp.org/TPTP/SyntaxBNF.html) for `fof`. The engine's fragment restricts it to Horn rules, negation as failure
 * in conditions, stated falsities, quantifiers over closed domains, and predicates the registry holds. A tree holds each name
 * without the single quotes TPTP writes around a name that isn't a lower word, so `'abc'` and `abc` are one name.
 */
import { TOKEN_ROLE, type TTokenRole } from "../domains/tokens.js";

/** A term: a variable (capitalized), or a constant or function applied to arguments. */
export type TTerm = { variable: string } | { functor: string; args: TTerm[] };
/** A formula's tree. */
export type TFormula =
	| { atom: string; args: TTerm[] }
	| { equal: boolean; left: TTerm; right: TTerm }
	| { not: TFormula }
	| { connective: string; left: TFormula; right: TFormula }
	| { quantifier: "!" | "?"; variables: string[]; body: TFormula };
/** An annotated formula: its name, its role and its formula. */
export type TAnnotated = { name: string; role: string; formula: TFormula };
/** A formula the fragment holds, or why the fragment doesn't hold it and what to state in its place. */
export type TFormulaCheck = { annotated: TAnnotated } | { reason: string; remedy: string };

/** Why a formula is refused, and what to state in its place. */
class Refusal extends Error {
	constructor(
		reason: string,
		readonly remedy: string,
	) {
		super(reason);
	}
}

const REMEDY = {
	disjunction: "split the rule into one rule per disjunct",
	existential: "name the individual that the conclusion states exists, as a constant or as a function of its variables",
	guard: "close the domain with set of, and guard the variable with member_of(X, d)",
	negatedConclusion: "state the falsity as a negated ground axiom",
	negatedFormula: "state the formula as a rule of its own, and negate that rule's atom",
	equivalence: "state each direction as a rule",
	connective: "restate the formula with ~, & and =>",
	role: "state the formula as fof, with the role axiom for a fact or a rule and conjecture for a goal",
	syntax: "write one annotated formula, fof(name, role, formula).",
	predicate: "name a step by its method, quoted as 'Stepper-step', with its parameters in its pattern's order, or guard a variable with member_of(X, d)",
} as const;

/** The predicate that guards a variable with a closed domain, and its arity. */
const GUARD = { name: "member_of", arity: 2 } as const;

/** The connectives the fragment refuses, with the remedy for each by its name. */
const REFUSED_CONNECTIVES: Readonly<Record<string, keyof typeof REMEDY>> = { "<=>": "equivalence", "<~>": "connective", "~|": "connective", "~&": "connective" };
const CONNECTIVES = ["<=>", "<~>", "=>", "<=", "~|", "~&", "&", "|"];
/** A token: a connective, a punctuation mark, a word, or a single-quoted name whose characters are the BNF's sq_char, printable
 *  ASCII with ' and \ escaped by \. */
const TOKEN = /\s*(<=>|<~>|=>|<=|~\||~&|!=|[(),.:[\]~&|=!?]|[A-Za-z][A-Za-z0-9_]*|'(?:[\x20-\x26\x28-\x5b\x5d-\x7e]|\\['\\])+')/y;
/** A name TPTP writes without quotes. */
const LOWER_WORD = /^[a-z][A-Za-z0-9_]*$/;
/** A name TPTP's single quotes hold once its ' and \ are escaped. */
const QUOTABLE = /^[\x20-\x7e]+$/;

/** A token's name, without its single quotes and the escapes of its ' and \. */
const unquoted = (token: string): string => (token.startsWith("'") ? token.slice(1, -1).replace(/\\(['\\])/g, "$1") : token);

function tokens(text: string): string[] {
	const found: string[] = [];
	TOKEN.lastIndex = 0;
	while (TOKEN.lastIndex < text.trimEnd().length) {
		const match = TOKEN.exec(text);
		if (match === null) throw new Refusal(`the formula holds text TPTP doesn't define at ${TOKEN.lastIndex}`, REMEDY.syntax);
		found.push(match[1] as string);
	}
	return found;
}

/** A recursive-descent parse of the tokens of one annotated formula. */
class Parser {
	private at = 0;
	constructor(private readonly toks: string[]) {}
	private peek = (): string | undefined => this.toks[this.at];
	private next(): string {
		const tok = this.toks[this.at++];
		if (tok === undefined) throw new Refusal("the formula ends before it is complete", REMEDY.syntax);
		return tok;
	}
	private expect(tok: string): void {
		const found = this.next();
		if (found !== tok) throw new Refusal(`the formula states ${found} where TPTP takes ${tok}`, REMEDY.syntax);
	}

	annotated(): TAnnotated {
		const language = this.next();
		if (language !== "fof") throw new Refusal(`the formula is ${language}, and the fragment reads fof`, REMEDY.role);
		this.expect("(");
		const name = unquoted(this.next());
		this.expect(",");
		const role = this.next();
		if (role !== "axiom" && role !== "conjecture") throw new Refusal(`the role ${role} isn't axiom or conjecture`, REMEDY.role);
		this.expect(",");
		const formula = this.formula();
		this.expect(")");
		this.expect(".");
		if (this.peek() !== undefined) throw new Refusal("the text holds more than one annotated formula", REMEDY.syntax);
		return { name, role, formula };
	}

	private formula(): TFormula {
		let left = this.unitary();
		for (let tok = this.peek(); tok !== undefined && CONNECTIVES.includes(tok); tok = this.peek()) {
			this.next();
			const refused = REFUSED_CONNECTIVES[tok];
			if (refused !== undefined) throw new Refusal(`the formula states ${tok}, which the fragment doesn't read`, REMEDY[refused]);
			left = { connective: tok, left, right: this.unitary() };
		}
		return left;
	}

	private unitary(): TFormula {
		const tok = this.next();
		if (tok === "(") {
			const inner = this.formula();
			this.expect(")");
			return inner;
		}
		if (tok === "~") return { not: this.unitary() };
		if (tok === "!" || tok === "?") {
			this.expect("[");
			const variables = [this.next()];
			while (this.peek() === ",") {
				this.next();
				variables.push(this.next());
			}
			this.expect("]");
			this.expect(":");
			return { quantifier: tok, variables, body: this.unitary() };
		}
		this.at -= 1;
		const left = this.term();
		const op = this.peek();
		if (op === "=" || op === "!=") {
			this.next();
			return { equal: op === "=", left, right: this.term() };
		}
		if ("variable" in left) throw new Refusal(`the variable ${left.variable} stands where the formula takes an atom`, REMEDY.syntax);
		return { atom: left.functor, args: left.args };
	}

	private term(): TTerm {
		const name = this.next();
		if (/^[A-Z]/.test(name)) return { variable: name };
		const functor = unquoted(name);
		if (this.peek() !== "(") return { functor, args: [] };
		this.next();
		const args = [this.term()];
		while (this.peek() === ",") {
			this.next();
			args.push(this.term());
		}
		this.expect(")");
		return { functor, args };
	}
}

const conjuncts = (f: TFormula): TFormula[] => ("connective" in f && f.connective === "&" ? [...conjuncts(f.left), ...conjuncts(f.right)] : [f]);
const variablesOf = (t: TTerm): string[] => ("variable" in t ? [t.variable] : t.args.flatMap(variablesOf));
const isLiteral = (f: TFormula): boolean => "atom" in f || "equal" in f || ("not" in f && ("atom" in f.not || "equal" in f.not));

/** Holds a rule's body to the fragment: a conjunction of literals, with an existential only over a condition. */
function checkBody(body: TFormula): void {
	for (const part of conjuncts(body)) {
		if ("quantifier" in part && part.quantifier === "?") checkBody(part.body);
		else if ("not" in part && !isLiteral(part)) throw new Refusal("~ stands before a formula that isn't an atom", REMEDY.negatedFormula);
		else if ("connective" in part && part.connective === "|") throw new Refusal("a rule's conditions hold a disjunction", REMEDY.disjunction);
		else if (!isLiteral(part) && !("quantifier" in part)) throw new Refusal("a rule's conditions hold a formula that isn't a literal", REMEDY.negatedFormula);
	}
}

/** Holds a rule's conclusion to the fragment: one atom. */
function checkHead(head: TFormula): void {
	if ("connective" in head && head.connective === "|") throw new Refusal("the conclusion is a disjunction", REMEDY.disjunction);
	if ("quantifier" in head && head.quantifier === "?") throw new Refusal("the conclusion states an existential", REMEDY.existential);
	if ("not" in head) throw new Refusal("~ stands before the conclusion", REMEDY.negatedConclusion);
	if (!("atom" in head)) throw new Refusal("the conclusion isn't one atom", REMEDY.disjunction);
}

/** The variables a body binds through a literal that isn't negated: a member_of guard or any other atom. */
const bound = (body: TFormula): string[] => conjuncts(body).flatMap((part) => ("atom" in part ? part.args.flatMap(variablesOf) : "quantifier" in part ? bound(part.body) : []));

/** Holds an axiom to the fragment: a ground literal, or a universally quantified Horn rule whose variables its body binds. */
function checkAxiom(formula: TFormula): void {
	if (isLiteral(formula)) {
		const free = "not" in formula ? ("atom" in formula.not ? formula.not.args.flatMap(variablesOf) : []) : "atom" in formula ? formula.args.flatMap(variablesOf) : [];
		if (free.length > 0) throw new Refusal(`the variables ${free.join(", ")} aren't quantified`, REMEDY.guard);
		return;
	}
	const rule = "quantifier" in formula && formula.quantifier === "!" ? formula.body : formula;
	const variables = "quantifier" in formula && formula.quantifier === "!" ? formula.variables : [];
	if ("quantifier" in formula && formula.quantifier === "?") throw new Refusal("an axiom states an existential", REMEDY.existential);
	if (!("connective" in rule) || (rule.connective !== "=>" && rule.connective !== "<=")) {
		if ("not" in rule) throw new Refusal("~ stands before a formula that isn't an atom", REMEDY.negatedFormula);
		throw new Refusal(`the variables ${variables.join(", ")} range over a domain the formula doesn't close`, REMEDY.guard);
	}
	const [body, head] = rule.connective === "=>" ? [rule.left, rule.right] : [rule.right, rule.left];
	checkHead(head);
	checkBody(body);
	const unbound = variables.filter((variable) => !bound(body).includes(variable));
	if (unbound.length > 0) throw new Refusal(`the variables ${unbound.join(", ")} range over a domain the conditions don't close`, REMEDY.guard);
}

/** The atoms of a formula, with each quantified and connected part's atoms. */
const atomsOf = (f: TFormula): Extract<TFormula, { atom: string }>[] =>
	"atom" in f ? [f] : "not" in f ? atomsOf(f.not) : "quantifier" in f ? atomsOf(f.body) : "connective" in f ? [...atomsOf(f.left), ...atomsOf(f.right)] : [];

/** Holds each predicate of a formula to the registry: the guard, or a predicate `known` holds with the arity it holds. */
function checkPredicates(formula: TFormula, known: ReadonlyMap<string, number>): void {
	for (const { atom, args } of atomsOf(formula)) {
		const arity = atom === GUARD.name ? GUARD.arity : known.get(atom);
		if (arity !== args.length) throw new Refusal(`the predicate ${atom}/${args.length} isn't an entry of the registry`, REMEDY.predicate);
	}
}

/** Returns the formula `read` returns, or why it refused the formula with its remedy. */
function refusing(read: () => TAnnotated): TFormulaCheck {
	try {
		return { annotated: read() };
	} catch (caught) {
		if (caught instanceof Refusal) return { reason: caught.message, remedy: caught.remedy };
		throw caught;
	}
}

/** Parses one annotated formula of TPTP FOF, or states why TPTP's grammar doesn't parse it with its remedy. */
export const parseFormula = (text: string): TFormulaCheck => refusing(() => new Parser(tokens(text)).annotated());

/** Parses one annotated formula and holds it to the fragment and its predicates to `known`, the registry's predicates by name
 *  with their arity, or states why the formula isn't held with its remedy. */
export function checkFormula(text: string, known: ReadonlyMap<string, number>): TFormulaCheck {
	const parsed = parseFormula(text);
	if (!("annotated" in parsed)) return parsed;
	const { annotated } = parsed;
	return refusing(() => {
		checkPredicates(annotated.formula, known);
		if (annotated.role === "axiom") checkAxiom(annotated.formula);
		return annotated;
	});
}

/** A name as TPTP writes it: a lower word as it stands, and every other name in single quotes with its ' and \ escaped. Throws
 *  for a name the quotes can't hold, which a caller names through `nameOfText` or `literalOf`. */
function nameText(name: string): string {
	if (LOWER_WORD.test(name)) return name;
	if (!QUOTABLE.test(name)) throw new Error(`TPTP's single quotes hold printable ASCII, and the name "${name}" holds other text; name a text through nameOfText or literalOf`);
	return `'${name.replace(/['\\]/g, "\\$&")}'`;
}

/** Each character outside printable ASCII, which a name escapes as JSON escapes it. */
const BEYOND_ASCII = /[^\x20-\x7e]/g;
/** A value as JSON writes it, with each character outside printable ASCII escaped as \uXXXX. */
const jsonText = (value: string | number | boolean): string => JSON.stringify(value).replace(BEYOND_ASCII, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** The name of a text, such as a record's id, a type, a predicate or a step's method: the text as JSON escapes it, so two texts
 *  never share a name and TPTP's quotes hold each. */
export const nameOfText = (text: string): string => jsonText(text).slice(1, -1);

/** A term that applies a functor to arguments, which is a constant where it doesn't take an argument. */
type TApplied = Extract<TTerm, { functor: string }>;

/** The constant that names a text. */
export const constantOf = (text: string): TApplied => ({ functor: nameOfText(text), args: [] });

/** The constant that names a literal value: its JSON text, so the text "1", the number 1 and the boolean true are three
 *  constants. */
export const literalOf = (value: string | number | boolean): TApplied => ({ functor: jsonText(value), args: [] });

/** The variable a rule names its term at `at` by, counted from 1. */
export const variableAt = (at: number): string => `X${at + 1}`;

/** The conjunction of one or more formulas, read from the left as the parser reads it. Throws for an empty list, which doesn't
 *  state a formula. */
export function conjunction(parts: readonly TFormula[]): TFormula {
	const [first, ...rest] = parts;
	if (first === undefined) throw new Error("a conjunction takes one formula or more; state the formulas it joins");
	return rest.reduce((held: TFormula, part) => ({ connective: "&", left: held, right: part }), first);
}

const UNICODE: Record<string, string> = { "&": "∧", "|": "∨", "=>": "→", "<=": "←" };

const termText = (t: TTerm): string => ("variable" in t ? t.variable : t.args.length === 0 ? nameText(t.functor) : `${nameText(t.functor)}(${t.args.map(termText).join(", ")})`);

/** An annotated formula as TPTP text, which formula.ts's parser and a prover such as Vampire or E read. */
export const tptpOf = ({ name, role, formula }: TAnnotated): string => `fof(${nameText(name)}, ${role}, ${tptpFormula(formula, false)}).`;

/** A formula as TPTP text. A binary formula is in parentheses where it is a unitary formula's part: the operand of ~, a
 *  quantifier's body, or a part of another binary formula other than the left part of a conjunction or disjunction, which
 *  TPTP reads as associative and the parser reads from the left. */
function tptpFormula(formula: TFormula, unitary: boolean): string {
	if ("atom" in formula) return termText({ functor: formula.atom, args: formula.args });
	if ("equal" in formula) return `${termText(formula.left)} ${formula.equal ? "=" : "!="} ${termText(formula.right)}`;
	if ("not" in formula) return `~${tptpFormula(formula.not, true)}`;
	if ("quantifier" in formula) return `${formula.quantifier}[${formula.variables.join(", ")}] : ${tptpFormula(formula.body, true)}`;
	const { connective, left, right } = formula;
	const chained = (connective === "&" || connective === "|") && "connective" in left && left.connective === connective;
	const text = `${tptpFormula(left, !chained)} ${connective} ${tptpFormula(right, true)}`;
	return unitary ? `(${text})` : text;
}

/** A token of a formula's Unicode rendering: its text, its role, and the term it renders, where it renders one. */
export type TToken = { text: string; role: TTokenRole; term?: TTerm };

const symbolOf = (text: string): TToken => ({ text, role: TOKEN_ROLE.symbol });

/** A named thing applied to arguments, in parentheses after its name where it takes one or more. */
const appliedTokens = (head: TToken, args: readonly TTerm[]): TToken[] =>
	args.length === 0 ? [head] : [head, symbolOf("("), ...args.flatMap((arg, at) => [...(at === 0 ? [] : [symbolOf(", ")]), ...termTokens(arg)]), symbolOf(")")];

/** A term's tokens: a variable, or a constant or a function with its arguments. */
const termTokens = (term: TTerm): TToken[] =>
	"variable" in term ? [{ text: term.variable, role: TOKEN_ROLE.variable, term }] : appliedTokens({ text: nameText(term.functor), role: TOKEN_ROLE.constant, term }, term.args);

/** A formula in standard Unicode notation, as tokens. A guard member_of(X, d) of a quantified rule renders as the bounded
 *  quantifier ∀X ∈ d. A disjunction or an implication nested in another formula is in parentheses. */
function tokensOf(formula: TFormula, nested: boolean): TToken[] {
	if ("atom" in formula) return appliedTokens({ text: nameText(formula.atom), role: TOKEN_ROLE.predicate }, formula.args);
	if ("equal" in formula) return [...termTokens(formula.left), symbolOf(formula.equal ? " = " : " ≠ "), ...termTokens(formula.right)];
	if ("not" in formula) return [symbolOf("¬"), ...tokensOf(formula.not, true)];
	if ("quantifier" in formula) {
		const [guard, rest] = guardOf(formula);
		const variables = formula.variables.flatMap((variable, at) => [...(at === 0 ? [] : [symbolOf(", ")]), ...termTokens({ variable })]);
		const bounded = guard === undefined ? variables : [...variables, symbolOf(" ∈ "), ...termTokens(guard)];
		return [symbolOf(formula.quantifier === "!" ? "∀" : "∃"), ...bounded, symbolOf(". "), ...tokensOf(rest, false)];
	}
	const tokens = [...tokensOf(formula.left, true), symbolOf(` ${UNICODE[formula.connective]} `), ...tokensOf(formula.right, true)];
	return nested && formula.connective !== "&" ? [symbolOf("("), ...tokens, symbolOf(")")] : tokens;
}

/** A formula in standard Unicode notation, as tokens. */
export const unicodeTokens = (formula: TFormula): TToken[] => tokensOf(formula, false);

/** A formula in standard Unicode notation. */
export const unicodeOf = (formula: TFormula): string =>
	unicodeTokens(formula)
		.map(({ text }) => text)
		.join("");

/** The domain a quantifier's one variable is guarded by, and the formula without the guard. */
function guardOf(formula: Extract<TFormula, { quantifier: string }>): [TTerm | undefined, TFormula] {
	const { body, variables } = formula;
	if (variables.length !== 1 || !("connective" in body) || body.connective !== "=>") return [undefined, body];
	const [first, ...others] = conjuncts(body.left);
	const guarded = first !== undefined && "atom" in first && first.atom === GUARD.name && termText(first.args[0] as TTerm) === variables[0];
	if (!guarded || first === undefined || !("atom" in first)) return [undefined, body];
	const domain = first.args[1] as TTerm;
	if (others.length === 0) return [domain, body.right];
	return [domain, { connective: "=>", left: conjunction(others), right: body.right }];
}
