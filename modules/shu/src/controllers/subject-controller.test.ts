import { beforeEach, describe, expect, it } from "vitest";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { anIndividual } from "../schemas.js";
import { INITIAL_SUBJECT, SCOPE, currentSubjectState, dispatchSubjectEvent, entryOf, type TRecord } from "../current-subject.js";
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

const PANE = entryOf([anIndividual("Email", "a@test.com")], "private");
const NOTHING = entryOf([], "private");

describe("SubjectController", () => {
	beforeEach(() => {
		currentSubjectState.set(INITIAL_SUBJECT);
	});

	it("tells a view the active record as soon as it connects, then on every change of it", () => {
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.page, entry: PANE });
		const host = aHost();
		const seen: Array<TRecord | null> = [];
		const controller = new SubjectController(host, (record) => seen.push(record));
		controller.hostConnected();
		expect(seen, "a view booting after the reader chose something is told the choice").toEqual([{ id: "a@test.com", label: "Email" }]);
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.page, entry: NOTHING });
		expect(seen.at(-1)).toBeNull();
		expect(host.updates).toBe(2);
	});

	it("relays a record once per change, not once per event", () => {
		const host = aHost();
		const seen: Array<TRecord | null> = [];
		new SubjectController(host, (record) => seen.push(record)).hostConnected();
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.page, entry: PANE });
		dispatchSubjectEvent({ type: "update", scope: SCOPE.page, entry: PANE }); // the same record, restated
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.actionsBar, entry: NOTHING }); // a closed scope leads nothing
		expect(seen).toEqual([null, { id: "a@test.com", label: "Email" }]);
	});

	it("stops relaying when the view disconnects", () => {
		const host = aHost();
		const seen: Array<TRecord | null> = [];
		const controller = new SubjectController(host, (record) => seen.push(record));
		controller.hostConnected();
		controller.hostDisconnected();
		dispatchSubjectEvent({ type: "activate", scope: SCOPE.page, entry: PANE });
		expect(seen).toEqual([null]);
		expect(controller.record, "the current answer is still readable on demand").toEqual({ id: "a@test.com", label: "Email" });
	});
});
