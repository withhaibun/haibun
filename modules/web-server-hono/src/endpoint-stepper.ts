/**
 * Endpoint vertex stepper — makes registered HTTP routes first-class graph vertices.
 * Auto-created by ServerHono.addRoute; domain steppers connect their types via endpoint edges.
 */
import { z } from "zod";
import { AStepper, type IHasCycles } from "@haibun/core/lib/astepper.js";
import { LinkRelations, type IStepperCycles } from "@haibun/core/lib/defs.js";
import { objectCoercer } from "@haibun/core/lib/domain-types.js";

export const EndpointSchema = z.object({
	url: z.string(),
	method: z.string().default("GET"),
	description: z.string().optional(),
	registeredAt: z.coerce.date().default(() => new Date()),
});
export type Endpoint = z.infer<typeof EndpointSchema>;

export const EndpointLabels = { Endpoint: "Endpoint" } as const;
export const DOMAIN_ENDPOINT = "haibun-endpoint";

export class EndpointStepper extends AStepper implements IHasCycles {
	description = "HTTP endpoint vertex type — registered routes as graph vertices";

	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{
					selectors: [DOMAIN_ENDPOINT],
					schema: EndpointSchema,
					coerce: objectCoercer(EndpointSchema),
					description: "HTTP endpoint",
					topology: {
						vertexLabel: EndpointLabels.Endpoint,
						type: "as:Service",
						id: "url",
						properties: {
							url: LinkRelations.IDENTIFIER.rel,
							method: LinkRelations.TAG.rel,
							description: LinkRelations.NAME.rel,
							registeredAt: LinkRelations.PUBLISHED.rel,
						},
					},
				},
			],
		}),
	};

	steps = {};
}

export default EndpointStepper;
