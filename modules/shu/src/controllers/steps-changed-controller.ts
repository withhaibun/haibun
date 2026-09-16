import type { ReactiveController, ReactiveControllerHost } from "lit";
import { onStepsChanged } from "../rpc-registry.js";

/** A view's handle on the run's steps: the view reads them again each time the page has read them again, which the page
 *  does when the run's steps change. */
export class StepsChangedController implements ReactiveController {
	private stop: (() => void) | undefined;

	constructor(
		host: ReactiveControllerHost,
		private readonly readAgain: () => Promise<void> | void,
	) {
		host.addController(this);
	}

	hostConnected(): void {
		this.stop = onStepsChanged(this.readAgain);
	}

	hostDisconnected(): void {
		this.stop?.();
		this.stop = undefined;
	}
}
