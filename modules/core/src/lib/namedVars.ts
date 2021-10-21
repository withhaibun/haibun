import { TStep, TNamedVar, TFound, TNamed, BASE_TYPES, TWorld } from './defs';
import { getStepShared } from './domain';

const TYPE_QUOTED = 'q_';
const TYPE_CREDENTIAL = 'c_';
const TYPE_VAR = 'b_';
// from source or literal
const TYPE_VAR_OR_LITERAL = 't_';

export const matchGroups = (num: number = 0) => {
  const q = `"(?<${TYPE_QUOTED}${num}>.+)"`; // quoted string
  const c = `<(?<${TYPE_CREDENTIAL}${num}>.+)>`; // credential
  const b = `\`(?<${TYPE_VAR}${num}>.+)\``; // var
  const t = `(?<${TYPE_VAR_OR_LITERAL}${num}>.+)`; // var or literal
  return `(${q}|${c}|${b}|${t})`;
};

export const namedInterpolation = (inp: string, types: string[] = BASE_TYPES): { str: string; vars?: TNamedVar[] } => {
  if (!inp.includes('{')) {
    return { str: inp };
  }
  const vars: TNamedVar[] = [];
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
    vars.push(pairToVar(inp.substring(bs + 1, be), types));
    bs = inp.indexOf('{', be);
    last = be + 1;
    str += matchGroups(matches++);
  }
  str += inp.substr(be + 1);
  return { vars, str };
};

function pairToVar(pair: string, types: string[]): TNamedVar {
  let [k, v] = pair.split(':').map((i) => i.trim());
  if (!v) v = 'string';
  if (!types.includes(v)) {
    throw Error(`unknown type ${v}`);
  }

  return { name: k, type: v };
}

export function getNamedMatches(regexp: RegExp, what: string) {
  const named = regexp.exec(what);
  return named?.groups;
}

export const getMatch = (actionable: string, r: RegExp, name: string, step: TStep, vars?: TNamedVar[]) => {
  if (!r.test(actionable)) {
    return;
  }
  const named = getNamedMatches(r, actionable);
  return { name, step, named, vars };
};

// returns named values, assigning variable values as appropriate
// retrieves from world.shared if a base domain, otherwise world.domains[type].shared
export function getNamedToVars({ named, vars }: TFound, world: TWorld) {
  if (!named) {
    return { _nb: 'no named' };
  }
  if (!vars || vars.length < 1) {
    return named;
  }
  let namedFromVars: TNamed = {};
  vars.forEach((v, i) => {
    const { name, type } = v;
    
    const shared = getStepShared(type, world);

    const namedKey = Object.keys(named).find((c) => c.endsWith(`_${i}`) && named[c] !== undefined);

    if (!namedKey) {
      throw Error(`no namedKey from ${named} for ${i}`);
    }
    const namedValue = named[namedKey];
    if (namedKey.startsWith(TYPE_VAR_OR_LITERAL)) {
      namedFromVars[name] = shared.get(namedValue) || named[namedKey];
    } else if (namedKey.startsWith(TYPE_VAR) || namedKey.startsWith(TYPE_CREDENTIAL)) {
      // must be from source
      if (!shared.get(namedValue)) {
        throw Error(`no value for "${namedValue}" from ${JSON.stringify({ shared, type })}`);
      }
      namedFromVars[name] = shared.get(namedValue);
    } else if (namedKey.startsWith(TYPE_QUOTED)) {
      // quoted
      namedFromVars[name] = named[namedKey];
    } else {
      throw Error(`unknown assignment ${namedKey}`);
    }
  });
  return namedFromVars;
}
