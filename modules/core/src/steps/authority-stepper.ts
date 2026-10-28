import { listOf } from "../lib/domains/lists.js";
import { z } from "zod";
import { fromJsonText } from "../lib/domains/json-text.js";
import { persistPrincipalIndividual } from "../lib/domains/principal-individual.js";
import type { TWorld } from "../lib/actuality/domains/world.js";
import { AStepper, READING, type IHasCycles, type IStepperCycles, type TCallContext, type TEndFeature, type TStepperSteps } from "../lib/steps/domains/stepper.js";
import { actionNotOK, actionOKWithProducts } from "../lib/domains/util.js";
import { counted, CountedFields } from "../lib/domains/hypermedia.js";
import { SessionAuthority } from "../lib/pipelines/session-authority.js";
import { AUTHORITY_KEY } from "../lib/domains/session-authority.js";
import { DELEGATIONS_READ_ACTION, DOMAIN_HELD_CALLS, HeldCallsSchema, type IAuthority } from "../lib/domains/authority-types.js";
import { DOMAIN_ACTIONS, DOMAIN_JSON, DOMAIN_LINK, DOMAIN_PRINCIPAL_REF } from "../lib/domains/domains.js";
import { actingAs, actingFor, callerHolds, runActingAs, runAuthorizedWith } from "../lib/domains/capability-context.js";
import { AUTHORITY_CAPABILITIES, delegatedActions, permissionOf, readAction, witnessOf } from "../lib/domains/actions.js";
import { proverOf } from "../lib/actuality/pipelines/step-dispatch.js";
import { activeSitePrincipal, SITE_DID_PREFIX } from "../lib/domains/host-id.js";
import { Access, AccessLevelSchema, PRINCIPAL_LABEL, principalDomainDefinition } from "../lib/domains/resources.js";

const authorityActionSchema = z
	.string()
	.min(1, "action is required")
	.refine((value) => value === "*" || value.includes(":") || value.includes("."), "action must be * or namespaced like Stepper:scope or type.action")
	.regex(/^\S+$/, "action must not contain whitespace")
	.describe("Allowed action label such as GraphStepper:read, comment.grant, or Namespace:*.");

/** The domain of the delegations this instance recorded to a key. */
const DOMAIN_DELEGATIONS = "delegations";
const delegationsSchema = z.object({
	delegations: z.array(z.record(z.string(), z.unknown())),
	records: z.record(z.string(), z.object({ persistedAs: z.string(), accessLevel: AccessLevelSchema })).optional(),
});

/** The inline signed-capability document that `holding capability …` takes. The schema requires a controller and a Data Integrity proof. The registered IAuthorityVerifier verifies the document. */
const signedCapabilitySchema = z.looseObject({
	id: z.string().min(1, "capability id is required"),
	controller: z.string().min(1, "capability controller is required"),
	invocationTarget: z.string().min(1).optional(),
	allowedAction: z.union([authorityActionSchema, z.array(authorityActionSchema)]).optional(),
	parentCapability: z.string().optional(),
	proof: z.looseObject({}),
});

/** What `show held calls` returns: the held calls as a counted list of capabilities. */
const HeldCallsListSchema = HeldCallsSchema.extend(CountedFields);

class AuthorityStepper extends AStepper implements IHasCycles {
	description = "Narrow what a statement may do, present a signed capability for one, read what was delegated to a key, and name the sites that connect here";

	private authority?: IAuthority;
	private steppers: AStepper[] = [];

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
		// setWorld creates the authority before any feature starts. A stepper registers a verifier or an issuer in its
		// startFeature cycle, and the startFeature cycles run in the order a deployment lists the steppers. The authority
		// exists before every startFeature cycle, so registration doesn't depend on that order.
		this.authority = new SessionAuthority(world.clock);
		(world.runtime.keys ??= {})[AUTHORITY_KEY] = this.authority;
	}

	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{
					selectors: [DOMAIN_HELD_CALLS],
					schema: HeldCallsListSchema,
					list: listOf(HeldCallsListSchema, "capabilities"),
					description: "The calls an instance holds open, by the capability each rests on",
				},
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
			// Site principals are unique within a federation. An instance with the default identity (did:site:0) requests a
			// name from the site it connects to where the two principals collide. This step assigns `did:site:<mine>.<n>`,
			// which is unique under this site's own principal. It writes this site's principal and the assigned principal to
			// the store as Principal individuals, so `n` doesn't repeat. The connecting site calls this step over RPC (see the
			// federate step's collision handling).
			action: async () => {
				const world = this.getWorld();
				const store = world.shared?.getStore();
				if (!store) {
					return actionNotOK("naming a connecting site requires a store, because the step stores each principal it assigns. Run the step on an instance that has a store.");
				}
				const myId = activeSitePrincipal(world);
				const local = myId.startsWith(SITE_DID_PREFIX) ? myId.slice(SITE_DID_PREFIX.length) : myId.replace(/^did:/, "").replace(/:/g, ".");
				const prefix = `${SITE_DID_PREFIX}${local}.`;
				const ids = await store.distinctPropertyValues(PRINCIPAL_LABEL, "id");
				if (ids.saturated) return actionNotOK(`the store holds more than ${ids.total} principals, so a principal number isn't assigned from a list that stops at ${ids.total}`);
				const taken = ids.values.filter((id) => id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length))).map((id) => Number(id.slice(prefix.length)));
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
				"Returns the signed delegations that this instance recorded to the key that signs the call, as the documents a holder presents. The step omits a revoked delegation. A key's holder reads the delegations to determine what the key may do here. The step returns only the calling key's delegations.",
			action: async () => {
				const controller = actingAs();
				if (!controller) return actionNotOK("the call doesn't prove a key, and the delegation read returns only the signing key's delegations. Sign the call.");
				return actionOKWithProducts(await this.getAuthority().delegationsTo(controller));
			},
		},
		showHeldCalls: {
			// The held calls show which callers are connected under which capability, so reading them requires the private read action.
			read: true,
			capability: readAction(Access.private),
			gwta: "show held calls",
			description: "Returns the calls held open at this instance, by the capability on which each rests. Revoking a capability ends the calls that rest on it.",
			productsDomain: DOMAIN_HELD_CALLS,
			action: () => {
				const { capabilities } = this.getAuthority().heldCalls();
				return Promise.resolve(actionOKWithProducts({ capabilities, ...counted(capabilities.length) }));
			},
		},
		holdingOnly: {
			gwta: `holding only {actions: ${DOMAIN_ACTIONS}}, {what: statement}`,
			productsOf: "what",
			description:
				"Proves a statement as the same caller with only those of the listed actions that its caller holds. The actions are comma-separated. A statement can do less than its caller and never more, so a feature can state a caller that holds some actions and not others. A refusal names the action the caller lacks.",
			reading: READING.within,
			context: async ({ actions }) => {
				// The statement holds each listed action its caller's actions contain, which the reasoner proves.
				const held = callerHolds();
				const listed = actions as string[];
				const beyond = await proverOf(this.getWorld()).exceeding({ actions: listed }, { actions: held === undefined ? [] : [held].flat() });
				const narrowed = listed.filter((action) => !beyond.some(({ value }) => value === action));
				return <T>(run: () => Promise<T>) => runAuthorizedWith(narrowed, run);
			},
		},
		holdingCapability: {
			gwta: `holding capability {cap: ${DOMAIN_JSON}} at {target: ${DOMAIN_LINK}}, {what: statement}`,
			productsOf: "what",
			description: "Proves a statement under a signed capability that the registered verifier verifies, as the principal it names and with the actions it delegates.",
			reading: READING.within,
			context: ({ cap, target }) => this.underCapability(cap, String(target)),
		},
	} as const satisfies TStepperSteps;

	/**
	 * The context of a signed capability that the registered IAuthorityVerifier verifies. haibun-core doesn't implement
	 * cryptography, so verification depends on the registered verifier. Refuses a document that doesn't parse, a caller that
	 * doesn't prove a key, and evidence the verifier refuses.
	 */
	private async underCapability(cap: unknown, target: string): Promise<TCallContext | { refused: string }> {
		// A variable keeps its own domain. A record stores a signed document as JSON text, so `cap` can hold that text.
		// fromJsonText parses the text as the document.
		const parsed = fromJsonText(signedCapabilitySchema).safeParse(cap);
		if (!parsed.success) return { refused: `holding capability: invalid signed capability, ${parsed.error.issues.map((i) => i.message).join("; ")}` };
		const capability = parsed.data;
		// The registered verifier checks the document for every action the document allows. It checks the presenter against
		// the document's controller, since a copy of the document doesn't carry the key it names. The framework doesn't hold
		// a key or implement a specification.
		const presenter = actingFor();
		if (!presenter)
			return { refused: "holding capability: the caller isn't the root and doesn't prove a key, so the verifier can't check who presents the capability. Sign the call." };
		const verified = await this.getAuthority().verifyEvidence({ kind: "document", document: capability, target, presenter });
		if (!verified.ok) return { refused: `holding capability: the evidence was refused, ${verified.error}` };
		// The use at the target and the present time is contained in the capability, which the reasoner proves: the capability
		// covers the target and hasn't expired.
		const world = this.getWorld();
		const use = { actions: [], target, usedAt: new Date(world.clock.now()).toISOString() };
		const beyond = await proverOf(world).exceeding(use, permissionOf(capability));
		if (beyond.length > 0)
			return { refused: `holding capability: its use exceeds the capability by ${witnessOf(beyond)}. Present a capability whose target covers ${target} and that hasn't expired.` };
		// The statements run with the actions the verifier allows, or the capability's delegated actions where the verifier
		// doesn't list them. They run as the principal the verifier returns, or as the capability's controller.
		const allowed = verified.allowedAction ?? delegatedActions(capability);
		const principal = verified.principal ?? capability.controller;
		return <T>(run: () => Promise<T>) => runAuthorizedWith(allowed, () => runActingAs(principal, run, verified.restsOn));
	}

	private getAuthority(): IAuthority {
		if (!this.authority) {
			throw new Error("AuthorityStepper reads its authority before setWorld built it; read it from a step or a cycle after setWorld");
		}
		return this.authority;
	}
}

export default AuthorityStepper;
