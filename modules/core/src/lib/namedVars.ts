import { TStepperStep, TStepAction, TStepValue, TOrigin, Origin } from './defs.js';
import { DOMAIN_STRING } from './domain-types.js';

export const TYPE_QUOTED = 'q_';
export const TYPE_ENV = 'e_';
export const TYPE_VAR = 'b_';
export const TYPE_ENV_OR_VAR_OR_LITERAL = 't_';

export const namedInterpolation = (inp: string): { regexPattern: string; stepValuesMap?: Record<string, TStepValue> } => {
	if (!inp.includes('{')) {
		return { regexPattern: inp };
	}
	const stepValuesMap: Record<string, TStepValue> = {};
	let last = 0;
	let regexPattern = '';
	let bs = inp.indexOf('{');
	let be = -1;
	let bail = 0;
	let matchIndex = 0;

	const placeholderRegex = '.+';

	while (bs > -1 && bail++ < 400) {
		regexPattern += inp.substring(last, bs);
		be = inp.indexOf('}', bs);
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
		if (precedingChar && ['$', '`', '<', '"'].includes(precedingChar)) {
			// remove the last character we just added (the delimiter)
			regexPattern = regexPattern.slice(0, -1);
		}

		stepValuesMap[name] = { term: name, domain, origin };

		let matchGroupPattern;
		if (origin === Origin.env) {
			matchGroupPattern = `\\$(?<${TYPE_ENV}${matchIndex}>[A-Za-z_][A-Za-z0-9_]*)\\$`;
		} else if (origin === Origin.var) {
			matchGroupPattern = `\`(?<${TYPE_VAR}${matchIndex}>.+)\``;
		} else if (origin === Origin.quoted) {
			matchGroupPattern = `"(?<${TYPE_QUOTED}${matchIndex}>.+)"`;
		} else {
			// For a plain placeholder we accept several syntaxes and capture each
			// into a distinct named group so callers can detect whether the
			// value was quoted, backticked or a bare literal.
			matchGroupPattern = `(?:"(?<${TYPE_QUOTED}${matchIndex}>.+)"|\`(?<${TYPE_VAR}${matchIndex}>.+)\`|(?<${TYPE_ENV_OR_VAR_OR_LITERAL}${matchIndex}>${placeholderRegex}))`;
		}

		regexPattern += matchGroupPattern;
		matchIndex++;
		bs = inp.indexOf('{', be);
		// If the placeholder was wrapped with a delimiter on the left, the
		// corresponding closing delimiter appears immediately after the '}' and
		// must be skipped from the trailing substring to avoid duplicating it
		// in the final regex. Otherwise include the character after '}' as
		// normal.
		if (precedingChar && ['$', '`', '<', '"'].includes(precedingChar)) {
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
	const r = new RegExp(`^${regexPattern}$`, 'i');
	return getMatch(actionable, r, actionName, stepperName, step, stepValuesMap);
};

// no-op

function pairToVar(pair: string): { name: string; domain: string } {
	const [name, domainRaw] = pair.split(':').map((i) => i.trim());
	const domain = domainRaw || DOMAIN_STRING;
	return { name, domain };
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
	interface TInternalStepValue extends TStepValue { captureKey?: string }

	if (groups && stepValuesMap) {
		const entries = Object.values(stepValuesMap) as TInternalStepValue[];
		let i = 0;
		for (const ph of entries) {
			// Prefer quoted, backtick, then bare literal captures.
			const q = groups[`${TYPE_QUOTED}${i}`];
			const b = groups[`${TYPE_VAR}${i}`];
			const e = groups[`${TYPE_ENV}${i}`];
			const t = groups[`${TYPE_ENV_OR_VAR_OR_LITERAL}${i}`];
			const chosen = q ?? b ?? t;
			// prefer the dedicated env group if present
			const actuallyChosen = q ?? b ?? e ?? t;
			if (actuallyChosen !== undefined) {
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
						ph.term = envMatch[1];
						ph.origin = Origin.env;
					} else {
						ph.origin = Origin.fallthrough;
						// If the bare literal looks like JSON, treat it as fallthrough.
						const tTrim = String(t).trim();
						if (tTrim.startsWith('{') || tTrim.startsWith('[')) {
							ph.term = tTrim;
						}
					}
				}
				// domain 'statement' should force origin to 'statement'
				if (ph.domain === 'statement') ph.origin = Origin.statement;
			}
			i++;
		}
	}
	return { actionName, stepperName, step, stepValuesMap } as TStepAction;
};

const inferOrigin = (char: string): TOrigin => {
	switch (char) {
		case '$':
			return Origin.env;
		case '`':
			return Origin.var;
		case '"':
			return Origin.quoted;
		default:
			return Origin.fallthrough;
	}
};
