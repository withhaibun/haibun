import { z } from "zod";
import type { TDomainDefinition } from "../lib/resources.js";
import type { TWorld } from "../lib/world.js";
import { AStepper, type IHasCycles, type IStepperCycles, type TEndFeature, type TFeatureStep } from "../lib/astepper.js";
import { actionNotOK, actionOKWithProducts } from "../lib/util/index.js";
import { ZCAP_AUTHORITY, ZCAP_TOKEN_KEY, ZcapAuthority } from "../lib/zcap-authority.js";
import type { IZcapAuthority } from "../lib/zcap-types.js";
import { FlowRunner } from "../lib/core/flow-runner.js";

const ZCAP_TOKEN_DOMAIN = "zcap-token";
const ZCAP_ACTION_DOMAIN = "zcap-action";

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

class ZcapStepper extends AStepper implements IHasCycles {
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
			this.getWorld().runtime[ZCAP_AUTHORITY] = this.authority;
		},
		endFeature: (endFeature?: TEndFeature) => {
			if (!endFeature?.shouldClose) return Promise.resolve();
			this.authority?.clear();
			delete this.getWorld().runtime[ZCAP_AUTHORITY];
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
		withToken: {
			gwta: `with token {token: ${ZCAP_TOKEN_DOMAIN}}, {what: statement}`,
			action: async ({ token, what }: { token: string; what: TFeatureStep[] }, featureStep: TFeatureStep) => {
				const world = this.getWorld();
				const previous = world.runtime[ZCAP_TOKEN_KEY];
				world.runtime[ZCAP_TOKEN_KEY] = token;
				try {
					const runner = new FlowRunner(world, this.steppers);
					return await runner.runSteps(what, { parentStep: featureStep });
				} finally {
					if (previous !== undefined) {
						world.runtime[ZCAP_TOKEN_KEY] = previous;
					} else {
						delete world.runtime[ZCAP_TOKEN_KEY];
					}
				}
			},
		},
	};

	private getAuthority(): IZcapAuthority {
		if (!this.authority) {
			throw new Error("ZcapStepper authority not initialized");
		}
		return this.authority;
	}
}

export default ZcapStepper;
