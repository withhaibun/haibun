import { TStep, TNamedVar, TFound, TNamed, TShared } from './defs';

export const matchGroups = (num: number = 0) => {
  const q = `"(?<q_${num}>.+)"`; // quoted string
  const c = `<(?<c_${num}>.+)>`; // credential
  const b = `\`(?<b_${num}>.+)\``; // var
  const t = `(?<t_${num}>.+)`; // var or literal
  return `(${q}|${c}|${b}|${t})`;
};

export const namedInterpolation = (inp: string): { str: string; vars?: TNamedVar[] } => {
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
    vars.push(pairToVar(inp.substring(bs + 1, be)));
    bs = inp.indexOf('{', be);
    last = be + 1;
    str += matchGroups(matches++);
  }
  str += inp.substr(be + 1);
  return { vars, str };
};

export function getNamedMatches(regexp: RegExp, what: string) {
  const named = regexp.exec(what);
  return named?.groups;
}

function pairToVar(pair: string): TNamedVar {
  let [k, v] = pair.split(':').map((i) => i.trim());
  if (!v) v = 'string';
  if (!['string'].includes(v)) {
    throw Error(`unknown type ${v}`);
  }

  return { name: k, type: v };
}

export const getMatch = (actionable: string, r: RegExp, name: string, step: TStep, vars?: TNamedVar[]) => {
  if (!r.test(actionable)) {
    return;
  }
  const named = getNamedMatches(r, actionable);
  return { name, step, named, vars };
};

// returns named values, assigning variable values as appropriate
export function getNamedWithVars({ named, vars }: TFound, shared: TShared) {
  if (named) {
    if (!vars || vars.length < 1) {
      return named;
    }
    let namedFromVars: TNamed = {};
    vars.forEach((v, i) => {
      const found = Object.keys(named).find((c) => c.endsWith(`_${i}`) && named[c] !== undefined);
      if (found) {
          const namedValue = named[found];
        if (found.startsWith('t_')) {
          // from shared or name
          namedFromVars[v.name] = shared[namedValue] || named[found];
        } else if (found.startsWith('b_') || found.startsWith('c_')) {
          // must be from shared
          if (!shared[namedValue]) {
            throw Error(`no value for ${v.name}`);
          }
          namedFromVars[v.name] = shared[namedValue];
        } else if (found.startsWith('q_')) {
          // quoted
          namedFromVars[v.name] = named[found];
        } else {
          throw Error(`unknown assignedment ${found}`);
        }
      }
    });
    return namedFromVars;
  }
}
