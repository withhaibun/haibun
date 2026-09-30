/**
 * `holding only {actions}, {what}`: a statement runs with the listed actions its caller holds and without another action, as the
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
import VariablesStepper from "./variables-stepper.js";
import { addStepperConcerns } from "../phases/Executor.js";
import { DOMAIN_TEXT } from "../lib/domains.js";

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
		repeats: {
			gwta: `repeats {said: ${DOMAIN_TEXT}}`,
			action: ({ said }: { said: string }) => Promise.resolve(said === KEPT ? OK : actionNotOK(`was given ${said}`)),
		},
		holdsACall: {
			exact: "holds a call",
			action: () => {
				const authority = getAuthority(this.getWorld().runtime);
				if (!authority) return Promise.resolve(actionNotOK("actuality doesn't hold an authority"));
				authority.holdWhile({ capabilities: [HELD_ON] });
				return Promise.resolve(OK);
			},
		},
		readsKept: {
			exact: "reads kept",
			action: async () => ((await this.getWorld().shared.get(KEPT_NAME)) === undefined ? OK : actionNotOK("read actuality's variable above its ceiling")),
		},
	};
}

/** The capability a held call rests on. */
const HELD_ON = "urn:uuid:held-on";

/** A variable actuality sets, which a statement it narrows names. */
const [KEPT_NAME, KEPT] = ["kept", "actuality's"];

const holds = async (content: string) =>
	(await passWithDefaults([{ path: "/features/holding.feature", content }], [AuthorityStepper, LogicStepper, VariablesStepper, PingStepper])).ok;

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
		expect(await holds(`reads public only`), "where actuality itself reads everything").toBe(false);
	});
});

describe("what a narrowed statement reads", () => {
	it("reads its arguments as the actuality that stated them, and the step reads only within what it holds", async () => {
		expect(await holds(`set ${KEPT_NAME} to "${KEPT}"\nholding only "PingStepper:repeats", repeats ${KEPT_NAME}`)).toBe(true);
		expect(await holds(`set ${KEPT_NAME} to "${KEPT}"\nholding only "PingStepper:readsKept", reads kept`)).toBe(true);
	});
});

describe("the calls held open", () => {
	it("are listed by the capability each rests on", async () => {
		const result = await passWithDefaults([{ path: "/features/held.feature", content: "holds a call\nshow held calls\n" }], [AuthorityStepper, PingStepper]);
		expect(result.featureResults?.[0]?.stepResults.at(-1)?.products).toMatchObject({ capabilities: [{ capability: HELD_ON, calls: 1 }] });
	});
});

describe("delegations to the caller", () => {
	const delegation = { id: "urn:uuid:pool", controller: "did:key:zSwimmer", allowedAction: ["Pool:enter"] };
	const records = { [delegation.id]: { persistedAs: "Capability", accessLevel: "private" as const } };
	const verifier: IAuthorityVerifier = {
		verify: () => Promise.resolve({ ok: false as const, error: "the stand-in refuses every proof" }),
		delegationsTo: (controller) => Promise.resolve({ delegations: controller === delegation.controller ? [delegation] : [], records }),
	};
	const opened = async () => {
		const world = getDefaultWorld();
		const stepper = new AuthorityStepper();
		await stepper.setWorld(world, [stepper]);
		addStepperConcerns(world, [stepper]);
		return { world, stepper, readAs: (controller?: string) => runActingAs(controller, () => stepper.steps.delegationsTo.action()) };
	};

	it("requires what only a key's own root grants, under the method a page and a launched instance call it by", async () => {
		const { world, stepper } = await opened();
		expect(buildStepRegistry([stepper], world).get(DELEGATIONS_READ_METHOD)?.descriptor.capability).toBe(DELEGATIONS_READ_ACTION);
	});

	it("answers the key the call proved, from the registered verifier, and with an empty list where a verifier isn't registered", async () => {
		const { world, readAs } = await opened();
		expect((await readAs(delegation.controller)).products, "without a registered verifier, a delegation isn't returned").toEqual({ delegations: [] });
		getAuthority(world.runtime)?.registerVerifier(verifier);
		expect((await readAs(delegation.controller)).products).toEqual({ delegations: [delegation], records });
		expect((await readAs("did:key:zStranger")).products, "another key is answered its own").toEqual({ delegations: [], records });
	});

	it("refuses a call that doesn't prove a key, since it doesn't hold a key to answer", async () => {
		const { world, readAs } = await opened();
		getAuthority(world.runtime)?.registerVerifier(verifier);
		const refused = await readAs(undefined);
		expect(refused.ok).toBe(false);
		expect(refused.ok === false && refused.errorMessage).toBe("the delegation read answers the key that signs the call, and this call doesn't prove a key");
	});
});
