/** Reads a page setting from the fields its element stored. */
import type { z } from "zod";
import type { TWindowSize } from "../domains/settings.js";

/** Returns the setting `schema` parses from `stored`, or `initial` where the element didn't store it or stored fields the
 *  schema rejects. */
export function storedSetting<T>(schema: z.ZodType<T>, stored: Record<string, unknown> | undefined, initial: T): T {
	const parsed = schema.safeParse(stored);
	return parsed.success ? parsed.data : initial;
}

/** Returns how many rows a windowed read returns. */
export const windowRows = ({ rows }: TWindowSize): number => Number.parseInt(rows, 10);
