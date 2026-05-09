/**
 * UrakataStepper — owns the world-singleton Urakata registry and exposes the
 * lifecycle steps. Other steppers retrieve the registry via
 * `world.runtime[URAKATA]` and register their tickers/watchers there.
 */
import { z } from "zod";
import { AStepper, type IHasCycles, type IStepperCycles, type TEndFeature } from "../lib/astepper.js";
import { actionNotOK, actionOK, actionOKWithProducts } from "../lib/util/index.js";
import { URAKATA, URAKATA_ID_DOMAIN, UrakataRegistry, UrakataSchema, type IHasUrakata, type IUrakataRegistry, urakataIdDomainDefinition } from "../lib/urakata.js";

class UrakataStepper extends AStepper implements IHasCycles, IHasUrakata {
	description = "Out-of-band step execution: tickers and watchers, with introspection and clean shutdown";

	private registry?: UrakataRegistry;

	urakata(): IUrakataRegistry {
		if (!this.registry) throw new Error("UrakataStepper not started");
		return this.registry;
	}

	cycles: IStepperCycles = {
		getConcerns: () => ({ domains: [urakataIdDomainDefinition] }),
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
			outputSchema: z.object({ urakata: z.array(UrakataSchema) }),
			action: () => actionOKWithProducts({ _type: "view", _summary: "Urakata", _component: "shu-result-table", view: "urakata", urakata: this.urakata().list() }),
		},

		stopUrakata: {
			gwta: `stop {id: ${URAKATA_ID_DOMAIN}}`,
			action: async ({ id }: { id: string }) => {
				await this.urakata().stop(id);
				return actionOK();
			},
		},

		forgetUrakata: {
			gwta: `forget {id: ${URAKATA_ID_DOMAIN}}`,
			action: async ({ id }: { id: string }) => {
				await this.urakata().forget(id);
				return actionOK();
			},
		},

		urakataIsRunning: {
			gwta: `urakata is running {id: ${URAKATA_ID_DOMAIN}}`,
			action: ({ id }: { id: string }) => {
				const u = this.urakata().get(id);
				return u.status === "running" ? actionOK() : actionNotOK(`urakata "${id}" status is "${u.status}", not "running"`);
			},
		},
	};
}

export default UrakataStepper;
export { UrakataStepper };
