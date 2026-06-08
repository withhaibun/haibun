import { z } from "zod";

// Shared by the graph-view control step and the element's `products` setter. Its own module so the
// client element can import it without pulling @haibun/core (via the stepper) into the browser bundle.
export const GraphControlProductSchema = z.object({
	hideGraphs: z.array(z.string()).optional(),
	showGraphs: z.array(z.string()).optional(),
});
export type TGraphControlProduct = z.infer<typeof GraphControlProductSchema>;
