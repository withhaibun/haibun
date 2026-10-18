/** Reads a page setting from the fields its element stored. */
import type { z } from "zod";
import { errorDetail } from "@haibun/core/lib/domains/util.js";
import type { TWindowSize } from "../domains/settings.js";

/** Returns the setting `schema` parses from `stored`, or `initial` where the element didn't store one. Throws where the stored
 *  fields don't match the schema, and names `where` the fields are stored and each field the schema refused. */
export function storedSetting<T>(where: string, schema: z.ZodType<T>, stored: Record<string, unknown> | undefined, initial: T): T {
	if (stored === undefined) return initial;
	const parsed = schema.safeParse(stored);
	if (parsed.success) return parsed.data;
	throw new Error(`the fields stored for ${where} don't match its schema (${errorDetail(parsed.error)}). Choose the setting again, or remove its cookie.`);
}

/** Returns how many rows a windowed read returns. */
export const windowRows = ({ rows }: TWindowSize): number => Number.parseInt(rows, 10);
