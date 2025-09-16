import { TStepperStep, TStepAction, TStepValue, TOrigin } from './defs.js';

export const TYPE_QUOTED = 'q_';
export const TYPE_CREDENTIAL = 'c_';
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

	// For most placeholders we prefer a greedy match so that, when there's
	// nothing after the placeholder, the full literal is captured (e.g. URLs).
	// For `statement` domains we allow multiline greedy captures.
	const placeholderRegex = '.+'; // greedy by default
	const placeholderRegexGreedy = '[\\s\\S]+'; // greedy, matches newlines as well

	while (bs > -1 && bail++ < 400) {
		// Append the literal text before the placeholder. If the placeholder has an
		// explicit marker immediately before it (like a quote, backtick, < or $)
		// we don't want to duplicate that marker when we also emit it inside the
		// generated capture pattern. Trim it from the appended literal in that case.
		let literalBefore = inp.substring(last, bs);
		be = inp.indexOf('}', bs);
		const precedingChar = inp.substring(bs - 1, bs);
		const origin = inferOrigin(precedingChar);
		if (origin !== 'literal' && literalBefore.endsWith(precedingChar)) {
			literalBefore = literalBefore.substring(0, literalBefore.length - 1);
		}
		regexPattern += literalBefore;
		if (be < 0) {
			throw Error(`missing end bracket in ${inp}`);
		}
		const rawPair = inp.substring(bs + 1, be);
		const { name, domain } = pairToVar(rawPair);

		// Default step value entry; origin may be refined after matching
		stepValuesMap[name] = { label: name, domain, origin };

		// Build match group pattern. If the template included an explicit marker (env/var/etc)
		// we only create that specific capture. Otherwise we create an alternation that
		// accepts quoted, credential, var (backticks), env ($...$) or a bare literal.
		let matchGroupPattern: string;
		if (origin === 'env') {
			matchGroupPattern = `\\$(?<${TYPE_ENV}${matchIndex}>[A-Za-z_][A-Za-z0-9_]*)\\$`;
		} else if (origin === 'var') {
			// match a backtick-delimited var: `value`
			matchGroupPattern = '\\`(?<' + TYPE_VAR + matchIndex + '>.+?)\\`';
		} else if (origin === 'credential') {
			matchGroupPattern = `<(?<${TYPE_CREDENTIAL}${matchIndex}>.+?)>`;
		} else if (origin === 'quoted') {
			// Use greedy quoted capture so inner double-quotes inside JSON or
			// other quoted values don't prematurely terminate the match.
			const quotedInner = '.+';
			matchGroupPattern = `"(?<${TYPE_QUOTED}${matchIndex}>${quotedInner})"`;
		} else {
			// no explicit marker in template: accept any of the common syntaxes and record
			// the matching subgroup. Order matters: try quoted, credential, var, env, then literal.
			// Use greedy quoted capture for json domain so JSON like {"a":1}
			// (which contains inner quotes) is captured until the final quote.
			const qInner = '.+';
			const q = `"(?<${TYPE_QUOTED}${matchIndex}>${qInner})"`;
			const c = `<(?<${TYPE_CREDENTIAL}${matchIndex}>.+?)>`;
			const b = '\\`(?<' + TYPE_VAR + matchIndex + '>.+?)\\`';
			const e = `\\$(?<${TYPE_ENV}${matchIndex}>[A-Za-z_][A-Za-z0-9_]*)\\$`;
			// If the declared domain for this placeholder is `statement` prefer a
			// greedy multiline capture so it can swallow line breaks and long text.
			const literalPattern = stepValuesMap[name]?.domain === 'statement' ? placeholderRegexGreedy : placeholderRegex;
			const t = `(?<${TYPE_ENV_OR_VAR_OR_LITERAL}${matchIndex}>${literalPattern})`;
			matchGroupPattern = `(?:${q}|${c}|${b}|${e}|${t})`;
		}

		regexPattern += matchGroupPattern;
		matchIndex++;
		// If the template used an explicit closing marker (e.g. the char after the
		// closing brace matches the preceding marker like "{value}"), we already
		// included that marker in the generated capture pattern. Consume that
		// trailing marker so it isn't appended again when we add the remaining
		// literal text after the placeholder.
		let closingConsumed = false;
		if (origin !== 'literal') {
			const nextChar = inp.substring(be + 1, be + 2);
			if (nextChar === precedingChar) {
				closingConsumed = true;
			}
		}
		last = be + 1 + (closingConsumed ? 1 : 0);
		bs = inp.indexOf('{', last);
	}
	regexPattern += inp.substring(last);
	return { stepValuesMap, regexPattern };
};

function pairToVar(pair: string): { name: string; domain: string } {
	const [name, domainRaw] = pair.split(':').map((i) => i.trim());
	const domain = domainRaw || 'string';
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
		let i = 0;
		const groupKeys = Object.keys(groups);
		for (const ph of Object.values(stepValuesMap) as TInternalStepValue[]) {
			const captureKey = groupKeys.find(c => c.endsWith(`_${i}`) && groups[c] !== undefined);
			if (captureKey) {
				ph.captureKey = captureKey;
				ph.label = groups[captureKey];
				// If this placeholder represents a nested statement, keep that origin.
				if (ph.domain === 'statement') {
					ph.origin = 'statement';
				} else {
					// Otherwise infer origin from the capture key prefix
				if (captureKey.startsWith(TYPE_QUOTED)) ph.origin = 'quoted';
				else if (captureKey.startsWith(TYPE_CREDENTIAL)) ph.origin = 'credential';
				else if (captureKey.startsWith(TYPE_VAR)) ph.origin = 'var';
				else if (captureKey.startsWith(TYPE_ENV)) ph.origin = 'env';
				else ph.origin = 'literal';
				}
			}
			i++;
		}
	}
	return { actionName, stepperName, step, stepValuesMap } as TStepAction;
};

const inferOrigin = (char: string): TOrigin => {
	switch (char) {
		case '$':
			return 'env';
		case '`':
			return 'var';
		case '<':
			return 'credential';
		case '"':
			return 'quoted';
		default:
			return 'literal';
	}
};
