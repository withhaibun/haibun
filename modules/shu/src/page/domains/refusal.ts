/**
 * A refusal as the page shows it (CA4D5): its cause in words, and its remedy as data. A remedy is the site's, a read again
 * where the page didn't reach the site, or a reference to open where the page refuses a read before it sends one.
 */
import { z } from "zod";
import { RemedySchema } from "@haibun/core/lib/rpc-wire.js";

export const PageRemedySchema = z.union([
	RemedySchema,
	z.object({ do: z.literal("read-again") }),
	z.object({ do: z.literal("open"), ref: z.object({ kind: z.string(), target: z.record(z.string(), z.unknown()) }) }),
]);
export type TPageRemedy = z.infer<typeof PageRemedySchema>;

export const PageRefusalSchema = z.object({ error: z.string().min(1), remedy: PageRemedySchema.optional() });
export type TPageRefusal = z.infer<typeof PageRefusalSchema>;

/** The remedy of a read that didn't reach the site. */
export const READ_AGAIN = { do: "read-again" } as const satisfies TPageRemedy;
