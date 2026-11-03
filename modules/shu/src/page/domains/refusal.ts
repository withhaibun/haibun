/**
 * A refusal as the page shows it (CA4D5): its cause in words, its remedy as data, and the id of the refused step's record
 * where actuality recorded it. A remedy is the site's, which includes a reference to open, or a read again where the page
 * didn't reach the site.
 */
import { z } from "zod";
import { RemedySchema, RpcRefusalSchema } from "@haibun/core/lib/rpc-wire.js";

export const PageRemedySchema = z.union([RemedySchema, z.object({ do: z.literal("read-again") })]);
export type TPageRemedy = z.infer<typeof PageRemedySchema>;

export const PageRefusalSchema = RpcRefusalSchema.extend({ remedy: PageRemedySchema.optional() });
export type TPageRefusal = z.infer<typeof PageRefusalSchema>;

/** The remedy of a read that didn't reach the site. */
export const READ_AGAIN = { do: "read-again" } as const satisfies TPageRemedy;
