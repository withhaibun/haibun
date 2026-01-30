import { TStepValuesMap } from './defs.js';
import { TStepArgs } from '../schema/protocol.js';
import { HIDDEN_SECRET, isSecretByName } from './set-modifiers.js';

export { HIDDEN_SECRET };

export type TIsSecretFn = (name: string) => boolean;
export type TGetSecretValueFn = (name: string) => string | undefined;

/** Replace secret value with obscured placeholder */
export const obscureInText = (text: string, secretVal: string): string =>
  secretVal ? text.replace(new RegExp(`${secretVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), HIDDEN_SECRET) : text;

/**
 * Sanitizes step data by obscuring secret values.
 * Secrets are detected via:
 * 1. TStepValue.secret flag
 * 2. isSecretFn callback (for variable names)
 * 3. Variable name pattern (isSecretByName)
 * 4. Embedded variables in strings (e.g. "{mySecret}")
 */
export function sanitize(
  stepValuesMap: TStepValuesMap | undefined,
  stepArgs: TStepArgs,
  inText: string,
  isSecretStep?: boolean,
  isSecretFn?: TIsSecretFn,
  getSecretValueFn?: TGetSecretValueFn,
  knownSecrets: string[] = []
): { sanitizedMap?: TStepValuesMap; sanitizedArgs: TStepArgs; sanitizedIn: string; secretValues: string[] } {
  const secretValues: string[] = [];
  let sanitizedMap: TStepValuesMap | undefined;

  // If isSecretStep is not provided, check if the text mentions password-like variables
  const stepIsSecret = isSecretStep ?? isSecretByName(inText);

  if (stepValuesMap) {
    sanitizedMap = {};
    for (const [key, sv] of Object.entries(stepValuesMap)) {
      let isSecret = sv.secret || (stepIsSecret && key === 'value');

      // Check for standalone variable reference: {mySecret}
      if (!isSecret && isSecretFn && sv.term) {
        const term = sv.term.startsWith('{') && sv.term.endsWith('}') ? sv.term.slice(1, -1) : sv.term;
        if (isSecretFn(term)) {
          // It refers to a secret variable. Capture the value for redaction elsewhere.
          if (getSecretValueFn) {
            const val = getSecretValueFn(term);
            if (val) secretValues.push(val);
          }

          // Obscure the map entry if it appears to be holding the resolved value (not just the variable name)
          // Using a heuristic: if value is defined and differs from term (and isn't just the term quoted)
          if (sv.value !== undefined) {
            const valStr = String(sv.value);
            // If valStr is exactly the term, don't obscure (it's the name)
            // If valStr is term in quotes, don't obscure (rare but possible)
            if (valStr !== term && valStr !== `"${term}"`) {
              isSecret = true;
            }
          }
        }
      }

      // Check for embedded variables: "prefix {mySecret} suffix"
      if (isSecretFn && getSecretValueFn && sv.term) {
        const matches = sv.term.matchAll(/\{([a-zA-Z0-9_-]+)\}/g);
        for (const match of matches) {
          const varName = match[1];
          if (isSecretFn(varName)) {
            const val = getSecretValueFn(varName);
            if (val) secretValues.push(val);
          }
        }
      }

      if (isSecret) {
        // Resolve value from sv.value, stepArgs, or term
        let val = sv.value !== undefined ? String(sv.value) : (stepArgs[key] !== undefined ? String(stepArgs[key]) : sv.term);

        // If the value is quoted string, strip quotes to get raw secret content
        if (val.length > 1 && val.startsWith('"') && val.endsWith('"')) {
          val = val.slice(1, -1);
        }

        // Add to secretValues if found
        if (val) secretValues.push(val);

        sanitizedMap[key] = { ...sv, value: HIDDEN_SECRET, term: HIDDEN_SECRET };
      } else {
        sanitizedMap[key] = sv;
      }
    }
  }

  // Obscure stepArgs values that match collected secrets
  const allSecrets = [...new Set([...knownSecrets, ...secretValues])];
  const sanitizedArgs: TStepArgs = {};
  for (const [k, v] of Object.entries(stepArgs)) {
    sanitizedArgs[k] = (typeof v === 'string' && allSecrets.includes(v)) ? HIDDEN_SECRET : v;
  }

  // Obscure secret values in step text
  let sanitizedIn = inText;
  for (const sv of allSecrets) sanitizedIn = obscureInText(sanitizedIn, sv);

  return { sanitizedMap, sanitizedArgs, sanitizedIn, secretValues };
}
