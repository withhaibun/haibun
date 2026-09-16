/**
 * The element a subsystem of the actions bar is held by, as the subsystem sees it: it holds controllers, can be asked to
 * render, and renders into itself. A case renders by calling the controller's hooks, or by rendering a template the
 * controller returns into the element, and reads how many renders were asked for.
 */
import type { ReactiveController } from "lit";
import type { TActionsBarHost } from "./actions-bar-model.js";

const HOST_TAG = "actions-bar-test-host";

export class ControllerHostFake extends HTMLElement implements TActionsBarHost {
	readonly controllers: ReactiveController[] = [];
	readonly updateComplete = Promise.resolve(true);
	updatesAsked = 0;
	get renderRoot(): ParentNode {
		return this;
	}
	addController(controller: ReactiveController): void {
		this.controllers.push(controller);
	}
	removeController(controller: ReactiveController): void {
		this.controllers.splice(this.controllers.indexOf(controller), 1);
	}
	requestUpdate(): void {
		this.updatesAsked++;
	}
	/** Tell each controller the host connected, as lit does when the element enters the page. */
	connect(): void {
		for (const controller of this.controllers) controller.hostConnected?.();
	}
	/** Tell each controller the host disconnected, as lit does when the element leaves the page. */
	disconnect(): void {
		for (const controller of this.controllers) controller.hostDisconnected?.();
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
