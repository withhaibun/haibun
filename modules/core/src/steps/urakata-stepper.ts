/**
 * UrakataStepper: owns the world-singleton Urakata registry and exposes the
 * lifecycle steps. Other steppers retrieve the registry via
 * `world.runtime[URAKATA]` and register their tickers there.
 */
import { listOf } from "../lib/domains/lists.js";
import { CountedFields, counted } from "../lib/domains/hypermedia.js";
import { z } from "zod";
import { AStepper, type IHasCycles, type IStepperCycles, type TEndFeature, type TStepperSteps } from "../lib/steps/domains/stepper.js";
import { actionNotOK, actionOK, actionOKWithProducts } from "../lib/domains/util.js";
import { Access, LinkRelations } from "../lib/domains/resources.js";
import { EVENT_ATTRIBUTE, STEP_FAILURE_EVENT } from "../lib/domains/protocol.js";
import { UrakataRegistry } from "../lib/pipelines/urakata.js";
import { URAKATA, URAKATA_ID_DOMAIN, URAKATA_LABEL, UrakataSchema, type IHasUrakata, type IUrakataRegistry, urakataIdDomainDefinition } from "../lib/domains/urakata.js";
import { ENDED_BY_FIELD, ACTUALITY_FIELD } from "../lib/actuality/domains/seq-path.js";

const DOMAIN_URAKATA_LIST = "urakata-list";
const UrakataListSchema = z.object({ urakata: z.array(UrakataSchema), ...CountedFields });

/**
 * The persisted Urakata type: a task's lifecycle facts, queryable like any other individual. `actuality` is a CONTEXT
 * facet so "what ran in instance E" is a stored query; the numeric counts derive their own columns. The task's status and
 * its stoppedAt state how it stands; a start-up reads the records whose process ended before they stopped by the column of
 * stoppedAt, and ends each as interrupted.
 */
const DOMAIN_URAKATA_TASK = "urakata-task";
export const urakataTaskDomainDefinition = {
	selectors: [DOMAIN_URAKATA_TASK],
	schema: UrakataSchema,
	description:
		"A background task (ticker) started in a run: what it is, which run instance it ran in, when it started, its tick and error counts, and when it was cleanly stopped.",
	topology: {
		persistedAs: URAKATA_LABEL,
		accessLevel: Access.private,
		id: "id",
		instrumentation: true,
		countedBy: ["actionStatus", ACTUALITY_FIELD],
		properties: {
			id: LinkRelations.IDENTIFIER.rel,
			description: LinkRelations.NAME.rel,
			[ACTUALITY_FIELD]: LinkRelations.CONTEXT.rel,
			seqPath: LinkRelations.SEQ_PATH.rel,
			startedAt: LinkRelations.STARTED_AT_TIME.rel,
			lastTickAt: LinkRelations.UPDATED.rel,
			tickIndex: LinkRelations.TAG.rel,
			errorCount: LinkRelations.TAG.rel,
			actionStatus: LinkRelations.ACTION_STATUS.rel,
			stoppedAt: LinkRelations.ENDED_AT_TIME.rel,
			[ENDED_BY_FIELD]: LinkRelations.WAS_ENDED_BY.rel,
			startedBy: LinkRelations.PERFORMED_BY.rel,
			holds: LinkRelations.ALLOWED_ACTION.rel,
			stopReason: LinkRelations.OUTCOME_REASON.rel,
		},
		sortColumns: { stoppedAt: "TIMESTAMPTZ" },
	},
};

class UrakataStepper extends AStepper implements IHasCycles, IHasUrakata {
	description = "Steps that run outside the feature flow: tickers, with introspection and clean shutdown";

	private registry?: UrakataRegistry;

	urakata(): IUrakataRegistry {
		if (!this.registry) throw new Error("UrakataStepper reads its registry before a feature started it; read it during a feature");
		return this.registry;
	}

	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				urakataIdDomainDefinition,
				urakataTaskDomainDefinition,
				{
					selectors: [DOMAIN_URAKATA_LIST],
					schema: UrakataListSchema,
					list: listOf(UrakataListSchema, "urakata"),
					description: "List of running urakata",
					ui: { component: "shu-result-table", summary: "Urakata" },
				},
			],
		}),
		startFeature: () => {
			const world = this.getWorld();
			this.registry = new UrakataRegistry(world, {
				failed: (id, seqPath, err) =>
					world.eventLogger.warn(`[urakata] ticks fail in "${id}": ${err.message}`, {
						[EVENT_ATTRIBUTE.event]: STEP_FAILURE_EVENT,
						[EVENT_ATTRIBUTE.seqPath]: seqPath.join("."),
						"haibun.urakata.id": id,
						"exception.type": err.name || "Error",
						"exception.message": err.message,
					}),
				recovered: (id, seqPath, held) =>
					world.eventLogger.info(`[urakata] ticks succeed again in "${id}" after ${held.occurrences} failed, the latest with: ${held.latest}`, {
						[EVENT_ATTRIBUTE.seqPath]: seqPath.join("."),
						"haibun.urakata.id": id,
					}),
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
			action: () => {
				const urakata = this.urakata().list();
				return actionOKWithProducts({ urakata, ...counted(urakata.length) });
			},
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
	} as const satisfies TStepperSteps;
}

export default UrakataStepper;
export { UrakataStepper };
