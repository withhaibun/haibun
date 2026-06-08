// Control steps for shu-graph-view, kept beside the element so its controls stay with the component
// rather than accreting into a central stepper.
import { z } from "zod";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import type { TDomainDefinition } from "@haibun/core/lib/resources.js";
import { actionOKWithProducts } from "@haibun/core/lib/util/index.js";
import { GraphControlProductSchema } from "./shu-graph-view.controls-schema.js";

// productsDomain for shu-graph-view; its ui.component is declared in shu-stepper.
const GRAPH_VIEW = "shu-graph-view";

export const DOMAIN_GRAPH_OPERATION = "graph-visibility-operation";
const GraphOperationSchema = z.enum(["show", "hide"]);
export type TGraphOperation = z.infer<typeof GraphOperationSchema>;

export const DOMAIN_GRAPH_TYPES = "graph-types";
const GraphTypesSchema = z.union([z.string(), z.array(z.string())]);

const graphControlDomains: TDomainDefinition[] = [
	{ selectors: [DOMAIN_GRAPH_OPERATION], schema: GraphOperationSchema, description: "Graph visibility operation: show or hide" },
	{ selectors: [DOMAIN_GRAPH_TYPES], schema: GraphTypesSchema, description: "Graph type labels (comma-separated or array) to show or hide" },
];

const toTypeList = (types: string | string[]): string[] => (Array.isArray(types) ? types : String(types).split(",")).map((t) => t.trim()).filter(Boolean);

export default class ShuGraphViewControls extends AStepper implements IHasCycles {
	cycles: IStepperCycles = { getConcerns: () => ({ domains: graphControlDomains }) };

	steps = {
		setGraphVisibility: {
			gwta: `{operation: ${DOMAIN_GRAPH_OPERATION}} graph types {types: ${DOMAIN_GRAPH_TYPES}}`,
			productsDomain: GRAPH_VIEW,
			action: ({ operation, types }: { operation: TGraphOperation; types: string | string[] }) => {
				const list = toTypeList(types);
				return actionOKWithProducts(GraphControlProductSchema.parse(operation === "show" ? { showGraphs: list } : { hideGraphs: list }));
			},
		},
	} satisfies TStepperSteps;
}
