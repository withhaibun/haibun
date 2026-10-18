/**
 * The element that holds a controller, as the controller reads it: it holds controllers, receives requests to
 * render, and renders into itself. A case renders by calling the controller's hooks, or by rendering a template the
 * controller returns into the element, and reads how many renders were requested.
 */
import type { ReactiveController } from "lit";
import type { TControllerHost } from "./controller-host.js";

const HOST_TAG = "controller-test-host";

export class ControllerHostFake extends HTMLElement implements TControllerHost {
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
	/** Notify each controller that the host connected, as lit does when the element enters the page. */
	connect(): void {
		for (const controller of this.controllers) controller.hostConnected?.();
	}
	/** Notify each controller that the host disconnected, as lit does when the element leaves the page. */
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
