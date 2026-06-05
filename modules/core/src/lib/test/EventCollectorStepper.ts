import { AStepper } from "../astepper.js";
import type { TWorld } from "../world.js";

import { THaibunEvent } from "../../schema/protocol.js";

/**
 * Collects events for test inspection.
 *
 * ```ts
 * const collector = new EventCollectorStepper();
 * const res = await passWithDefaults(content, [collector, ...steppers]);
 * const events = collector.getEvents();
 * const stepEvents = collector.getStepEvents();
 * ```
 */
export class EventCollectorStepper extends AStepper {
	description = "Collects events for test inspection";

	private events: THaibunEvent[] = [];
	private subscriberCallback?: (event: THaibunEvent) => void;

	async setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
		await super.setWorld(world, steppers);
		this.subscriberCallback = (event: THaibunEvent) => {
			this.events.push(event);
		};
		world.eventLogger.subscribe(this.subscriberCallback);
	}

	steps = {};

	getEvents(): THaibunEvent[] {
		return [...this.events];
	}

	/** Step lifecycle events only. */
	getStepEvents(): THaibunEvent[] {
		return this.events.filter((e) => "type" in e && e.type === "step");
	}

	findEvents(predicate: (e: THaibunEvent) => boolean): THaibunEvent[] {
		return this.events.filter(predicate);
	}

	clear(): void {
		this.events = [];
	}

	close(): void {
		if (this.subscriberCallback && this.world?.eventLogger) {
			this.world.eventLogger.unsubscribe(this.subscriberCallback);
			this.subscriberCallback = undefined;
		}
	}
}

export default EventCollectorStepper;
