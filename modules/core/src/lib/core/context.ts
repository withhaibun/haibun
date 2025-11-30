import { TWorld } from '../defs.js';

export function interpolate(text: string, localArgs: Record<string, string>, world: TWorld): string {
  // Priority 1: Local Args {key}
  let result = text.replace(/\{([^}]+)\}/g, (match, key) => {
    if (localArgs && Object.prototype.hasOwnProperty.call(localArgs, key)) {
      return localArgs[key];
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
