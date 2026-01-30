import { TStepperStep, TStepValuesMap } from './defs.js';

export const HIDDEN_SECRET = '[hidden_secret]';

export const isSecretByName = (term: string) => term.toLowerCase().includes('password');

export function willBeSecret(step?: TStepperStep, stepValuesMap?: TStepValuesMap): boolean {
  if (!step?.handlesSecret || !stepValuesMap) return false;
  
  const domain = stepValuesMap.domain?.term?.toLowerCase();
  if (domain === 'secret') return true;
  
  const varName = stepValuesMap.what?.term;
  return varName ? isSecretByName(varName) : false;
}
