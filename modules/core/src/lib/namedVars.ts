import { TStepperStep, TStepAction } from "./astepper.js";
import { TStepValue, TOrigin, Origin } from "../schema/protocol.js";
import { DOMAIN_DURATION, DOMAIN_STATEMENT, DOMAIN_STRING, DURATION_TERM } from "./domains.js";
import { itemAt } from "./util/item-at.js";

const TYPE_QUOTED = "q_";
const TYPE_ENV = "e_";
const TYPE_VAR = "b_";
const TYPE_ENV_OR_VAR_OR_LITERAL = "t_";

export const namedInterpolation = (inp: string): { regexPattern: string; stepValuesMap?: Record<string, TStepValue> } => {
	if (!inp.includes("{")) {
		return { regexPattern: inp };
	}
	const stepValuesMap: Record<string, TStepValue> = {};
	let last = 0;
	let regexPattern = "";
	let bs = inp.indexOf("{");
	let be = -1;
	let bail = 0;
	let matchIndex = 0;

	while (bs > -1 && bail++ < 400) {
		regexPattern += inp.substring(last, bs);
		be = inp.indexOf("}", bs);
		if (be < 0) {
			throw Error(`missing end bracket in ${inp}`);
		}
		const rawPair = inp.substring(bs + 1, be);
		const { name, domain } = pairToVar(rawPair);

		const precedingChar = inp.substring(bs - 1, bs);
		const origin = inferOrigin(precedingChar);

		// Strip any already-appended preceding delimiter from the
		// regexPattern so the group pattern can insert the correct single
		// delimiter.
		if (precedingChar && ["$", "`", "<", '"'].includes(precedingChar)) {
			// drop the already-appended preceding delimiter
			regexPattern = regexPattern.slice(0, -1);
		}

		stepValuesMap[name] = { term: name, domain, origin };

		const nextCharAfterBrace = inp.substring(be + 1, be + 2);

		// Bare literals may contain whitespace but a quoted span inside is atomic:
		// `"foo with bar"` does not contribute its internal ` ` or `"` as a split point.
		let placeholderRegex = `(?:[^"]|"[^"]*")+?`;

		if (nextCharAfterBrace === "," || nextCharAfterBrace === ":") {
			placeholderRegex = `(?:[^"]|"[^"]*")+?(?=${nextCharAfterBrace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`;
		}

		let matchGroupPattern;
		if (origin === Origin.env) {
			matchGroupPattern = `\\$(?<${TYPE_ENV}${matchIndex}>[A-Za-z_][A-Za-z0-9_]*)\\$`;
		} else if (origin === Origin.var) {
			matchGroupPattern = `\`(?<${TYPE_VAR}${matchIndex}>.+)\``;
		} else if (origin === Origin.quoted) {
			matchGroupPattern = `"(?<${TYPE_QUOTED}${matchIndex}>.*)"`;
		} else {
			// A plain placeholder accepts several syntaxes, capturing each into a
			// distinct named group so callers can detect whether the value was
			// quoted, backticked or a bare literal.
			matchGroupPattern = `(?:"(?<${TYPE_QUOTED}${matchIndex}>.*)"|\`(?<${TYPE_VAR}${matchIndex}>.+)\`|(?<${TYPE_ENV_OR_VAR_OR_LITERAL}${matchIndex}>${placeholderRegex}))`;
		}

		regexPattern += matchGroupPattern;
		matchIndex++;
		bs = inp.indexOf("{", be);
		// If the placeholder was wrapped with a delimiter on the left, the
		// corresponding closing delimiter appears immediately after the '}' and
		// must be skipped from the trailing substring to avoid duplicating it
		// in the final regex. Otherwise include the character after '}' as
		// normal.
		if (precedingChar && ["$", "`", "<", '"'].includes(precedingChar)) {
			last = be + 2;
		} else {
			last = be + 1;
		}
	}
	regexPattern += inp.substring(last);

	return { stepValuesMap, regexPattern };
};

export const matchGwtaToAction = (gwta: string, actionable: string, actionName: string, stepperName: string, step: TStepperStep) => {
	const { regexPattern, stepValuesMap } = namedInterpolation(gwta);
	// anchor the pattern so the whole actionable matches
	// use case-insensitive matching to be consistent with dePolite handling
	const r = new RegExp(`^${regexPattern}$`, "i");
	const match = getMatch(actionable, r, actionName, stepperName, step, stepValuesMap);
	return match;
};

// no-op

/** A placeholder's name and domain. A placeholder that doesn't name a domain takes a string. */
function pairToVar(pair: string): { name: string; domain: string } {
	const parts = pair.split(":").map((i) => i.trim());
	return { name: itemAt(parts, 0), domain: parts[1] || DOMAIN_STRING };
}

export function getNamedMatches(regexp: RegExp, what: string) {
	const named = regexp.exec(what);
	return named?.groups;
}

export const getMatch = (actionable: string, r: RegExp, actionName: string, stepperName: string, step: TStepperStep, stepValuesMap?: Record<string, TStepValue>) => {
	if (!r.test(actionable)) {
		return;
	}
	const groups = getNamedMatches(r, actionable);
	interface TInternalStepValue extends TStepValue {
		captureKey?: string;
	}

	if (groups && stepValuesMap) {
		const entries = Object.values(stepValuesMap) as TInternalStepValue[];
		let i = 0;
		for (const ph of entries) {
			// Prefer quoted, backtick, then bare literal captures.
			const q = groups[`${TYPE_QUOTED}${i}`];
			const b = groups[`${TYPE_VAR}${i}`];
			const e = groups[`${TYPE_ENV}${i}`];
			const t = groups[`${TYPE_ENV_OR_VAR_OR_LITERAL}${i}`];
			const chosen = q ?? b ?? e ?? t;
			if (chosen !== undefined) {
				ph.term = chosen;
				// set origin according to which capture matched
				if (q !== undefined) {
					ph.origin = Origin.quoted;
				} else if (b !== undefined) {
					ph.origin = Origin.var;
				} else if (e !== undefined) {
					ph.origin = Origin.env;
				} else if (t !== undefined) {
					// bare literal capture - detect env syntax $NAME$ or inline name:domain
					const envMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)\$$/.exec(t);
					if (envMatch) {
						ph.term = itemAt(envMatch, 1);
						ph.origin = Origin.env;
					} else {
						const tTrim = String(t).trim();
						if (tTrim.startsWith("{") || tTrim.startsWith("[") || /^-?\d+(\.\d+)?$/.test(tTrim) || (ph.domain === DOMAIN_DURATION && DURATION_TERM.test(tTrim))) {
							ph.term = tTrim;
							ph.origin = Origin.quoted;
						} else {
							ph.origin = Origin.defined;
						}
					}
				}
			}
			i++;
		}
	}
	return { actionName, stepperName, step, stepValuesMap: stepValuesMap || {} } as TStepAction;
};

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
	return `"${String(value).replace(/\n/g, "\\n")}"`;
}

export function mapInputToStepValues(input: Record<string, unknown>, gwta: string) {
	const { stepValuesMap } = namedInterpolation(gwta || "");
	const updatedMap = { ...stepValuesMap };
	for (const [key, val] of Object.entries(input)) {
		const term = typeof val === "object" && val !== null ? JSON.stringify(val) : String(val);
		const existing = updatedMap[key];
		// RPC inputs arrive already validated/coerced by validateToolInput; carry the value through directly so populateActionArgs can short-circuit resolveVariable. Keys present in gwta keep their declared domain; extras are added as quoted strings.
		updatedMap[key] = existing ? { ...existing, term, value: val, origin: Origin.quoted } : { term, value: val, origin: Origin.quoted, domain: DOMAIN_STRING };
	}
	return updatedMap;
}
