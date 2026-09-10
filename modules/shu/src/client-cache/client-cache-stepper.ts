/**
 * ClientCacheStepper: the client cache's stepper: declares the client cache view (so `show views` lists it) and opens it
 * (`show client cache`). The cache itself is the library beside this file (index.ts), read by the view; facts about it
 * are read from the view's test ids with the generic steps (`save text from … to …`, `variable … is …`, `matches`),
 * so no step here repeats what the view shows.
 */
import { z } from "zod";
import { AStepper, type IHasCycles, type IStepperCycles } from "@haibun/core/lib/astepper.js";
import { actionOKWithProducts } from "@haibun/core/lib/util/index.js";
import { SHU_TAG } from "../consts.js";

export default class ClientCacheStepper extends AStepper implements IHasCycles {
	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{
					selectors: [SHU_TAG.CLIENT_CACHE_COLUMN],
					schema: z.object({}),
					description: "What this page caches of the run: each run source's extent, cached spans and cursor row, the live stream by level, and what the device stores",
					ui: { component: SHU_TAG.CLIENT_CACHE_COLUMN },
				},
			],
		}),
	};

	steps = {
		showClientCache: {
			gwta: "show client cache",
			description: "Open the client cache view: what the page caches of the run, every value under its own test id.",
			productsDomain: SHU_TAG.CLIENT_CACHE_COLUMN,
			action: () => actionOKWithProducts({}),
		},
	};
}
