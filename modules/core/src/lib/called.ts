import { z } from "zod";
import { IndividualAddressSchema } from "./typed-links.js";

/** A call a step made for its caller: the step it named, whether that step answered, and the record of the call. */
export const CalledSchema = z.object({ name: z.string(), ok: z.boolean(), record: IndividualAddressSchema });
export type TCalled = z.infer<typeof CalledSchema>;
