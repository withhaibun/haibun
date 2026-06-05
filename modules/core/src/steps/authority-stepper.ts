import { z } from "zod";
import { type TDomainDefinition } from "../lib/resources.js";
import { persistPrincipalIndividual } from "../lib/principal-individual.js";
import type { TWorld } from "../lib/world.js";
import { AStepper, type IHasCycles, type IStepperCycles, type TEndFeature, type TFeatureStep } from "../lib/astepper.js";
import { actionNotOK, actionOKWithProducts } from "../lib/util/index.js";
import { ZCAP_AUTHORITY, ZCAP_TOKEN_KEY, ZcapAuthority } from "../lib/zcap-authority.js";
import type { IZcapAuthority, TZcapGrant, TZcapInvocation } from "../lib/zcap-types.js";
import { DOMAIN_JSON, DOMAIN_STRING } from "../lib/domains.js";
import { FlowRunner } from "../lib/core/flow-runner.js";
import { currentPrincipal, withPrincipal } from "../lib/principal.js";

const ZCAP_TOKEN_DOMAIN = "zcap-token";
const ZCAP_ACTION_DOMAIN = "zcap-action";

/** A subkey `s` delegated from site principal `P` is the DID `${P}:${s}` (e.g. did:site:0 + alice → did:site:0:alice). */
function subkeyDid(sitePrincipal: string, subkey: string): string {
	return `${sitePrincipal}:${subkey}`;
}

const zcapTokenSchema = z
	.string()
	.min(1, "token is required")
	.regex(/^\S+$/, "token must not contain whitespace")
	.describe("Opaque bearer token used to look up delegated ZCAP capabilities.");

const zcapActionSchema = z
	.string()
	.min(1, "action is required")
	.refine((value) => value === "*" || value.includes(":") || value.includes("."), "action must be * or namespaced like Stepper:scope or type.action")
	.regex(/^\S+$/, "action must not contain whitespace")
	.describe("Allowed action label such as GraphStepper:read, comment.grant, or Namespace:*.");

const zcapGrantSchema = z.object({
	id: z.string(),
	token: z.string().optional(),
	allowedAction: z.array(zcapActionSchema),
	revoked: z.boolean(),
	created: z.number().optional(),
	expires: z.number().optional(),
	note: z.string().optional(),
	controller: z.string().optional(),
});

const zcapGrantIssuedSchema = z.object({
	token: zcapTokenSchema,
	allowedAction: z.array(zcapActionSchema),
	revoked: z.boolean(),
});

const zcapGrantRevokedSchema = z.object({
	token: zcapTokenSchema,
	revoked: z.number().int().nonnegative(),
});

const zcapGrantsListSchema = z.object({ grants: z.array(zcapGrantSchema) });

/** The inline signed-capability document presented to `as subkey holding capability …`. Must carry a controller and a Data Integrity proof; verification is delegated to the registered IZcapVerifier. */
const signedCapabilitySchema = z.looseObject({
	id: z.string().min(1, "capability id is required"),
	controller: z.string().min(1, "capability controller is required"),
	invocationTarget: z.string().min(1).optional(),
	allowedAction: z.union([zcapActionSchema, z.array(zcapActionSchema)]).optional(),
	parentCapability: z.string().optional(),
	proof: z.looseObject({}),
});

const zcapDomains: TDomainDefinition[] = [
	{
		selectors: [ZCAP_TOKEN_DOMAIN],
		schema: zcapTokenSchema,
		description: "Opaque bearer token used by the ZCAP authority.",
	},
	{
		selectors: [ZCAP_ACTION_DOMAIN],
		schema: zcapActionSchema,
		description: "Namespaced action label authorized by a capability.",
	},
];

class AuthorityStepper extends AStepper implements IHasCycles {
	description = "Manage ZCAP bearer grants for protected step dispatch";

	private authority?: IZcapAuthority;
	private steppers: AStepper[] = [];

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
	}

	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: zcapDomains,
		}),
		startFeature: () => {
			this.authority = new ZcapAuthority();
			(this.getWorld().runtime.keys ??= {})[ZCAP_AUTHORITY] = this.authority;
		},
		endFeature: (endFeature?: TEndFeature) => {
			if (!endFeature?.shouldClose) return Promise.resolve();
			this.authority?.clear();
			delete this.getWorld().runtime.keys?.[ZCAP_AUTHORITY];
			this.authority = undefined;
			return Promise.resolve();
		},
	};

	steps = {
		issueZcapBearerGrant: {
			gwta: `issue zcap bearer grant for token {token: ${ZCAP_TOKEN_DOMAIN}} with action {action: ${ZCAP_ACTION_DOMAIN}}`,
			productsSchema: zcapGrantIssuedSchema,
			action: ({ token, action }: { token: string; action: string }, featureStep: TFeatureStep) => {
				const grant = this.getAuthority().issueBearerGrant({
					token,
					allowedAction: [action],
					controller: `${featureStep.action.stepperName}.${featureStep.action.actionName}`,
					note: featureStep.in,
				});
				return actionOKWithProducts({
					token: grant.token ?? token,
					allowedAction: grant.allowedAction,
					revoked: grant.revoked,
				});
			},
		},
		revokeZcapBearerGrant: {
			gwta: `revoke zcap bearer grant for token {token: ${ZCAP_TOKEN_DOMAIN}}`,
			productsSchema: zcapGrantRevokedSchema,
			action: ({ token }: { token: string }) => {
				const revoked = this.getAuthority().revokeBearerGrant(token);
				if (revoked === 0) {
					return actionNotOK(`No ZCAP bearer grant found for token ${token}`);
				}
				return actionOKWithProducts({ token, revoked });
			},
		},
		showZcapBearerGrants: {
			exact: "show zcap bearer grants",
			productsSchema: zcapGrantsListSchema,
			action: () => {
				const grants = this.getAuthority().listBearerGrants();
				this.getWorld().eventLogger.info(JSON.stringify(grants, null, 2));
				return actionOKWithProducts({ grants });
			},
		},
		issueSubkey: {
			gwta: `issue subkey {subkey: ${ZCAP_TOKEN_DOMAIN}} delegated from site key with action {action: ${ZCAP_ACTION_DOMAIN}}`,
			action: async ({ subkey, action }: { subkey: string; action: string }, featureStep: TFeatureStep) => {
				const world = this.getWorld();
				const sitePrincipal = currentPrincipal(world);
				if (!sitePrincipal) {
					return actionNotOK("no site principal established — cannot delegate a subkey");
				}
				const controller = subkeyDid(sitePrincipal, subkey);
				const grant = this.getAuthority().issueBearerGrant({ token: subkey, allowedAction: [action], controller, note: featureStep.in });
				// Persist the delegation as a Principal individual (public material only; never a private key).
				// Best-effort: persists only once a store carrying the Principal label exists; the runtime grant is independent.
				const now = new Date().toISOString();
				await persistPrincipalIndividual(world, { id: sitePrincipal, controller: sitePrincipal, generatedAtTime: now });
				await persistPrincipalIndividual(world, { id: controller, controller, allowedAction: JSON.stringify([action]), generatedAtTime: now }, sitePrincipal);
				return actionOKWithProducts({ subkey: grant.token ?? subkey, controller, allowedAction: grant.allowedAction });
			},
		},
		asSubkey: {
			gwta: `as subkey {subkey: ${ZCAP_TOKEN_DOMAIN}}, {what: statement}`,
			action: ({ subkey, what }: { subkey: string; what: TFeatureStep[] }, featureStep: TFeatureStep) => this.runUnderToken(subkey, what, featureStep),
		},
		withToken: {
			gwta: `with token {token: ${ZCAP_TOKEN_DOMAIN}}, {what: statement}`,
			action: ({ token, what }: { token: string; what: TFeatureStep[] }, featureStep: TFeatureStep) => this.runUnderToken(token, what, featureStep),
		},
		asSubkeyHoldingCapability: {
			gwta: `as subkey holding capability {cap: ${DOMAIN_JSON}} at {target: ${DOMAIN_STRING}}, {what: statement}`,
			precludes: [`${AuthorityStepper.name}.asSubkey`],
			action: ({ cap, target, what }: { cap: unknown; target: string; what: TFeatureStep[] }, featureStep: TFeatureStep) => this.runUnderCapability(cap, target, what, featureStep),
		},
	};

	/**
	 * Run `what` as the controller of a *signed* capability, after verifying it through the registered IZcapVerifier.
	 * Mirrors the bearer `as subkey` path, but the principal is proven by signature rather than asserted by token.
	 * haibun-core stays crypto-free: verification is delegated; on `ok` the capability's controller becomes the principal.
	 */
	private async runUnderCapability(cap: unknown, target: string, what: TFeatureStep[], featureStep: TFeatureStep) {
		const parsed = signedCapabilitySchema.safeParse(cap);
		if (!parsed.success) {
			return actionNotOK(`as subkey holding capability: invalid signed capability — ${parsed.error.issues.map((i) => i.message).join("; ")}`);
		}
		const capability = parsed.data;
		const actions = capability.allowedAction === undefined ? ["*"] : Array.isArray(capability.allowedAction) ? capability.allowedAction : [capability.allowedAction];
		const expectedAction = actions[0] ?? "*";
		const invocation: TZcapInvocation = {
			capability: capability as unknown as TZcapGrant,
			capabilityAction: expectedAction,
			invocationTarget: target,
			proof: capability.proof,
		};
		const verified = await this.getAuthority().verifySigned(invocation, { action: expectedAction, target, rootCapability: capability.parentCapability });
		if (!verified.ok) {
			return actionNotOK(`as subkey holding capability: signed capability verification failed — ${verified.error ?? "unknown error"}`);
		}
		const runner = new FlowRunner(this.getWorld(), this.steppers);
		const run = () => runner.runSteps(what, { parentStep: featureStep });
		return await withPrincipal(this.getWorld(), capability.controller, run);
	}

	/** Run `what` with the bearer `token` active and the principal set to the token's controller (so authored writes are attributed to it). */
	private async runUnderToken(token: string, what: TFeatureStep[], featureStep: TFeatureStep) {
		const world = this.getWorld();
		const principal = this.getAuthority().resolveController(token) ?? currentPrincipal(world);
		const keys = (world.runtime.keys ??= {});
		const previous = keys[ZCAP_TOKEN_KEY];
		keys[ZCAP_TOKEN_KEY] = token;
		try {
			const runner = new FlowRunner(world, this.steppers);
			const run = () => runner.runSteps(what, { parentStep: featureStep });
			return await (principal ? withPrincipal(world, principal, run) : run());
		} finally {
			if (previous !== undefined) {
				keys[ZCAP_TOKEN_KEY] = previous;
			} else {
				delete keys[ZCAP_TOKEN_KEY];
			}
		}
	}

	private getAuthority(): IZcapAuthority {
		if (!this.authority) {
			throw new Error("AuthorityStepper authority not initialized");
		}
		return this.authority;
	}
}

export default AuthorityStepper;
