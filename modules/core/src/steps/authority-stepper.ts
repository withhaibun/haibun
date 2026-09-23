import { z } from "zod";
import { persistPrincipalIndividual } from "../lib/principal-individual.js";
import type { TWorld } from "../lib/world.js";
import { AStepper, type IHasCycles, type IStepperCycles, type TEndFeature, type TFeatureStep } from "../lib/astepper.js";
import { actionNotOK, actionOKWithProducts } from "../lib/util/index.js";
import { AUTHORITY_KEY, SessionAuthority } from "../lib/session-authority.js";
import { DELEGATIONS_READ_ACTION, type IAuthority } from "../lib/authority-types.js";
import { DOMAIN_JSON, DOMAIN_STRING } from "../lib/domains.js";
import { FlowRunner } from "../lib/core/flow-runner.js";
import { actingAs, authorizedWith, runActingAs, runAuthorizedWith } from "../lib/capability-context.js";
import { actionList, capabilityAllows } from "../lib/actions.js";
import { activeSitePrincipal, SITE_DID_PREFIX } from "../lib/host-id.js";
import { AccessLevelSchema, PRINCIPAL_DOMAIN, PRINCIPAL_LABEL } from "../lib/resources.js";

const authorityActionSchema = z
	.string()
	.min(1, "action is required")
	.refine((value) => value === "*" || value.includes(":") || value.includes("."), "action must be * or namespaced like Stepper:scope or type.action")
	.regex(/^\S+$/, "action must not contain whitespace")
	.describe("Allowed action label such as GraphStepper:read, comment.grant, or Namespace:*.");

/** What holding authority over this run's own authority means: stating and delegating it, revoking what it granted, and
 *  naming the sites that connect to it. */
export const AUTHORITY_CAPABILITIES = { delegate: "Authority:delegate", revoke: "Authority:revoke", name: "Authority:name" } as const;

const siteNamedSchema = z.object({ site: z.string() });
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
			productsSchema: siteNamedSchema,
			// Site principals must be unique within a federation. A default-identified instance (did:site:0 to itself)
			// asks the site it connects to what it should be called; this end assigns `did:site:<mine>.<n>`, unique
			// under this site's own principal, and durably records the assignment as a Principal individual, so `n`
			// never repeats. Called over RPC by the connecting site (see the federate step's collision handling).
			action: async () => {
				const world = this.getWorld();
				const store = world.shared?.getStore();
				if (!world.domains[PRINCIPAL_DOMAIN] || !store) {
					return actionNotOK("naming a connecting site requires the Principal domain and a store: a namer must durably record the principals it assigns");
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
			productsSchema: delegationsSchema,
			description:
				"The signed delegations this instance recorded to the key that signs the call and hasn't revoked, as the documents a holder presents: how a key finds what it may do here. A key reads its own, and no other key's.",
			action: async () => {
				const controller = actingAs();
				if (!controller) return actionNotOK("the delegation read answers the key that signs the call, and this call proves no key");
				return actionOKWithProducts(await this.getAuthority().delegationsTo(controller));
			},
		},
		holdingOnly: {
			gwta: `holding only {actions: ${DOMAIN_STRING}}, {what: statement}`,
			description:
				"Run a statement with only the listed actions, comma-separated, of those its caller holds, as the same caller. A statement can do less than its caller and never more, so a feature states a caller that holds some actions and not others, and a refusal names the action the caller lacks.",
			action: ({ actions, what }: { actions: string; what: TFeatureStep[] }, featureStep: TFeatureStep) => {
				const held = authorizedWith();
				return runAuthorizedWith(
					actionList(actions).filter((action) => capabilityAllows(held, action)),
					() => new FlowRunner(this.getWorld(), this.steppers).runSteps(what, { parentStep: featureStep }),
				);
			},
		},
		holdingCapability: {
			gwta: `holding capability {cap: ${DOMAIN_JSON}} at {target: ${DOMAIN_STRING}}, {what: statement}`,
			action: ({ cap, target, what }: { cap: unknown; target: string; what: TFeatureStep[] }, featureStep: TFeatureStep) => this.runUnderCapability(cap, target, what, featureStep),
		},
	};

	/**
	 * Run `what` as the controller of a signed capability, with what it allows, after verifying it through the registered
	 * IAuthorityVerifier. haibun-core stays crypto-free: verification is delegated; on `ok` the capability's controller
	 * becomes the principal.
	 */
	private async runUnderCapability(cap: unknown, target: string, what: TFeatureStep[], featureStep: TFeatureStep) {
		// A variable keeps its own domain, so a document kept as JSON text, as a record keeps a signed document, arrives as
		// the text: read as the document it spells, as the parameter's domain says.
		const parsed = signedCapabilitySchema.safeParse(typeof cap === "string" ? JSON.parse(cap) : cap);
		if (!parsed.success) {
			return actionNotOK(`holding capability: invalid signed capability, ${parsed.error.issues.map((i) => i.message).join("; ")}`);
		}
		const capability = parsed.data;
		const actions = capability.allowedAction === undefined ? ["*"] : Array.isArray(capability.allowedAction) ? capability.allowedAction : [capability.allowedAction];
		const action = actions[0] ?? "*";
		// The document goes to whoever knows how to read it, with what the caller says it lets them do. Nothing here
		// reads inside it: the framework holds no key and knows no specification.
		const verified = await this.getAuthority().verifyEvidence({ kind: "document", document: capability as Record<string, unknown>, action, target });
		if (!verified.ok) {
			return actionNotOK(`holding capability: the evidence was refused, ${verified.error ?? "no reason given"}`);
		}
		const runner = new FlowRunner(this.getWorld(), this.steppers);
		const run = () => runner.runSteps(what, { parentStep: featureStep });
		// What the capability allows is all its statements may do, and its controller is who does it.
		return await runAuthorizedWith(verified.allowedAction ?? actions, () => runActingAs(verified.principal ?? capability.controller, run));
	}

	private getAuthority(): IAuthority {
		if (!this.authority) {
			throw new Error("AuthorityStepper authority not initialized");
		}
		return this.authority;
	}
}

export default AuthorityStepper;
