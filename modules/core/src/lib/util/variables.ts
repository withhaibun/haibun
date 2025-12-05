import { TWorld, Origin, TOrigin } from '../defs.js';
import { DOMAIN_STRING } from '../domain-types.js';

export function interpolate(text: string, localArgs: Record<string, string>, world: TWorld): string {
  // Priority 1: Local Args {key}
  let result = text.replace(/\{([^}]+)\}/g, (match, key) => {
    if (localArgs && Object.prototype.hasOwnProperty.call(localArgs, key)) {
      return localArgs[key];
    }
    const val = world.shared.get(key);
    if (val !== undefined) {
      return String(val);
    }
    return match;
  });

  // Priority 2: Global Vars ${key}
  result = result.replace(/\$\{([^}]+)\}/g, (match, key) => {
    const val = world.shared.get(key);
    if (val !== undefined) {
      return String(val);
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
            actionVal.value = storedEntry.value;
            actionVal.provenance = storedEntry.provenance;
        }
    } else if (origin === Origin.fallthrough) {
        if (world.options.envVariables[term]) {
            actionVal.value = world.options.envVariables[term];
        } else if (storedEntry) {
            actionVal.value = storedEntry.value;
            actionVal.domain = storedEntry.domain;
            actionVal.provenance = storedEntry.provenance;
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
