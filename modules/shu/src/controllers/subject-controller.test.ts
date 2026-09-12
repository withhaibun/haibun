import { beforeEach, describe, expect, it } from "vitest";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { anIndividual } from "../schemas.js";
import { INITIAL_SUBJECT, currentSubjectState, dispatchSubjectEvent, type TRecord } from "../current-subject.js";
import { SubjectController } from "./subject-controller.js";

/** A host as a controller sees one: it registers controllers and can be asked to update. */
function aHost(): ReactiveControllerHost & { controllers: ReactiveController[]; updates: number } {
	const host = {
		controllers: [] as ReactiveController[],
		updates: 0,
		addController(c: ReactiveController) {
			host.controllers.push(c);
		},
		removeController(c: ReactiveController) {
			host.controllers = host.controllers.filter((held) => held !== c);
		},
		requestUpdate() {
			host.updates++;
		},
		updateComplete: Promise.resolve(true),
	};
	return host;
}

const EMAIL = anIndividual("Email", "a@test.com");
const PANE = { patterns: [EMAIL], accessLevel: "private" };

describe("SubjectController", () => {
	beforeEach(() => {
		currentSubjectState.set(INITIAL_SUBJECT);
	});

	it("tells a view what the reader is on as soon as it connects, then on every change of it", () => {
		dispatchSubjectEvent({ type: "openInPane", pane: PANE });
		const host = aHost();
		const seen: Array<TRecord | null> = [];
		const controller = new SubjectController(host, (record) => seen.push(record));
		controller.hostConnected();
		expect(seen, "a view booting after the reader chose something is told the choice").toEqual([{ id: "a@test.com", label: "Email" }]);
		dispatchSubjectEvent({ type: "clearSubject" });
		expect(seen.at(-1)).toBeNull();
		expect(host.updates).toBe(2);
	});

	it("relays a record once per change, not once per event", () => {
		const host = aHost();
		const seen: Array<TRecord | null> = [];
		new SubjectController(host, (record) => seen.push(record)).hostConnected();
		dispatchSubjectEvent({ type: "openInPane", pane: PANE });
		dispatchSubjectEvent({ type: "paneClosed", pane: PANE }); // the same record, restated
		dispatchSubjectEvent({ type: "recorded", item: { id: "cmt-ask-0.1", seqPath: "0.1" } }); // no turn runs: nothing to record against
		expect(seen).toEqual([null, { id: "a@test.com", label: "Email" }]);
	});

	it("stops relaying when the view disconnects", () => {
		const host = aHost();
		const seen: Array<TRecord | null> = [];
		const controller = new SubjectController(host, (record) => seen.push(record));
		controller.hostConnected();
		controller.hostDisconnected();
		dispatchSubjectEvent({ type: "openInPane", pane: PANE });
		expect(seen).toEqual([null]);
		expect(controller.record, "the current answer is still readable on demand").toEqual({ id: "a@test.com", label: "Email" });
	});
});
