/** A Body as a record names it: the media type of each of its forms, each with its text where the read carries it. */
import { z } from "zod";
import { RepresentationSchema } from "../../resources.js";

/** A form of a Body as a record names it: its media type, and its text where the read carries it. */
const LinkedFormSchema = RepresentationSchema.partial({ content: true });

/** A Body as a record names it: its id, the media type of its text, and the media type of each other form, each with its
 *  text where the read carries it. */
export const LinkedBodySchema = LinkedFormSchema.extend({ id: z.string(), representations: z.array(LinkedFormSchema).optional() }).loose();
export type TLinkedBody = z.infer<typeof LinkedBodySchema>;
