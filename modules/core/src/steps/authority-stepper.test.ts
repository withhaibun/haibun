/**
 * Tests `holding only {actions}, {what}`. The statement runs as the same caller with only those of the listed actions that
 * its caller holds. The step narrows what a caller holds and never widens it, so a feature can state a caller that holds
 * some actions and not others. The file also tests `show held calls` and `delegations to the caller`.
 */
import { describe, expect, it } from "vitest";
import { getDefaultWorld, passWithDefaults } from "../lib/test/lib.js";
import { LogicStepper } from "../lib/test/logic-stepper.js";
import { AStepper } from "../lib/steps/domains/stepper.js";
import { OK } from "../lib/domains/protocol.js";
import { actionNotOK } from "../lib/domains/util.js";
import { readingAt, runActingAs } from "../lib/domains/capability-context.js";
import { getAuthority } from "../lib/domains/session-authority.js";
import { buildStepRegistry } from "../lib/steps/pipelines/step-registry.js";
import { DELEGATIONS_READ_ACTION, DELEGATIONS_READ_METHOD } from "../lib/domains/authority-types.js";
import { stubVerifier } from "../lib/test/fake-authority.js";
import AuthorityStepper from "./authority-stepper.js";
import VariablesStepper from "./variables-stepper.js";
import { addStepperConcerns } from "../lib/actuality/pipelines/executor.js";
import { DOMAIN_TEXT } from "../lib/domains/domains.js";
import { readAction } from "../lib/domains/actions.js";
import { Access } from "../lib/domains/resources.js";

const READS_PUBLIC = readAction(Access.public);

class PingStepper extends AStepper {
	description = "Provides the steps that these tests run.";
	steps = {
		protectedPing: { exact: "protected ping", capability: "Ping:protected", action: () => Promise.resolve(OK) },
		readsPublicOnly: { exact: "reads public only", action: () => Promise.resolve(readingAt() === "public" ? OK : actionNotOK(`reads at ${readingAt() ?? "every level"}`)) },
		repeats: { gwta: `repeats {said: ${DOMAIN_TEXT}}`, action: ({ said }: { said: string }) => Promise.resolve(said === KEPT ? OK : actionNotOK(`was given ${said}`)) },
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

/** The capability on which a held call rests. */
const HELD_ON = "urn:uuid:held-on";

/** A variable that actuality sets. A narrowed statement names this variable. */
const [KEPT_NAME, KEPT] = ["kept", "actuality's"];

const holds = async (content: string) =>
	(await passWithDefaults([{ path: "/features/holding.feature", content }], [AuthorityStepper, VariablesStepper, PingStepper, LogicStepper])).ok;

describe("holding only", () => {
	it("runs a statement with a listed action its caller holds", async () => {
		expect(await holds(`holding only "Ping:protected", protected ping`)).toBe(true);
	});

	it("refuses a step whose action the statement doesn't list, though its caller holds it", async () => {
		expect(await holds(`set refused from maybe holding only "Ping:other", protected ping\nvariable refused.lacksAction is "Ping:protected"`)).toBe(true);
		expect(await holds(`holding only "Ping:other", protected ping`), "the refusal fails the statement").toBe(false);
	});

	it("never widens: a statement inside a narrower one holds only what both list", async () => {
		expect(
			await holds(
				`set refused from maybe holding only "Ping:other,AuthorityStepper:holdingOnly", holding only "Ping:protected", protected ping\nvariable refused.lacksAction is "Ping:protected"`,
			),
		).toBe(true);
	});
});

describe("holding only a read", () => {
	it("bounds what the statement reads to the level listed", async () => {
		expect(await holds(`holding only "PingStepper:readsPublicOnly,Read:public", reads public only`)).toBe(true);
		expect(await holds(`reads public only`), "actuality outside a narrowed statement reads at every level").toBe(false);
	});
});

describe("what a narrowed statement reads", () => {
	it("resolves its arguments with what actuality holds, and its step reads only within what the statement holds", async () => {
		expect(await holds(`set ${KEPT_NAME} to "${KEPT}"\nholding only "PingStepper:repeats,${READS_PUBLIC}", repeats ${KEPT_NAME}`)).toBe(true);
		expect(await holds(`set ${KEPT_NAME} to "${KEPT}"\nholding only "PingStepper:readsKept,${READS_PUBLIC}", reads kept`)).toBe(true);
	});
});

describe("the calls held open", () => {
	it("are listed by the capability each rests on", async () => {
		const result = await passWithDefaults([{ path: "/features/held.feature", content: "holds a call\nshow held calls\n" }], [AuthorityStepper, PingStepper, LogicStepper]);
		expect(result.featureResults?.[0]?.stepResults.at(-1)?.products).toMatchObject({ capabilities: [{ capability: HELD_ON, calls: 1 }] });
	});
});

describe("delegations to the caller", () => {
	const delegation = { id: "urn:uuid:pool", controller: "did:key:zSwimmer", allowedAction: ["Pool:enter"] };
	const records = { [delegation.id]: { persistedAs: "Capability", accessLevel: "private" as const } };
	const verifier = stubVerifier({
		verify: () => Promise.resolve({ ok: false as const, error: "the stub verifier refuses every proof" }),
		delegationsTo: (controller) => Promise.resolve({ delegations: controller === delegation.controller ? [delegation] : [], records }),
	});
	const opened = async () => {
		const world = getDefaultWorld();
		const stepper = new AuthorityStepper();
		await stepper.setWorld(world, [stepper]);
		addStepperConcerns(world, [stepper]);
		return { world, stepper, readAs: (controller?: string) => runActingAs(controller, () => stepper.steps.delegationsTo.action()) };
	};

	it("requires the action that only a key's own root grants, under the method that pages and launched instances call", async () => {
		const { world, stepper } = await opened();
		expect(buildStepRegistry([stepper], world).get(DELEGATIONS_READ_METHOD)?.descriptor.capability).toBe(DELEGATIONS_READ_ACTION);
	});

	it("returns the registered verifier's delegations to the key the call proved, and an empty list where a verifier isn't registered", async () => {
		const { world, readAs } = await opened();
		expect((await readAs(delegation.controller)).products, "a delegation isn't returned without a registered verifier").toEqual({ delegations: [] });
		getAuthority(world.runtime)?.registerVerifier(verifier);
		expect((await readAs(delegation.controller)).products).toEqual({ delegations: [delegation], records });
		expect((await readAs("did:key:zStranger")).products, "another key's own delegations are returned").toEqual({ delegations: [], records });
	});

	it("refuses a call that doesn't prove a key, since the read returns only the delegations to the calling key", async () => {
		const { world, readAs } = await opened();
		getAuthority(world.runtime)?.registerVerifier(verifier);
		const refused = await readAs(undefined);
		expect(refused.ok).toBe(false);
		expect(refused.ok === false && refused.errorMessage).toBe("the call doesn't prove a key, and the delegation read returns only the signing key's delegations. Sign the call.");
	});
});
