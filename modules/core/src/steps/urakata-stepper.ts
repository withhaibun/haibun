/**
 * UrakataStepper — owns the world-singleton Urakata registry and exposes the
 * lifecycle steps. Other steppers retrieve the registry via
 * `world.runtime[URAKATA]` and register their tickers there.
 */
import { z } from "zod";
import { AStepper, type IHasCycles, type IStepperCycles, type TEndFeature } from "../lib/astepper.js";
import { actionNotOK, actionOK, actionOKWithProducts } from "../lib/util/index.js";
import { LinkRelations } from "../lib/resources.js";
import { URAKATA, URAKATA_ID_DOMAIN, URAKATA_LABEL, UrakataRegistry, UrakataSchema, type IHasUrakata, type IUrakataRegistry, urakataIdDomainDefinition } from "../lib/urakata.js";

const DOMAIN_URAKATA_LIST = "urakata-list";
const UrakataListSchema = z.object({ urakata: z.array(UrakataSchema) });

/**
 * The persisted Urakata type: a task's lifecycle facts, queryable like any other individual. `execution` is a CONTEXT
 * facet so "what ran in instance E" is a stored query; the numeric counts derive their own columns. Nothing stores or
 * serves a "running" claim — a reader concludes it from the facts (no stoppedAt, execution is the current instance).
 */
const DOMAIN_URAKATA_TASK = "urakata-task";
const urakataTaskDomainDefinition = {
	selectors: [DOMAIN_URAKATA_TASK],
	schema: UrakataSchema,
	description:
		"A background task (ticker) started in a run: what it is, which run instance it ran in, when it started, its tick and error counts, and when it was cleanly stopped.",
	topology: {
		persistedAs: URAKATA_LABEL,
		id: "id",
		properties: {
			id: LinkRelations.IDENTIFIER.rel,
			description: LinkRelations.NAME.rel,
			execution: LinkRelations.CONTEXT.rel,
			generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel,
		},
	},
};

class UrakataStepper extends AStepper implements IHasCycles, IHasUrakata {
	description = "Out-of-band step execution: tickers, with introspection and clean shutdown";

	private registry?: UrakataRegistry;

	urakata(): IUrakataRegistry {
		if (!this.registry) throw new Error("UrakataStepper not started");
		return this.registry;
	}

	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				urakataIdDomainDefinition,
				urakataTaskDomainDefinition,
				{ selectors: [DOMAIN_URAKATA_LIST], schema: UrakataListSchema, description: "List of running urakata", ui: { component: "shu-result-table", summary: "Urakata" } },
			],
		}),
		startFeature: () => {
			const world = this.getWorld();
			this.registry = new UrakataRegistry(world, (id, seqPath, err) => {
				world.eventLogger.warn(`[urakata] tick failed in "${id}": ${err.message}`, {
					"haibun.autonomic.event": "step.failure",
					"haibun.autonomic.seqPath": seqPath.join("."),
					"haibun.urakata.id": id,
					"exception.type": err.name || "Error",
					"exception.message": err.message,
				});
			});
			world.runtime[URAKATA] = this.registry;
		},
		endFeature: async (endFeature?: TEndFeature) => {
			if (!endFeature?.shouldClose || !this.registry) return;
			await this.registry.stopAll();
			this.registry = undefined;
			delete this.getWorld().runtime[URAKATA];
		},
	};

	steps = {
		showUrakata: {
			gwta: "show urakata",
			productsDomain: DOMAIN_URAKATA_LIST,
			action: () => actionOKWithProducts({ urakata: this.urakata().list() }),
		},

		stopUrakata: {
			gwta: `stop urakata {id: ${URAKATA_ID_DOMAIN}}`,
			action: async ({ id }: { id: string }) => {
				await this.urakata().stop(id);
				return actionOK();
			},
		},

		forgetUrakata: {
			gwta: `forget urakata {id: ${URAKATA_ID_DOMAIN}}`,
			action: async ({ id }: { id: string }) => {
				await this.urakata().forget(id);
				return actionOK();
			},
		},

		urakataIsRunning: {
			gwta: `urakata is running {id: ${URAKATA_ID_DOMAIN}}`,
			action: ({ id }: { id: string }) => {
				const u = this.urakata().get(id);
				return u.stoppedAt === undefined ? actionOK() : actionNotOK(`urakata "${id}" was stopped at ${u.stoppedAt}, not running`);
			},
		},
	};
}

export default UrakataStepper;
export { UrakataStepper };
