import { OBSCURED_VALUE } from "../feature-variables.js";

type SecretKeyMatcher = (key: string) => boolean;

export function sanitizeObjectSecrets<T extends Record<string, unknown>>(input: T, isSecretKey: SecretKeyMatcher): T {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
		if (isSecretKey(key)) {
			if (value && typeof value === "object" && "value" in value) {
				result[key] = { ...value, value: OBSCURED_VALUE };
			} else {
				result[key] = OBSCURED_VALUE;
			}
			continue;
		}

		result[key] = value;
	}

	return result as T;
}
