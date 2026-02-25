import { OBSCURED_VALUE } from '../feature-variables.js';

type SecretKeyMatcher = (key: string) => boolean;

export function matchesSecretValue(value: unknown, secretValues: string[]): boolean {
  if (typeof value !== 'string') return false;
  return secretValues.includes(value);
}

export function hideValueIfSecret(value: unknown, secretValues: string[]): unknown {
  return matchesSecretValue(value, secretValues) ? OBSCURED_VALUE : value;
}

export function sanitizeObjectSecrets<T extends Record<string, unknown>>(
  input: T,
  isSecretKey: SecretKeyMatcher,
  secretValues: string[]
): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isSecretKey(key)) {
      if (value && typeof value === 'object' && 'value' in value) {
        result[key] = { ...value, value: OBSCURED_VALUE };
      } else {
        result[key] = OBSCURED_VALUE;
      }
      continue;
    }

    result[key] = hideValueIfSecret(value, secretValues);
  }

  return result as T;
}

export function hideValuesMatchingSecrets<T>(input: T, secretValues: string[]): T {
  if (Array.isArray(input)) {
    return input.map((value) => hideValueIfSecret(value, secretValues)) as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    result[key] = hideValueIfSecret(value, secretValues);
  }

  return result as T;
}
