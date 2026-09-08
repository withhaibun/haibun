import { createHash } from "node:crypto";
import { z } from "zod";
import { type TDomainDefinition } from "../lib/resources.js";
import { persistPrincipalIndividual } from "../lib/principal-individual.js";
import { formatSeqPath } from "../lib/seq-path.js";
import type { TWorld } from "../lib/world.js";
import { AStepper, type IHasCycles, type IStepperCycles, type TEndFeature, type TFeatureStep } from "../lib/astepper.js";
import { actionNotOK, actionOKWithProducts } from "../lib/util/index.js";
import { AUTHORITY_KEY, SESSION_TOKEN_KEY, SessionAuthority } from "../lib/session-authority.js";
import type { IAuthority } from "../lib/authority-types.js";
import { DOMAIN_JSON, DOMAIN_STRING } from "../lib/domains.js";
import { FlowRunner } from "../lib/core/flow-runner.js";
import { currentPrincipal, withPrincipal } from "../lib/principal.js";
import { activeSitePrincipal, SITE_DID_PREFIX } from "../lib/host-id.js";
import { PRINCIPAL_DOMAIN, PRINCIPAL_LABEL } from "../lib/resources.js";

const SESSION_TOKEN_DOMAIN = "session-token";
const AUTHORITY_ACTION_DOMAIN = "authority-action";

/** A subkey `s` delegated from site principal `P` is the DID `${P}:${s}` (e.g. did:site:0 + alice → did:site:0:alice). */
function subkeyDid(sitePrincipal: string, subkey: string): string {
	return `${sitePrincipal}:${subkey}`;
}

const sessionTokenSchema = z
	.string()
	.min(1, "token is required")
	.regex(/^\S+$/, "token must not contain whitespace")
	.describe("The token an in-process session presents, which the authority resolves to what that session may do.");

const authorityActionSchema = z
	.string()
	.min(1, "action is required")
	.refine((value) => value === "*" || value.includes(":") || value.includes("."), "action must be * or namespaced like Stepper:scope or type.action")
	.regex(/^\S+$/, "action must not contain whitespace")
	.describe("Allowed action label such as GraphStepper:read, comment.grant, or Namespace:*.");

/** What holding authority over this run's own authority means: revoking what it granted. */
export const AUTHORITY_CAPABILITIES = { revoke: "Authority:revoke" } as const;

const sessionGrantIssuedSchema = z.object({
	token: sessionTokenSchema,
	allowedAction: z.array(authorityActionSchema),
	revoked: z.boolean(),
});

const sessionGrantRevokedSchema = z.object({
	token: sessionTokenSchema,
	revoked: z.number().int().nonnegative(),
});

/**
 * A grant as it may be SHOWN: who holds it, what it allows, and whether it still stands. Never the token, and never
 * the id, which is the token: a bearer token is the credential itself, so a listing carrying one hands it to whoever
 * reads the listing.
 */
export const sessionGrantShownSchema = z.object({
	handle: z.string().describe("A name for this grant that is not its credential — what a reader revokes it by"),
	seqPath: z.string().optional().describe("The step it was granted at, which a reader can open"),
	controller: z.string().optional().describe("The principal the grant is held by, where it names one"),
	allowedAction: z.array(authorityActionSchema).describe("What the holder may do"),
	revoked: z.boolean().describe("Whether it has been revoked"),
	created: z.number().optional().describe("When it was issued, epoch ms"),
	expires: z.number().optional().describe("When it stops holding, epoch ms; absent means it holds while this run does"),
	note: z.string().optional().describe("What it was issued for"),
});
export type TSessionGrantShown = z.infer<typeof sessionGrantShownSchema>;

export const sessionGrantsListSchema = z.object({ grants: z.array(sessionGrantShownSchema) });

/** A grant's name, derived from its token and standing in for it: enough to say which grant is meant, and nothing that
 *  could be presented as one. A digest, so it is the same name every time the same grant is read. */
export function grantHandle(named: string): string {
	return createHash("sha256").update(named).digest("hex").slice(0, 16);
}

/** What may be said about a grant: everything but the credential itself. */
export function shownGrant(grant: {
	id: string;
	token?: string;
	controller?: string;
	allowedAction: string[];
	revoked: boolean;
	created?: number;
	expires?: number;
	note?: string;
	seqPath?: string;
}): TSessionGrantShown {
	return {
		// Named by its token where it has one, else by its id: a grant that arrives signed carries no bearer token, and
		// is still a grant a reader can see and revoke.
		handle: grantHandle(grant.token ?? grant.id),
		...(grant.seqPath === undefined ? {} : { seqPath: grant.seqPath }),
		...(grant.controller === undefined ? {} : { controller: grant.controller }),
		allowedAction: [...grant.allowedAction],
		revoked: grant.revoked,
		...(grant.created === undefined ? {} : { created: grant.created }),
		...(grant.expires === undefined ? {} : { expires: grant.expires }),
		...(grant.note === undefined ? {} : { note: grant.note }),
	};
}

const siteNamedSchema = z.object({ site: z.string() });

/** The inline signed-capability document presented to `as subkey holding capability …`. Must carry a controller and a Data Integrity proof; verification is delegated to the registered IAuthorityVerifier. */
const signedCapabilitySchema = z.looseObject({
	id: z.string().min(1, "capability id is required"),
	controller: z.string().min(1, "capability controller is required"),
	invocationTarget: z.string().min(1).optional(),
	allowedAction: z.union([authorityActionSchema, z.array(authorityActionSchema)]).optional(),
	parentCapability: z.string().optional(),
	proof: z.looseObject({}),
});

const authorityDomains: TDomainDefinition[] = [
	{
		selectors: [SESSION_TOKEN_DOMAIN],
		schema: sessionTokenSchema,
		description: "The token an in-process session presents to act as itself.",
	},
	{
		selectors: [AUTHORITY_ACTION_DOMAIN],
		schema: authorityActionSchema,
		description: "Namespaced action label authorized by a capability.",
	},
];

class AuthorityStepper extends AStepper implements IHasCycles {
	description = "Grant and withdraw what an in-process session may do";

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
			domains: authorityDomains,
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
		issueSessionGrant: {
			gwta: `issue session grant for token {token: ${SESSION_TOKEN_DOMAIN}} with action {action: ${AUTHORITY_ACTION_DOMAIN}}`,
			productsSchema: sessionGrantIssuedSchema,
			action: ({ token, action }: { token: string; action: string }, featureStep: TFeatureStep) => {
				// The controller is the principal issuing the grant — this instance's own — so an act authorized by the
				// token is attributable to an agent. A step name is how it was issued, which the note carries.
				const grant = this.getAuthority().issueSessionGrant({
					token,
					allowedAction: [action],
					controller: activeSitePrincipal(this.getWorld()),
					note: featureStep.in,
					seqPath: formatSeqPath(featureStep.seqPath),
				});
				return actionOKWithProducts({
					token: grant.token ?? token,
					allowedAction: grant.allowedAction,
					revoked: grant.revoked,
				});
			},
		},
		revokeSessionGrant: {
			gwta: `revoke session grant for token {token: ${SESSION_TOKEN_DOMAIN}}`,
			productsSchema: sessionGrantRevokedSchema,
			action: ({ token }: { token: string }) => {
				const revoked = this.getAuthority().revokeSessionGrant(token);
				if (revoked === 0) {
					return actionNotOK(`No session grant found for token ${token}`);
				}
				return actionOKWithProducts({ token, revoked });
			},
		},
		revokeSessionGrantByHandle: {
			gwta: "revoke the session grant named {handle: string}",
			capability: AUTHORITY_CAPABILITIES.revoke,
			description:
				"Revoke a grant by the name a listing gives it, so it can be revoked by whoever can see it without their ever holding the credential itself. Revoking is immediate: the next call under that grant is refused.",
			productsSchema: z.object({ handle: z.string(), revoked: z.number().int().nonnegative() }),
			action: ({ handle }: { handle: string }) => {
				const authority = this.getAuthority();
				const named = authority.listSessionGrants().filter((grant) => grantHandle(grant.token ?? grant.id) === handle);
				if (named.length === 0) return Promise.resolve(actionNotOK(`no grant named ${handle}`));
				const revoked = named.reduce((count, grant) => count + (grant.token ? authority.revokeSessionGrant(grant.token) : 0), 0);
				return Promise.resolve(actionOKWithProducts({ handle, revoked }));
			},
		},
		showSessionGrants: {
			exact: "show session grants",
			description:
				"Who holds authority here and what it allows them: each grant's controller, its allowed actions, whether it still stands, and what it was issued for. The tokens themselves are never reported — a bearer token is the credential, so anything that reports one hands it over.",
			productsSchema: sessionGrantsListSchema,
			action: () => {
				const grants = this.getAuthority().listSessionGrants().map(shownGrant);
				return actionOKWithProducts({ grants });
			},
		},
		issueSubkey: {
			gwta: `issue subkey {subkey: ${SESSION_TOKEN_DOMAIN}} delegated from site key with action {action: ${AUTHORITY_ACTION_DOMAIN}}`,
			action: async ({ subkey, action }: { subkey: string; action: string }, featureStep: TFeatureStep) => {
				const world = this.getWorld();
				const sitePrincipal = currentPrincipal(world);
				if (!sitePrincipal) {
					return actionNotOK("no site principal established — cannot delegate a subkey");
				}
				const controller = subkeyDid(sitePrincipal, subkey);
				const grant = this.getAuthority().issueSessionGrant({ token: subkey, allowedAction: [action], controller, note: featureStep.in });
				// Persist the delegation as a Principal individual (public material only; never a private key).
				// Best-effort: persists only once a store carrying the Principal label exists; the runtime grant is independent.
				const now = new Date().toISOString();
				await persistPrincipalIndividual(world, { id: sitePrincipal, controller: sitePrincipal, generatedAtTime: now });
				await persistPrincipalIndividual(world, { id: controller, controller, allowedAction: JSON.stringify([action]), generatedAtTime: now }, sitePrincipal);
				return actionOKWithProducts({ subkey: grant.token ?? subkey, controller, allowedAction: grant.allowedAction });
			},
		},
		nameConnectingSite: {
			exact: "name a connecting site",
			productsSchema: siteNamedSchema,
			// Site principals must be unique within a federation. A default-identified instance (did:site:0 to itself)
			// asks the site it connects to what it should be called; this end assigns `did:site:<mine>.<n>` — unique
			// under this site's own principal — and durably records the assignment as a Principal individual, so `n`
			// never repeats. Called over RPC by the connecting site (see the federate step's collision handling).
			action: async () => {
				const world = this.getWorld();
				const store = world.shared?.getStore();
				if (!world.domains[PRINCIPAL_DOMAIN] || !store) {
					return actionNotOK("naming a connecting site requires the Principal domain and a store — a namer must durably record the principals it assigns");
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
		asSubkey: {
			gwta: `as subkey {subkey: ${SESSION_TOKEN_DOMAIN}}, {what: statement}`,
			action: ({ subkey, what }: { subkey: string; what: TFeatureStep[] }, featureStep: TFeatureStep) => this.runUnderToken(subkey, what, featureStep),
		},
		withToken: {
			gwta: `with token {token: ${SESSION_TOKEN_DOMAIN}}, {what: statement}`,
			action: ({ token, what }: { token: string; what: TFeatureStep[] }, featureStep: TFeatureStep) => this.runUnderToken(token, what, featureStep),
		},
		asSubkeyHoldingCapability: {
			gwta: `as subkey holding capability {cap: ${DOMAIN_JSON}} at {target: ${DOMAIN_STRING}}, {what: statement}`,
			precludes: [`${AuthorityStepper.name}.asSubkey`],
			action: ({ cap, target, what }: { cap: unknown; target: string; what: TFeatureStep[] }, featureStep: TFeatureStep) => this.runUnderCapability(cap, target, what, featureStep),
		},
	};

	/**
	 * Run `what` as the controller of a *signed* capability, after verifying it through the registered IAuthorityVerifier.
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
		const action = actions[0] ?? "*";
		// The document goes to whoever knows how to read it, with what the caller says it lets them do. Nothing here
		// reads inside it: the framework holds no key and knows no specification.
		const verified = await this.getAuthority().verifyEvidence({ kind: "document", document: capability as Record<string, unknown>, action, target });
		if (!verified.ok) {
			return actionNotOK(`as subkey holding capability: the evidence was refused — ${verified.error ?? "no reason given"}`);
		}
		const runner = new FlowRunner(this.getWorld(), this.steppers);
		const run = () => runner.runSteps(what, { parentStep: featureStep });
		return await withPrincipal(this.getWorld(), verified.principal ?? capability.controller, run);
	}

	/** Run `what` with the bearer `token` active and the principal set to the token's controller (so authored writes are attributed to it). */
	private async runUnderToken(token: string, what: TFeatureStep[], featureStep: TFeatureStep) {
		const world = this.getWorld();
		const principal = this.getAuthority().resolveController(token) ?? currentPrincipal(world);
		const keys = (world.runtime.keys ??= {});
		const previous = keys[SESSION_TOKEN_KEY];
		keys[SESSION_TOKEN_KEY] = token;
		try {
			const runner = new FlowRunner(world, this.steppers);
			const run = () => runner.runSteps(what, { parentStep: featureStep });
			return await (principal ? withPrincipal(world, principal, run) : run());
		} finally {
			if (previous !== undefined) {
				keys[SESSION_TOKEN_KEY] = previous;
			} else {
				delete keys[SESSION_TOKEN_KEY];
			}
		}
	}

	private getAuthority(): IAuthority {
		if (!this.authority) {
			throw new Error("AuthorityStepper authority not initialized");
		}
		return this.authority;
	}
}

export default AuthorityStepper;
