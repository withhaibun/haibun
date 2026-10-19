/**
 * TPTP FOF in the engine's fragment: the parse of one annotated formula to its tree, the refusal of a formula outside the
 * fragment with its remedy, and its rendering in standard Unicode notation. The grammar is the TPTP syntax BNF
 * (https://www.tptp.org/TPTP/SyntaxBNF.html) for `fof`, restricted to Horn rules, negation as failure in conditions, stated
 * falsities, quantifiers over closed domains, and predicates the registry holds.
 */

/** A term: a variable (capitalized), or a constant or function applied to arguments. */
type TTerm = { variable: string } | { functor: string; args: TTerm[] };
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

/** The connectives the fragment refuses, with the remedy for each. */
const REFUSED_CONNECTIVES: Record<string, string> = { "<=>": REMEDY.equivalence, "<~>": REMEDY.connective, "~|": REMEDY.connective, "~&": REMEDY.connective };
const CONNECTIVES = ["<=>", "<~>", "=>", "<=", "~|", "~&", "&", "|"];
const TOKEN = /\s*(<=>|<~>|=>|<=|~\||~&|!=|[(),.:[\]~&|=!?]|[A-Za-z][A-Za-z0-9_]*|'[^']*')/y;

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
		const name = this.next();
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
			if (refused !== undefined) throw new Refusal(`the formula states ${tok}, which the fragment doesn't read`, refused);
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
		if (this.peek() !== "(") return { functor: name, args: [] };
		this.next();
		const args = [this.term()];
		while (this.peek() === ",") {
			this.next();
			args.push(this.term());
		}
		this.expect(")");
		return { functor: name, args };
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

/** A predicate's name without the quotes a quoted atom states. */
const predicateName = (functor: string): string => functor.replace(/^'(.*)'$/, "$1");

/** Holds each predicate of a formula to the registry: the guard, or a predicate `known` holds with the arity it holds. */
function checkPredicates(formula: TFormula, known: ReadonlyMap<string, number>): void {
	for (const { atom, args } of atomsOf(formula)) {
		const name = predicateName(atom);
		const arity = name === GUARD.name ? GUARD.arity : known.get(name);
		if (arity !== args.length) throw new Refusal(`the predicate ${name}/${args.length} isn't an entry of the registry`, REMEDY.predicate);
	}
}

/** Parses one annotated formula and holds it to the fragment and its predicates to `known`, the registry's predicates by name
 *  with their arity, or states why the formula isn't held with its remedy. */
export function checkFormula(text: string, known: ReadonlyMap<string, number>): TFormulaCheck {
	try {
		const annotated = new Parser(tokens(text)).annotated();
		checkPredicates(annotated.formula, known);
		if (annotated.role === "axiom") checkAxiom(annotated.formula);
		return { annotated };
	} catch (caught) {
		if (caught instanceof Refusal) return { reason: caught.message, remedy: caught.remedy };
		throw caught;
	}
}

const UNICODE: Record<string, string> = { "&": "∧", "|": "∨", "=>": "→", "<=": "←" };

const termText = (t: TTerm): string => ("variable" in t ? t.variable : t.args.length === 0 ? t.functor : `${t.functor}(${t.args.map(termText).join(", ")})`);

/** A formula in standard Unicode notation. A guard member_of(X, d) of a quantified rule renders as the bounded quantifier ∀X ∈ d. */
export const unicodeOf = (formula: TFormula): string => rendered(formula, false);

/** A formula in Unicode notation, in parentheses where it is a disjunction or an implication nested in another formula. */
function rendered(formula: TFormula, nested: boolean): string {
	if ("atom" in formula) return termText({ functor: formula.atom, args: formula.args });
	if ("equal" in formula) return `${termText(formula.left)} ${formula.equal ? "=" : "≠"} ${termText(formula.right)}`;
	if ("not" in formula) return `¬${rendered(formula.not, true)}`;
	if ("quantifier" in formula) {
		const symbol = formula.quantifier === "!" ? "∀" : "∃";
		const [guard, rest] = guardOf(formula);
		const bounded = guard === undefined ? formula.variables.join(", ") : `${formula.variables.join(", ")} ∈ ${guard}`;
		return `${symbol}${bounded}. ${rendered(rest, false)}`;
	}
	const text = `${rendered(formula.left, true)} ${UNICODE[formula.connective]} ${rendered(formula.right, true)}`;
	return nested && formula.connective !== "&" ? `(${text})` : text;
}

/** The domain a quantifier's one variable is guarded by, and the formula without the guard. */
function guardOf(formula: Extract<TFormula, { quantifier: string }>): [string | undefined, TFormula] {
	const { body, variables } = formula;
	if (variables.length !== 1 || !("connective" in body) || body.connective !== "=>") return [undefined, body];
	const [first, ...others] = conjuncts(body.left);
	const guarded = first !== undefined && "atom" in first && first.atom === "member_of" && termText(first.args[0] as TTerm) === variables[0];
	if (!guarded || first === undefined || !("atom" in first)) return [undefined, body];
	const domain = termText(first.args[1] as TTerm);
	if (others.length === 0) return [domain, body.right];
	const left = others.reduce((held: TFormula, part) => ({ connective: "&", left: held, right: part }));
	return [domain, { connective: "=>", left, right: body.right }];
}
