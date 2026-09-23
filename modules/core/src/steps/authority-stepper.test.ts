/**
 * `holding only {actions}, {what}`: a statement runs with the listed actions its caller holds and nothing else, as the
 * same caller. It narrows and never widens, so a feature states a caller holding some actions and not others.
 */
import { describe, expect, it } from "vitest";
import { getDefaultWorld, passWithDefaults } from "../lib/test/lib.js";
import { AStepper } from "../lib/astepper.js";
import { OK } from "../schema/protocol.js";
import { actionNotOK } from "../lib/util/index.js";
import { readingAt } from "../lib/capability-context.js";
import { getAuthority } from "../lib/session-authority.js";
import { buildStepRegistry } from "../lib/step-registry.js";
import { DELEGATIONS_READ_METHOD, type IAuthorityVerifier } from "../lib/authority-types.js";
import AuthorityStepper from "./authority-stepper.js";
import LogicStepper from "./logic-stepper.js";

class PingStepper extends AStepper {
	description = "A step that takes Ping:protected, for tests of narrowing what a statement holds.";
	steps = {
		protectedPing: {
			exact: "protected ping",
			capability: "Ping:protected",
			action: () => Promise.resolve(OK),
		},
		readsPublicOnly: {
			exact: "reads public only",
			action: () => Promise.resolve(readingAt() === "public" ? OK : actionNotOK(`reads at ${readingAt() ?? "no ceiling"}`)),
		},
	};
}

const holds = async (content: string) => (await passWithDefaults([{ path: "/features/holding.feature", content }], [AuthorityStepper, LogicStepper, PingStepper])).ok;

describe("holding only", () => {
	it("runs a statement with a listed action its caller holds", async () => {
		expect(await holds(`holding only "Ping:protected", protected ping`)).toBe(true);
	});

	it("refuses a step whose action the statement doesn't list, though its caller holds it", async () => {
		expect(await holds(`not holding only "Ping:other", protected ping`)).toBe(true);
		expect(await holds(`holding only "Ping:other", protected ping`), "the refusal fails the statement").toBe(false);
	});

	it("never widens: a statement inside a narrower one holds only what both list", async () => {
		expect(await holds(`not holding only "Ping:other", holding only "Ping:protected", protected ping`)).toBe(true);
	});
});

describe("holding only a read", () => {
	it("bounds what the statement reads to the level listed", async () => {
		expect(await holds(`holding only "PingStepper:readsPublicOnly,Read:public", reads public only`)).toBe(true);
		expect(await holds(`reads public only`), "where the run itself reads everything").toBe(false);
	});
});

describe("delegations to a controller", () => {
	const delegation = { id: "urn:uuid:pool", controller: "did:key:zSwimmer", allowedAction: ["Pool:enter"] };
	const verifier: IAuthorityVerifier = {
		verify: () => Promise.resolve({ ok: false }),
		delegationsTo: (controller) => Promise.resolve({ delegations: controller === delegation.controller ? [delegation] : [], recordedAs: "Capability" }),
	};

	it("requires nothing, since a key reads what was delegated to it before it holds anything", async () => {
		const world = getDefaultWorld();
		const stepper = new AuthorityStepper();
		await stepper.setWorld(world, [stepper]);
		const read = buildStepRegistry([stepper], world).get(DELEGATIONS_READ_METHOD);
		expect(read, "under the method a page and a launched instance call it by").toBeDefined();
		expect(read?.descriptor.capability).toBeUndefined();
	});

	it("answers from the registered verifier, and with none where nothing verifies a delegation", async () => {
		const world = getDefaultWorld();
		const stepper = new AuthorityStepper();
		await stepper.setWorld(world, [stepper]);
		const read = (controller: string) => stepper.steps.delegationsTo.action({ controller });
		expect((await read(delegation.controller)).products, "nothing registered, nothing delegated").toEqual({ delegations: [] });
		getAuthority(world.runtime)?.registerVerifier(verifier);
		expect((await read(delegation.controller)).products).toEqual({ delegations: [delegation], recordedAs: "Capability" });
		expect((await read("did:key:zStranger")).products).toEqual({ delegations: [], recordedAs: "Capability" });
	});
});
