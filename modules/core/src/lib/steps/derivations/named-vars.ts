/**
 * A step's phrase as a pattern: each `{name}` or `{name: domain}` placeholder becomes a named capture group, and a line
 * that matches the pattern gives each placeholder its term and its origin. Each phrase is compiled once, and a match
 * reads the compiled pattern, so resolving a statement at runtime doesn't compile a step's pattern again.
 */
import type { TStepperStep, TStepAction } from "../domains/stepper.js";
import { type TStepValue, type TOrigin, Origin } from "../../domains/protocol.js";
import { DOMAIN_DURATION, DOMAIN_JSON, DOMAIN_STATEMENT, DOMAIN_STRING, DURATION_TERM } from "../../domains/domains.js";
import { itemAt } from "../../domains/item-at.js";
import { phraseParts, placeholderOf } from "../domains/phrase.js";

const TYPE_QUOTED = "q_";
const TYPE_ENV = "e_";
const TYPE_VAR = "b_";
const TYPE_ENV_OR_VAR_OR_LITERAL = "t_";
/** The characters that wrap a placeholder to state its origin: an environment variable, a variable or a quoted literal. */
const ORIGIN_DELIMITERS = ["$", "`", "<", '"'];
/** The most placeholders one phrase holds. A phrase with more is refused. */
const MOST_PLACEHOLDERS = 400;

/** A phrase as a pattern: the pattern's text, and each placeholder by name with its domain and its origin. A phrase without
 *  a placeholder doesn't hold a map. */
type TInterpolation = { regexPattern: string; stepValuesMap?: Record<string, TStepValue> };
/** A compiled phrase: its interpolation and its anchored, case-insensitive expression. */
type TCompiled = TInterpolation & { anchored: RegExp };

/** Each phrase compiled, by its text. A phrase is a step's declaration, so the set of phrases is bounded by the steps. */
const compiled = new Map<string, TCompiled>();

const inferOrigin = (char: string): TOrigin => {
	switch (char) {
		case "$":
			return Origin.env;
		case "`":
			return Origin.var;
		case '"':
			return Origin.quoted;
		default:
			return Origin.defined;
	}
};

/** The capture group of one placeholder, by the origin its delimiter states. */
function groupOf(origin: TOrigin, matchIndex: number, nextChar: string, domain: string): string {
	if (origin === Origin.env) return `\\$(?<${TYPE_ENV}${matchIndex}>[A-Za-z_][A-Za-z0-9_]*)\\$`;
	if (origin === Origin.var) return `\`(?<${TYPE_VAR}${matchIndex}>.+)\``;
	if (origin === Origin.quoted) return `"(?<${TYPE_QUOTED}${matchIndex}>.*)"`;
	// A bare literal may contain whitespace, and a quoted span inside it is atomic: `"foo with bar"` doesn't contribute its
	// internal ` ` or `"` as a split point. A placeholder before a comma or a colon ends at that character.
	const ends = nextChar === "," || nextChar === ":";
	// A JSON object or list before a comma ends at a closing brace or bracket the comma follows, so the commas between its keys
	// or items don't end it.
	const closes = domain === DOMAIN_JSON && nextChar === ",";
	const bare = closes ? `(?:[^"]|"[^"]*")*?[}\\]](?=,)` : ends ? `(?:[^"]|"[^"]*")+?(?=${nextChar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})` : `(?:[^"]|"[^"]*")+?`;
	// A quoted term before a comma or a colon ends at the first quote that the character follows, so a statement after the
	// comma that quotes terms of its own, as a combinator's does, isn't read into the term.
	const quoted = ends ? ".*?" : ".*";
	// A plain placeholder accepts several syntaxes, each captured into a distinct named group, so a match states whether the
	// value was quoted, backticked or a bare literal.
	return `(?:"(?<${TYPE_QUOTED}${matchIndex}>${quoted})"|\`(?<${TYPE_VAR}${matchIndex}>.+)\`|(?<${TYPE_ENV_OR_VAR_OR_LITERAL}${matchIndex}>${bare}))`;
}

/** Interpolates a phrase into its pattern. Throws for a placeholder without its closing brace. */
function interpolate(inp: string): TInterpolation {
	if (!inp.includes("{")) return { regexPattern: inp };
	const stepValuesMap: Record<string, TStepValue> = {};
	let last = 0;
	let regexPattern = "";
	let bs = inp.indexOf("{");
	let matchIndex = 0;
	while (bs > -1) {
		if (matchIndex >= MOST_PLACEHOLDERS) throw new Error(`the phrase ${inp} holds more than ${MOST_PLACEHOLDERS} placeholders; split it into steps that each take fewer`);
		regexPattern += inp.substring(last, bs);
		const be = inp.indexOf("}", bs);
		if (be < 0) throw new Error(`the phrase ${inp} opens a placeholder at ${bs} without its closing brace; close it with }`);
		const { name, domain } = placeholderOf(inp.substring(bs + 1, be));
		const precedingChar = inp.substring(bs - 1, bs);
		const origin = inferOrigin(precedingChar);
		const delimited = precedingChar !== "" && ORIGIN_DELIMITERS.includes(precedingChar);
		// A delimiter before the placeholder is part of its group, so the text already appended drops it, and the closing
		// delimiter after the brace is skipped.
		if (delimited) regexPattern = regexPattern.slice(0, -1);
		stepValuesMap[name] = { term: name, domain, origin };
		regexPattern += groupOf(origin, matchIndex, inp.substring(be + 1, be + 2), domain);
		matchIndex++;
		bs = inp.indexOf("{", be);
		last = delimited ? be + 2 : be + 1;
	}
	regexPattern += inp.substring(last);
	return { stepValuesMap, regexPattern };
}

/** The compiled form of a phrase, compiled on its first read. */
function compiledOf(gwta: string): TCompiled {
	const held = compiled.get(gwta);
	if (held !== undefined) return held;
	const interpolation = interpolate(gwta);
	// The pattern is anchored, so the whole line matches, and case-insensitive, as dePolite reads a line.
	const made = { ...interpolation, anchored: new RegExp(`^${interpolation.regexPattern}$`, "i") };
	compiled.set(gwta, made);
	return made;
}

/** Each placeholder's value, copied, so a match that gives a placeholder its term doesn't change the compiled phrase. */
const copiedValues = (values: Record<string, TStepValue>): Record<string, TStepValue> => Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { ...value }]));

/** A phrase as a pattern, with a copy of its placeholders that a caller may change. */
export const namedInterpolation = (inp: string): TInterpolation => {
	const { regexPattern, stepValuesMap } = compiledOf(inp);
	return stepValuesMap === undefined ? { regexPattern } : { regexPattern, stepValuesMap: copiedValues(stepValuesMap) };
};

/** The step action a line resolves to under a phrase, or undefined where the line doesn't match it. */
export const matchGwtaToAction = (gwta: string, actionable: string, actionName: string, stepperName: string, step: TStepperStep) => {
	const { anchored, stepValuesMap } = compiledOf(gwta);
	return getMatch(actionable, anchored, actionName, stepperName, step, stepValuesMap === undefined ? undefined : copiedValues(stepValuesMap));
};

export function getNamedMatches(regexp: RegExp, what: string) {
	const named = regexp.exec(what);
	return named?.groups;
}

/** A bare term's origin and term: an environment variable written `$NAME$`, a literal written as JSON, a number or a
 *  duration, or a defined name. */
function bareTerm(ph: TStepValue, t: string): void {
	const envMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)\$$/.exec(t);
	if (envMatch) {
		ph.term = itemAt(envMatch, 1);
		ph.origin = Origin.env;
		return;
	}
	const tTrim = t.trim();
	if (tTrim.startsWith("{") || tTrim.startsWith("[") || /^-?\d+(\.\d+)?$/.test(tTrim) || (ph.domain === DOMAIN_DURATION && DURATION_TERM.test(tTrim))) {
		ph.term = tTrim;
		ph.origin = Origin.quoted;
	} else ph.origin = Origin.defined;
}

/** The step action a line resolves to under an expression, with each placeholder given the term and the origin its capture
 *  states, or undefined where the line doesn't match. */
export const getMatch = (
	actionable: string,
	r: RegExp,
	actionName: string,
	stepperName: string,
	step: TStepperStep,
	stepValuesMap?: Record<string, TStepValue>,
): TStepAction | undefined => {
	const matched = r.exec(actionable);
	if (matched === null) return undefined;
	const { groups } = matched;
	if (groups !== undefined && stepValuesMap !== undefined) {
		for (const [i, ph] of Object.values(stepValuesMap).entries()) {
			// A quoted capture is read first, then a backticked one, then an environment variable, then a bare literal. A quoted
			// term states a quote within it as \".
			const q = groups[`${TYPE_QUOTED}${i}`];
			const b = groups[`${TYPE_VAR}${i}`];
			const e = groups[`${TYPE_ENV}${i}`];
			const t = groups[`${TYPE_ENV_OR_VAR_OR_LITERAL}${i}`];
			if (q !== undefined) Object.assign(ph, { term: q.replace(/\\"/g, '"'), origin: Origin.quoted });
			else if (b !== undefined) Object.assign(ph, { term: b, origin: Origin.var });
			else if (e !== undefined) Object.assign(ph, { term: e, origin: Origin.env });
			else if (t !== undefined) {
				ph.term = t;
				bareTerm(ph, t);
			}
		}
	}
	return { actionName, stepperName, step, stepValuesMap: stepValuesMap === undefined ? {} : stepValuesMap };
};

/** A step's line with each placeholder given its term, as a feature line states it: the step's optional wording is left
 *  out, and a character its pattern escapes is stated as itself. The one renderer of a step's line, for a feature written
 *  in code and for a call a transport carries. */
export function renderStepLine(gwta: string, terms: Record<string, string>): string {
	let line = gwta.replace(/\([^)]*\)\?/g, "").replace(/\\(.)/g, "$1");
	for (const [name, term] of Object.entries(terms)) line = line.replace(new RegExp(`\\{${name}(?::[^}]+)?\\}`, "g"), () => term);
	return line;
}

/** A value as a line states it literally for a parameter of `domain`: a statement as its line, a number or a boolean as
 *  written, a composite as JSON, and text quoted, with its line breaks escaped as a feature line states them. */
export function literalTerm(value: unknown, domain: string | undefined): string {
	if (domain === DOMAIN_STATEMENT || typeof value === "number" || typeof value === "boolean") return String(value);
	if (typeof value === "object" && value !== null) return JSON.stringify(value);
	return `"${String(value).replace(/\n/g, "\\n").replace(/"/g, '\\"')}"`;
}

/** The line a call renders as: its step's pattern with each value the call states written as a line states it literally for its
 *  part's domain. A part the call doesn't state stays as the pattern names it, so the line doesn't resolve, and dispatch refuses
 *  the call after its gate. */
export const lineOfCall = (pattern: string, input: Readonly<Record<string, unknown>>): string =>
	renderStepLine(pattern, Object.fromEntries(phraseParts(pattern).flatMap(({ name, domain }) => (input[name] === undefined ? [] : [[name, literalTerm(input[name], domain)]]))));

/** Each parameter of a call from a transport as a step value: its term the value the call states, and its value the one
 *  `values` holds. A validated call's values are validated and coerced by validateToolInput, so each value is carried
 *  through and populateActionArgs doesn't resolve it again. A key the phrase names keeps its declared domain, and any other
 *  key is added as a quoted string. */
export function mapInputToStepValues(stated: Readonly<Record<string, unknown>>, values: Readonly<Record<string, unknown>>, gwta: string): Record<string, TStepValue> {
	const { stepValuesMap } = namedInterpolation(gwta);
	const updatedMap: Record<string, TStepValue> = stepValuesMap === undefined ? {} : stepValuesMap;
	for (const [key, val] of Object.entries(values)) {
		const written = stated[key];
		const term = typeof written === "object" && written !== null ? JSON.stringify(written) : String(written);
		const existing = updatedMap[key];
		updatedMap[key] = existing ? { ...existing, term, value: val, origin: Origin.quoted } : { term, value: val, origin: Origin.quoted, domain: DOMAIN_STRING };
	}
	return updatedMap;
}
