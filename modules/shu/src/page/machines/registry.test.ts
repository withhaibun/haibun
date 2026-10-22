/** The step registry's statuses, held to their table, and the read each move holds. */
import { describe, expect, it } from "vitest";
import { assertTable, staying } from "@haibun/core/lib/test/machine-table.js";
import { INITIAL_REGISTRY, REGISTRY_EVENT, REGISTRY_STATUS, registryTransition, type TRegistryEvent, type TRegistryRead, type TRegistryState, type TStepList } from "./registry.js";

const EVENTS = Object.values(REGISTRY_EVENT);
type TType = TRegistryEvent["type"];
type TStatus = TRegistryState["status"];
const { UNREAD, READ } = REGISTRY_STATUS;

/** A read of an empty step list, from `from`. */
const NO_STEPS: TStepList = { steps: [], domains: {}, concerns: { persisted: {}, references: {} }, predicates: [] };
const readFrom = (from: "site" | "device"): TRegistryRead => (from === "site" ? { from, list: NO_STEPS } : { from, savedAt: 1, list: NO_STEPS });

const TABLE: Record<TStatus, Record<TType, TStatus>> = {
	[UNREAD]: staying(EVENTS, UNREAD, { read: READ, "read-again": READ }),
	[READ]: staying(EVENTS, READ, { read: READ, "read-again": READ }),
};

describe("the step registry", () => {
	it("moves as the table states", () => {
		const at: Record<TStatus, TRegistryState> = { [UNREAD]: INITIAL_REGISTRY, [READ]: { status: READ, read: readFrom("site") } };
		assertTable(TABLE, at, { events: EVENTS, statusOf: (state) => state.status, event: (type) => ({ type, read: readFrom("site") }), transition: registryTransition });
	});

	it("holds the latest read and where it came from, so a read again from the device replaces a read from the site", () => {
		const fromSite = registryTransition(INITIAL_REGISTRY, { type: REGISTRY_EVENT.READ, read: readFrom("site") });
		const fromDevice = registryTransition(fromSite, { type: REGISTRY_EVENT.READ_AGAIN, read: readFrom("device") });
		expect(fromDevice.status === READ && fromDevice.read.from).toBe("device");
	});
});
