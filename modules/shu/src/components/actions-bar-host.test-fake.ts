/**
 * The element a subsystem of the actions bar is held by, as the subsystem sees it: it holds controllers and can be asked
 * to render. A case renders by calling the controller's hooks, or by rendering a template the controller returns into
 * the element, and reads how many renders were asked for.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";

const HOST_TAG = "actions-bar-test-host";

export class ControllerHostFake extends HTMLElement implements ReactiveControllerHost {
	readonly controllers: ReactiveController[] = [];
	readonly updateComplete = Promise.resolve(true);
	updatesAsked = 0;
	addController(controller: ReactiveController): void {
		this.controllers.push(controller);
	}
	removeController(controller: ReactiveController): void {
		this.controllers.splice(this.controllers.indexOf(controller), 1);
	}
	requestUpdate(): void {
		this.updatesAsked++;
	}
}

/** A host on an empty page. */
export function aControllerHost(): ControllerHostFake {
	if (!customElements.get(HOST_TAG)) customElements.define(HOST_TAG, ControllerHostFake);
	document.body.innerHTML = "";
	const host = new ControllerHostFake();
	document.body.append(host);
	return host;
}
