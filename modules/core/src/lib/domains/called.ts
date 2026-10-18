import { z } from "zod";
import { IndividualAddressSchema } from "./typed-links.js";

/** A call that a step made for its caller. It holds the called step's name, whether that step passed, and the address of the call's record. */
export const CalledSchema = z.object({ name: z.string(), ok: z.boolean(), record: IndividualAddressSchema });
export type TCalled = z.infer<typeof CalledSchema>;
