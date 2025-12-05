import { TWorld, Origin, TOrigin } from '../defs.js';
import { DOMAIN_STRING, normalizeDomainKey } from '../domain-types.js';

export function interpolate(text: string, localArgs: Record<string, string>, world: TWorld): string {
  // Priority 1: Local Args {key}
  let result = text.replace(/\{([^}]+)\}/g, (match, key) => {
    if (localArgs && Object.prototype.hasOwnProperty.call(localArgs, key)) {
      return localArgs[key];
    }
    const env = resolveVariable({ term: key, origin: Origin.env }, world);
    if (env.value !== undefined) {
      return String(env.value);
    }
    const val = resolveVariable({ term: key, origin: Origin.var }, world);
    if (val.value !== undefined) {
      return String(val.value);
    }
    return match;
  });

  return result;
}

export function resolveVariable(actionVal: { term: string, origin: TOrigin, value?: any, domain?: string, provenance?: any }, world: TWorld) {
    const { term, origin } = actionVal;
    const storedEntry = world.shared.all()[term];

    if (origin === Origin.statement) {
        actionVal.value = term;
    } else if (origin === Origin.env) {
        actionVal.value = world.options.envVariables[term];
        actionVal.domain = DOMAIN_STRING;
    } else if (origin === Origin.var) {
        if (storedEntry) {
            actionVal.domain = storedEntry.domain;
            actionVal.value = world.shared.get(term);
            actionVal.provenance = storedEntry.provenance;
        }
    } else if (origin === Origin.fallthrough) {
        if (world.options.envVariables[term]) {
            actionVal.value = world.options.envVariables[term];
            actionVal.domain = DOMAIN_STRING;
            actionVal.origin = Origin.env;
        } else if (storedEntry) {
            actionVal.value = world.shared.get(term);
            actionVal.domain = storedEntry.domain;
            actionVal.provenance = storedEntry.provenance;
            actionVal.origin = Origin.var;
        } else {
            actionVal.value = term;
            actionVal.domain = DOMAIN_STRING;
        }
    } else if (origin === Origin.quoted) {
        actionVal.value = term;
        actionVal.domain = DOMAIN_STRING;
    } else {
        throw new Error(`Unsupported origin type: ${origin}`);
    }
    return actionVal;
}
