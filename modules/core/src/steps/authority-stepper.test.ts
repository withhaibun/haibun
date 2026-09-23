/**
 * `holding only {actions}, {what}`: a statement runs with the listed actions its caller holds and nothing else, as the
 * same caller. It narrows and never widens, so a feature states a caller holding some actions and not others.
 */
import { describe, expect, it } from "vitest";
import { getDefaultWorld, passWithDefaults } from "../lib/test/lib.js";
import { AStepper } from "../lib/astepper.js";
import { OK } from "../schema/protocol.js";
import { actionNotOK } from "../lib/util/index.js";
import { readingAt, runActingAs } from "../lib/capability-context.js";
import { getAuthority } from "../lib/session-authority.js";
import { buildStepRegistry } from "../lib/step-registry.js";
import { DELEGATIONS_READ_ACTION, DELEGATIONS_READ_METHOD, type IAuthorityVerifier } from "../lib/authority-types.js";
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

describe("delegations to the caller", () => {
	const delegation = { id: "urn:uuid:pool", controller: "did:key:zSwimmer", allowedAction: ["Pool:enter"] };
	const records = { [delegation.id]: { persistedAs: "Capability", accessLevel: "private" as const } };
	const verifier: IAuthorityVerifier = {
		verify: () => Promise.resolve({ ok: false }),
		delegationsTo: (controller) => Promise.resolve({ delegations: controller === delegation.controller ? [delegation] : [], records }),
	};
	const opened = async () => {
		const world = getDefaultWorld();
		const stepper = new AuthorityStepper();
		await stepper.setWorld(world, [stepper]);
		return { world, stepper, readAs: (controller?: string) => runActingAs(controller, () => stepper.steps.delegationsTo.action()) };
	};

	it("requires what only a key's own root grants, under the method a page and a launched instance call it by", async () => {
		const { world, stepper } = await opened();
		expect(buildStepRegistry([stepper], world).get(DELEGATIONS_READ_METHOD)?.descriptor.capability).toBe(DELEGATIONS_READ_ACTION);
	});

	it("answers the key the call proved, from the registered verifier, and with none where nothing verifies a delegation", async () => {
		const { world, readAs } = await opened();
		expect((await readAs(delegation.controller)).products, "nothing registered, nothing delegated").toEqual({ delegations: [] });
		getAuthority(world.runtime)?.registerVerifier(verifier);
		expect((await readAs(delegation.controller)).products).toEqual({ delegations: [delegation], records });
		expect((await readAs("did:key:zStranger")).products, "another key is answered its own").toEqual({ delegations: [], records });
	});

	it("refuses a call that proves no key, since there is no key to answer", async () => {
		const { world, readAs } = await opened();
		getAuthority(world.runtime)?.registerVerifier(verifier);
		const refused = await readAs(undefined);
		expect(refused.ok).toBe(false);
		expect(refused.ok === false && refused.errorMessage).toBe("the delegation read answers the key that signs the call, and this call proves no key");
	});
});
