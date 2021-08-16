import { TStep, TNamedVar, TFound, TNamed, TShared, BASE_TYPES, TModuleDomain } from './defs';

const TYPE_QUOTED = 'q_';
const TYPE_CREDENTIAL = 'c_';
const TYPE_VAR = 'b_';
// from source or literal
const TYPE_VARL = 't_';

export const matchGroups = (num: number = 0) => {
  const q = `"(?<${TYPE_QUOTED}${num}>.+)"`; // quoted string
  const c = `<(?<${TYPE_CREDENTIAL}${num}>.+)>`; // credential
  const b = `\`(?<${TYPE_VAR}${num}>.+)\``; // var
  const t = `(?<${TYPE_VARL}${num}>.+)`; // var or literal
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
export function getNamedToVars({ named, vars }: TFound, { shared, domains }: { shared: TShared; domains: TModuleDomain[] }) {
  if (!named) {
    return { _nb: 'no named' };
  }
  if (!vars || vars.length < 1) {
    return named;
  }
  let namedFromVars: TNamed = {};
  vars.forEach((v, i) => {
    const { name, type } = v;
    const source = shared; // BASE_TYPES.includes(type) ? shared : domains.find((d) => d.name === type)!.shared!;
    const found = Object.keys(named).find((c) => c.endsWith(`_${i}`) && named[c] !== undefined);
    if (found) {
      const namedValue = named[found];
      if (found.startsWith(TYPE_VARL)) {
        namedFromVars[name] = source[namedValue] || named[found];
      } else if (found.startsWith(TYPE_VAR) || found.startsWith('c_')) {
        // must be from source
        if (!source[namedValue]) {
          throw Error(`no value for ${name}`);
        }
        namedFromVars[name] = source[namedValue];
      } else if (found.startsWith(TYPE_QUOTED)) {
        // quoted
        namedFromVars[name] = named[found];
      } else {
        throw Error(`unknown assignedment ${found}`);
      }
    }
  });
  return namedFromVars;
}
