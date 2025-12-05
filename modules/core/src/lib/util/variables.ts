import { TWorld, Origin, TOrigin, TStepValue, TProvenanceIdentifier } from '../defs.js';
import { DOMAIN_STATEMENT, DOMAIN_STRING, normalizeDomainKey } from '../domain-types.js';

export function interpolate(text: string, localArgs: Record<string, string>, world: TWorld): string {
  // Priority 1: Local Args {key}
  const result = text.replace(/\{([^}]+)\}/g, (match, key) => {
    if (localArgs && Object.prototype.hasOwnProperty.call(localArgs, key)) {
      return localArgs[key];
    }
    const resolved = resolveVariable({ term: key, origin: Origin.fallthrough }, world);
    if (resolved.origin !== Origin.fallthrough && resolved.value !== undefined) {
      return String(resolved.value);
    }
    return match;
  });

  return result;
}

export function resolveVariable(actionVal: Partial<TStepValue> & { term: string, origin: TOrigin }, world: TWorld) {
    const { term, origin } = actionVal;
    const storedEntry = world.shared.all()[term];

    if (origin === Origin.statement) {
        actionVal.value = term;
        actionVal.domain = DOMAIN_STATEMENT;
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
        if (world.options.envVariables[term] !== undefined) {
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
