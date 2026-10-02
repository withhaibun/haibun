import { z } from "zod";
import { fromJsonText } from "../lib/json-text.js";
import { persistPrincipalIndividual } from "../lib/principal-individual.js";
import type { TWorld } from "../lib/world.js";
import { AStepper, type IHasCycles, type IStepperCycles, type TEndFeature, type TFeatureStep, type TStepperSteps } from "../lib/astepper.js";
import { actionNotOK, actionOKWithProducts } from "../lib/util/index.js";
import { AUTHORITY_KEY, SessionAuthority } from "../lib/session-authority.js";
import { DELEGATIONS_READ_ACTION, DOMAIN_HELD_CALLS, HeldCallsSchema, type IAuthority } from "../lib/authority-types.js";
import { DOMAIN_ACTIONS, DOMAIN_JSON, DOMAIN_LINK, DOMAIN_PRINCIPAL_REF } from "../lib/domains.js";
import { FlowRunner } from "../lib/core/flow-runner.js";
import { actingAs, actingFor, authorizedWith, runActingAs, runAuthorizedWith } from "../lib/capability-context.js";
import { capabilityAllows, delegatedActions, readAction } from "../lib/actions.js";
import { activeSitePrincipal, SITE_DID_PREFIX } from "../lib/host-id.js";
import { Access, AccessLevelSchema, PRINCIPAL_LABEL, principalDomainDefinition } from "../lib/resources.js";

const authorityActionSchema = z
	.string()
	.min(1, "action is required")
	.refine((value) => value === "*" || value.includes(":") || value.includes("."), "action must be * or namespaced like Stepper:scope or type.action")
	.regex(/^\S+$/, "action must not contain whitespace")
	.describe("Allowed action label such as GraphStepper:read, comment.grant, or Namespace:*.");

/** What holding authority over this run's own authority means: stating and delegating it, revoking what it granted, and
 *  naming the sites that connect to it. */
export const AUTHORITY_CAPABILITIES = { delegate: "Authority:delegate", revoke: "Authority:revoke", name: "Authority:name" } as const;

/** The domains of the site a connecting instance is named, and the delegations a key holds here. */
const DOMAIN_DELEGATIONS = "delegations";
const delegationsSchema = z.object({
	delegations: z.array(z.record(z.string(), z.unknown())),
	records: z.record(z.string(), z.object({ persistedAs: z.string(), accessLevel: AccessLevelSchema })).optional(),
});

/** The inline signed-capability document presented to `holding capability …`. Must carry a controller and a Data Integrity proof; verification is delegated to the registered IAuthorityVerifier. */
const signedCapabilitySchema = z.looseObject({
	id: z.string().min(1, "capability id is required"),
	controller: z.string().min(1, "capability controller is required"),
	invocationTarget: z.string().min(1).optional(),
	allowedAction: z.union([authorityActionSchema, z.array(authorityActionSchema)]).optional(),
	parentCapability: z.string().optional(),
	proof: z.looseObject({}),
});

class AuthorityStepper extends AStepper implements IHasCycles {
	description = "Narrow what a statement may do, present a signed capability for one, read what was delegated to a key, and name the sites that connect here";

	private authority?: IAuthority;
	private steppers: AStepper[] = [];

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
		// The authority exists before any stepper's feature begins, since a stepper that registers a verifier or an
		// issuer does so when its own feature begins, and which of them runs first is the order a deployment happened to
		// list them in. What a deployment can decide should not depend on that.
		this.authority = new SessionAuthority();
		(world.runtime.keys ??= {})[AUTHORITY_KEY] = this.authority;
	}

	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{ selectors: [DOMAIN_HELD_CALLS], schema: HeldCallsSchema, description: "The calls an instance holds open, by the capability each rests on" },
				// Naming a connecting site writes a Principal record, so the type it writes is declared here.
				principalDomainDefinition,
				{ selectors: [DOMAIN_DELEGATIONS], schema: delegationsSchema, description: "The delegations an instance recorded to a key, as a holder presents them" },
			],
		}),
		endFeature: (endFeature?: TEndFeature) => {
			if (!endFeature?.shouldClose) return Promise.resolve();
			this.authority?.clear();
			delete this.getWorld().runtime.keys?.[AUTHORITY_KEY];
			this.authority = undefined;
			return Promise.resolve();
		},
	};

	steps = {
		nameConnectingSite: {
			exact: "name a connecting site",
			capability: AUTHORITY_CAPABILITIES.name,
			productsDomains: { site: DOMAIN_PRINCIPAL_REF },
			// Site principals must be unique within a federation. A default-identified instance (did:site:0 to itself)
			// asks the site it connects to what it should be called; this end assigns `did:site:<mine>.<n>`, unique
			// under this site's own principal, and durably records the assignment as a Principal individual, so `n`
			// never repeats. Called over RPC by the connecting site (see the federate step's collision handling).
			action: async () => {
				const world = this.getWorld();
				const store = world.shared?.getStore();
				if (!store) {
					return actionNotOK("naming a connecting site requires a store: a namer must durably record the principals it assigns");
				}
				const myId = activeSitePrincipal(world);
				const local = myId.startsWith(SITE_DID_PREFIX) ? myId.slice(SITE_DID_PREFIX.length) : myId.replace(/^did:/, "").replace(/:/g, ".");
				const prefix = `${SITE_DID_PREFIX}${local}.`;
				const ids = await store.distinctPropertyValues(PRINCIPAL_LABEL, "id");
				const taken = ids.filter((id) => id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length))).map((id) => Number(id.slice(prefix.length)));
				const assigned = `${prefix}${taken.length === 0 ? 1 : Math.max(...taken) + 1}`;
				const now = new Date().toISOString();
				await persistPrincipalIndividual(world, { id: myId, controller: myId, generatedAtTime: now });
				await persistPrincipalIndividual(world, { id: assigned, controller: assigned, generatedAtTime: now });
				return actionOKWithProducts({ site: assigned });
			},
		},
		delegationsTo: {
			read: true,
			capability: DELEGATIONS_READ_ACTION,
			gwta: "delegations to the caller",
			productsDomain: DOMAIN_DELEGATIONS,
			description:
				"The signed delegations this instance recorded to the key that signs the call and hasn't revoked, as the documents a holder presents: how a key finds what it may do here. A key reads its own delegations and doesn't read another key's.",
			action: async () => {
				const controller = actingAs();
				if (!controller) return actionNotOK("the delegation read answers the key that signs the call, and this call doesn't prove a key");
				return actionOKWithProducts(await this.getAuthority().delegationsTo(controller));
			},
		},
		showHeldCalls: {
			// Which calls rest on which capability is who is connected under what, which is private.
			read: true,
			capability: readAction(Access.private),
			gwta: "show held calls",
			description: "The calls held open at this instance, by the capability each rests on: what revoking that capability ends.",
			productsDomain: DOMAIN_HELD_CALLS,
			action: () => Promise.resolve(actionOKWithProducts(this.getAuthority().heldCalls())),
		},
		holdingOnly: {
			gwta: `holding only {actions: ${DOMAIN_ACTIONS}}, {what: statement}`,
			productsOf: "what",
			description:
				"Run a statement with only the listed actions, comma-separated, of those its caller holds, as the same caller. A statement can do less than its caller and never more, so a feature states a caller that holds some actions and not others, and a refusal names the action the caller lacks.",
			action: ({ actions, what }: { actions: string[]; what: TFeatureStep[] }, featureStep: TFeatureStep) => {
				const held = authorizedWith();
				return runAuthorizedWith(
					actions.filter((action) => capabilityAllows(held, action)),
					() => new FlowRunner(this.getWorld(), this.steppers).runSteps(what, { parentStep: featureStep }),
				);
			},
		},
		holdingCapability: {
			gwta: `holding capability {cap: ${DOMAIN_JSON}} at {target: ${DOMAIN_LINK}}, {what: statement}`,
			productsOf: "what",
			action: ({ cap, target, what }: { cap: unknown; target: string; what: TFeatureStep[] }, featureStep: TFeatureStep) => this.runUnderCapability(cap, target, what, featureStep),
		},
	} as const satisfies TStepperSteps;

	/**
	 * Run `what` as the controller of a signed capability, with what it allows, after verifying it through the registered
	 * IAuthorityVerifier. haibun-core stays crypto-free: verification is delegated; on `ok` the capability's controller
	 * becomes the principal.
	 */
	private async runUnderCapability(cap: unknown, target: string, what: TFeatureStep[], featureStep: TFeatureStep) {
		// A variable keeps its own domain, so a document kept as JSON text, as a record keeps a signed document, arrives as
		// the text: read as the document it spells.
		const parsed = fromJsonText(signedCapabilitySchema).safeParse(cap);
		if (!parsed.success) {
			return actionNotOK(`holding capability: invalid signed capability, ${parsed.error.issues.map((i) => i.message).join("; ")}`);
		}
		const capability = parsed.data;
		// The document goes to whoever knows how to read it, checked for everything it allows. This code doesn't read inside
		// it: the framework doesn't hold a key or implement a specification.
		// Who presents the document, which the verifier holds to its controller: a copy of a document doesn't carry the key it names.
		const presenter = actingFor();
		if (!presenter) return actionNotOK("holding capability: a capability is presented by a caller that proves who it is, and this caller doesn't");
		const verified = await this.getAuthority().verifyEvidence({ kind: "document", document: capability, target, presenter });
		if (!verified.ok) {
			return actionNotOK(`holding capability: the evidence was refused, ${verified.error}`);
		}
		const runner = new FlowRunner(this.getWorld(), this.steppers);
		const run = () => runner.runSteps(what, { parentStep: featureStep });
		// What the capability allows is all its statements may do, and its controller is who does it.
		return await runAuthorizedWith(verified.allowedAction ?? delegatedActions(capability), () => runActingAs(verified.principal ?? capability.controller, run, verified.restsOn));
	}

	private getAuthority(): IAuthority {
		if (!this.authority) {
			throw new Error("AuthorityStepper authority not initialized");
		}
		return this.authority;
	}
}

export default AuthorityStepper;
