import { cred } from '../steps/credentials.js';
import { TStepperStep, TStepAction, TWorld, TFeatureStep, HAIBUN, TStepValue, TStepArgs } from './defs.js';
import { AStepper } from './astepper.js';
import { findFeatureStepsFromStatement } from './util/resolveAndExecuteStatement.js';
import { BASE_TYPES } from './domain-types.js';
import { getSerialTime } from './util/index.js';

const TYPE_QUOTED = 'q_';
const TYPE_CREDENTIAL = 'c_';
const TYPE_SPECIAL = 's_';
const TYPE_ENV = 'e_';
const TYPE_VAR = 'b_';
// from source or literal
const TYPE_ENV_OR_VAR_OR_LITERAL = 't_';

export const matchGroups = (num = 0) => {
	const b = `\`(?<${TYPE_VAR}${num}>.+)\``; // var
	const e = `{(?<${TYPE_ENV}${num}>.+)}`; // env var
	// FIXME this is being assigned as t_
	const s = `\\[(?<${TYPE_SPECIAL}${num}>.+)\\]`; // special
	const c = `<(?<${TYPE_CREDENTIAL}${num}>.+)>`; // credential
	const q = `"(?<${TYPE_QUOTED}${num}>.+)"`; // quoted string
	const t = `(?<${TYPE_ENV_OR_VAR_OR_LITERAL}${num}>.+)`; // var or enve or literal
	return `(${b}|${e}|${s}|${c}|${q}|${t})`;
};

export const namedInterpolation = (inp: string, types: string[] = BASE_TYPES): { str: string; stepValuesMap?: Record<string, TStepValue> } => {
	if (!inp.includes('{')) {
		return { str: inp };
	}
	const stepValuesMap: Record<string, TStepValue> = {};
	let last = 0;
	let str = '';
	let bs = inp.indexOf('{');
	let be = 401;
	let bail = 0;
	let matchIndex = 0;
	while (bs > -1 && bail++ < 400) {
		str += inp.substring(last, bs);
		be = inp.indexOf('}', bs);
		if (be < 0) {
			throw Error(`missing end bracket in ${inp}`);
		}
		const rawPair = inp.substring(bs + 1, be);
		const { name, type } = pairToVar(rawPair, types);
		stepValuesMap[name] = { label: name, type };
		// For 'statement' placeholders, only make them non-greedy if another placeholder follows later in the template.
		const anotherPlaceholderFollows = inp.indexOf('{', be + 1) !== -1;
		const greedy = (type === 'statement' && anotherPlaceholderFollows) ? '.+?' : '.+';
		const group = [
			'(',
			'`(?<', TYPE_VAR, matchIndex, '>.+)`', // var
			'|{(?<', TYPE_ENV, matchIndex, '>.+)}', // env
			'|\\[(?<', TYPE_SPECIAL, matchIndex, '>.+)\\]', // special
			'|<(?<', TYPE_CREDENTIAL, matchIndex, '>.+)>', // credential
			'|"(?<', TYPE_QUOTED, matchIndex, '>.+)"', // quoted
			'|(?<', TYPE_ENV_OR_VAR_OR_LITERAL, matchIndex, '>', greedy, ')', // var/env/literal or statement (with non-greedy for statement)
			')'
		].join('');
		str += group;
		matchIndex++;
		bs = inp.indexOf('{', be);
		last = be + 1;
	}
	str += inp.substring(be + 1);
	return { stepValuesMap, str };
};

function pairToVar(pair: string, types: string[]): { name: string; type: string } {
	// eslint-disable-next-line prefer-const
	let [name, type] = pair.split(':').map((i) => i.trim());
	if (!type) type = 'string';
	if (!types.includes(type)) {
		throw Error(`unknown type ${type}`);
	}

	return { name, type };
}

export function getNamedMatches(regexp: RegExp, what: string) {
	const named = regexp.exec(what);
	return named?.groups;
}

export const getMatch = (
	actionable: string,
	r: RegExp,
	actionName: string,
	stepperName: string,
	step: TStepperStep,
	stepValuesMap?: Record<string, TStepValue>
) => {
	if (!r.test(actionable)) {
		return;
	}
	const groups = getNamedMatches(r, actionable);
	// enrich stepValuesMap placeholders with original and early source classification (no rawKey persistence)
	interface TInternalStepValue extends TStepValue { captureKey?: string }
	if (groups && stepValuesMap) {
		let i = 0;
		for (const ph of Object.values(stepValuesMap) as TInternalStepValue[]) {
			const captureKey = Object.keys(groups).find(c => c.endsWith(`_${i}`) && groups[c] !== undefined);
			if (captureKey) {
				ph.original = groups[captureKey];
				if (ph.type === 'statement') {
					ph.source = 'statement';
				} else if (captureKey.startsWith(TYPE_ENV)) ph.source = 'env';
				else if (captureKey.startsWith(TYPE_VAR)) ph.source = 'var';
				else if (captureKey.startsWith(TYPE_CREDENTIAL)) ph.source = 'credential';
				else if (captureKey.startsWith(TYPE_SPECIAL)) ph.source = 'special';
				else if (captureKey.startsWith(TYPE_QUOTED)) ph.source = 'quoted';
				// t_ remains ambiguous: leave source undefined to resolve later (will become var/env/literal)
				// Note: literal will be assigned if nothing else matches during resolution
				ph.captureKey = captureKey;
			}
			i++;
		}
	}
	return { actionName, stepperName, step, stepValuesMap } as TStepAction;
};

// returns named values, assigning variable values as appropriate
// retrieves from world.shared if a base domain, otherwise world.domains[type].shared
export async function getStepArgs(found: TStepAction, world: TWorld, featureStep: TFeatureStep, steppers: AStepper[]): Promise<TStepArgs> {
	const { stepValuesMap } = found;
	if (!stepValuesMap || Object.keys(stepValuesMap).length === 0) {
		return {};
	}
	const args: TStepArgs = {};
	for (const placeholder of Object.values(stepValuesMap)) {
		if (placeholder.type === 'statement') {
			if (placeholder.original === undefined) {
				throw Error(`missing original for statement placeholder ${placeholder.label}`);
			}
			// immediately resolve nested statement into feature steps array
			const resolved = await findFeatureStepsFromStatement(placeholder.original, steppers, world, `<${featureStep.action.stepperName}.${featureStep.action.actionName}.${placeholder.label}>`);
			args[placeholder.label] = resolved;
			placeholder.value = args[placeholder.label];
			placeholder.source = 'statement';
			continue;
		}
		const captureKey = (placeholder as { captureKey?: string }).captureKey;
		const rawVal = placeholder.original;
		if (!captureKey || rawVal === undefined) {
			throw Error(`missing capture data for ${placeholder.label}`);
		}
		const { shared } = world;
		let resolved: string | number;
		if (captureKey.startsWith(TYPE_ENV_OR_VAR_OR_LITERAL)) {
			if (world.options.envVariables && world.options.envVariables[rawVal] !== undefined) {
				resolved = world.options.envVariables[rawVal];
			} else {
				resolved = shared?.get(rawVal) || rawVal;
			}
		} else if (captureKey.startsWith(TYPE_VAR)) {
			if (!shared.get(rawVal)) {
				throw Error(`no value for "${rawVal}" from ${JSON.stringify({ keys: Object.keys(shared.all()), type: placeholder.type })} in ${featureStep.path}`);
			}
			resolved = shared.get(rawVal);
		} else if (captureKey.startsWith(TYPE_SPECIAL)) {
			if (rawVal === 'SERIALTIME') {
				resolved = '' + getSerialTime();
			} else {
				throw Error(`unknown special "${rawVal}" in ${JSON.stringify(found)}`);
			}
		} else if (captureKey.startsWith(TYPE_CREDENTIAL)) {
			if (!shared.get(cred(rawVal))) {
				throw Error(`no value for credential "${rawVal}"`);
			}
			resolved = shared.get(cred(rawVal));
		} else if (captureKey.startsWith(TYPE_ENV)) {
			const val = world.options?.envVariables[rawVal];
			if (val === undefined) {
				throw Error(`no env value for "${rawVal}" from ${JSON.stringify(world.options?.envVariables)}.\nenv values are passed via ${HAIBUN}_ENV and ${HAIBUN}_ENVC.`);
			}
			resolved = val;
		} else if (captureKey.startsWith(TYPE_QUOTED)) {
			resolved = rawVal;
		} else {
			throw Error(`unknown assignment ${captureKey}`);
		}
		// coerce numeric type placeholders
		if (placeholder.type === 'number') {
			const asNum = Number(resolved);
			if (Number.isNaN(asNum)) {
				throw Error(`invalid number for ${placeholder.label}: ${resolved}`);
			}
			resolved = asNum;
		}
		args[placeholder.label] = resolved as (string | number);
		placeholder.value = resolved as (string | number);
		if (!placeholder.source) {
			placeholder.source = inferSource(captureKey);
		}
	}
	return args;
}

function inferSource(namedKey: string): TStepValue['source'] {
	if (namedKey.startsWith(TYPE_ENV)) return 'env';
	if (namedKey.startsWith(TYPE_VAR)) return 'var';
	if (namedKey.startsWith(TYPE_CREDENTIAL)) return 'credential';
	if (namedKey.startsWith(TYPE_SPECIAL)) return 'special';
	if (namedKey.startsWith(TYPE_QUOTED)) return 'quoted';
	// fallback literal (includes TYPE_ENV_OR_VAR_OR_LITERAL resolved to literal)
	return 'literal';
}
