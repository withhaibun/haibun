import { z } from "zod";
import { ViewQuerySchema } from "../view-query.js";

/**
 * A view-query control product — the partial set of query fields a control step changes. shu-graph-query's
 * `set products()` validates an incoming product against this and applies it to the viewQuery store. Its own
 * module (as every controls schema is) so the browser element imports the schema without pulling
 * @haibun/core (via the stepper) into the bundle.
 */
export const ViewQueryControlSchema = ViewQuerySchema.partial();
export type TViewQueryControl = z.infer<typeof ViewQueryControlSchema>;
