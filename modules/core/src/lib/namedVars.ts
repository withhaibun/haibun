import { cred } from '../steps/credentials.js';
import { TStepperStep, TNamedVar, TStepAction, TNamed, TWorld, TFeatureStep, HAIBUN } from './defs.js';
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

export const namedInterpolation = (inp: string, types: string[] = BASE_TYPES): { str: string; stepVariables?: TNamedVar[] } => {
	if (!inp.includes('{')) {
		return { str: inp };
	}
	const stepVariables: TNamedVar[] = [];
	let last = 0;
	let str = '';
	let bs = inp.indexOf('{');
	let be = 401;
	let bail = 0;
	let matches = 0;
	while (bs > -1 && bail++ < 400) {
		str += inp.substring(last, bs);
		be = inp.indexOf('}', bs);

		if (be < 0) {
			throw Error(`missing end bracket in ${inp}`);
		}
		stepVariables.push(pairToVar(inp.substring(bs + 1, be), types));
		bs = inp.indexOf('{', be);
		last = be + 1;
		str += matchGroups(matches++);
	}
	str += inp.substring(be + 1);
	return { stepVariables, str };
};

function pairToVar(pair: string, types: string[]): TNamedVar {
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
	stepVariables?: TNamedVar[]
) => {
	if (!r.test(actionable)) {
		return;
	}
	const named = getNamedMatches(r, actionable);
	return { actionName, stepperName, step, named, stepVariables };
};

// returns named values, assigning variable values as appropriate
// retrieves from world.shared if a base domain, otherwise world.domains[type].shared
export function getNamedToVars(found: TStepAction, world: TWorld, featureStep: TFeatureStep) {
	const { named, stepVariables } = found;
	if (!named) {
		return { _nb: 'no named' };
	}
	if (!stepVariables || stepVariables.length < 1) {
		return named;
	}
	const namedFromVars: TNamed = {};
	stepVariables.forEach((v, i) => {
		const { name, type } = v;

		const { shared } = world;

		const namedKey = Object.keys(named).find((c) => c.endsWith(`_${i}`) && named[c] !== undefined);

		if (!namedKey) {
			throw Error(`no namedKey from ${named} for ${i}`);
		}
		const namedValue = named[namedKey];

		if (namedKey.startsWith(TYPE_ENV_OR_VAR_OR_LITERAL)) {
			// For TYPE_ENV_OR_VAR_OR_LITERAL, check env first if exists
			if (world.options.envVariables && world.options.envVariables[namedValue] !== undefined) {
				namedFromVars[name] = world.options.envVariables[namedValue];
			} else {
				namedFromVars[name] = shared?.get(namedValue) || (named && named[namedKey]);
			}
		} else if (namedKey.startsWith(TYPE_VAR)) {
			// must be from source
			if (!shared.get(namedValue)) {
				throw Error(
					`no value for "${namedValue}" from ${JSON.stringify({ keys: Object.keys(shared.all()), type })} in ${featureStep.path
					}`
				);
			}
			namedFromVars[name] = shared.get(namedValue);
		} else if (namedKey.startsWith(TYPE_SPECIAL)) {
			let toSet: string;
			if (namedValue === 'SERIALTIME') {
				toSet = '' + getSerialTime();
			} else {
				throw Error(`unknown special "${namedValue}" in ${JSON.stringify(found)}`);
			}
			namedFromVars[name] = toSet;
		} else if (namedKey.startsWith(TYPE_CREDENTIAL)) {
			// must be from source
			if (!shared.get(cred(namedValue))) {
				throw Error(`no value for credential "${namedValue}" from ${JSON.stringify({ keys: Object.keys(shared), type })}`);
			}
			namedFromVars[name] = shared.get(cred(namedValue));
		} else if (namedKey.startsWith(TYPE_ENV)) {
			// FIXME add test
			const val = world.options?.envVariables[namedValue];

			if (val === undefined) {
				throw Error(
					`no env value for "${namedValue}" from ${JSON.stringify(
						world.options?.envVariables
					)}.\nenv values are passed via ${HAIBUN}_ENV and ${HAIBUN}_ENVC.`
				);
			}
			namedFromVars[name] = val;
		} else if (namedKey.startsWith(TYPE_QUOTED)) {
			// quoted
			namedFromVars[name] = named[namedKey];
		} else {
			throw Error(`unknown assignment ${namedKey}`);
		}
	});
	return namedFromVars;
}
