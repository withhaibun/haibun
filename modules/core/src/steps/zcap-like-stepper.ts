import { z } from "zod";
import type { TDomainDefinition } from "../lib/resources.js";
import type { IStepperCycles, TEndFeature, TFeatureStep } from "../lib/execution.js";
import { OK } from "../schema/protocol.js";
import { AStepper, type IHasCycles } from "../lib/astepper.js";
import { actionNotOK, actionOKWithProducts } from "../lib/util/index.js";
import { ZCAP_LIKE_AUTHORITY, ZcapLikeAuthority, type IZcapLikeAuthority } from "../lib/zcap-like-authority.js";

const ZCAP_LIKE_TOKEN_DOMAIN = "zcap-like-token";
const ZCAP_LIKE_CAPABILITY_DOMAIN = "zcap-like-capability";

const zcapLikeTokenSchema = z
	.string()
	.min(1, "token is required")
	.regex(/^\S+$/, "token must not contain whitespace")
	.describe("Opaque bearer token used to look up delegated zcap-like capabilities.");

const zcapLikeCapabilitySchema = z
	.string()
	.min(1, "capability is required")
	.refine((value) => value === "*" || value.includes(":"), "capability must be * or namespaced like Stepper:scope")
	.regex(/^\S+$/, "capability must not contain whitespace")
	.describe("Delegated capability label such as GraphStepper:read or Namespace:*.");

const zcapLikeGrantSchema = z.object({
	token: zcapLikeTokenSchema,
	capability: zcapLikeCapabilitySchema,
	revoked: z.boolean(),
	issuedAt: z.number().optional(),
	revokedAt: z.number().optional(),
	note: z.string().optional(),
	issuer: z.string().optional(),
});

const zcapLikeDomains: TDomainDefinition[] = [
	{
		selectors: [ZCAP_LIKE_TOKEN_DOMAIN],
		schema: zcapLikeTokenSchema,
		description: "Opaque bearer token used by the zcap-like authority.",
	},
	{
		selectors: [ZCAP_LIKE_CAPABILITY_DOMAIN],
		schema: zcapLikeCapabilitySchema,
		description: "Namespaced capability label delegated by the zcap-like authority.",
	},
];

class ZcapLikeStepper extends AStepper implements IHasCycles {
	description = "Manage zcap-like bearer grants for protected step dispatch";

	private authority?: IZcapLikeAuthority;

	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: zcapLikeDomains,
		}),
		startFeature: () => {
			this.authority = new ZcapLikeAuthority();
			this.getWorld().runtime[ZCAP_LIKE_AUTHORITY] = this.authority;
		},
		endFeature: (endFeature?: TEndFeature) => {
			if (!endFeature?.shouldClose) return Promise.resolve();
			this.authority?.clear();
			delete this.getWorld().runtime[ZCAP_LIKE_AUTHORITY];
			this.authority = undefined;
			return Promise.resolve();
		},
	};

	steps = {
		issueZcapLikeBearerGrant: {
			gwta: `issue zcap-like bearer grant for token {token: ${ZCAP_LIKE_TOKEN_DOMAIN}} with capability {capability: ${ZCAP_LIKE_CAPABILITY_DOMAIN}}`,
			outputSchema: z.object({
				token: zcapLikeTokenSchema,
				capability: zcapLikeCapabilitySchema,
				revoked: z.boolean(),
			}),
			action: ({ token, capability }: { token: string; capability: string }, featureStep: TFeatureStep) => {
				const grant = this.getAuthority().issueBearerGrant({
					token,
					capability,
					issuer: `${featureStep.action.stepperName}.${featureStep.action.actionName}`,
					note: featureStep.in,
				});
				return actionOKWithProducts({
					token: grant.token,
					capability: grant.capability,
					revoked: grant.revoked,
				});
			},
		},
		revokeZcapLikeBearerGrant: {
			gwta: `revoke zcap-like bearer grant for token {token: ${ZCAP_LIKE_TOKEN_DOMAIN}}`,
			outputSchema: z.object({
				token: zcapLikeTokenSchema,
				revoked: z.number().int().nonnegative(),
			}),
			action: ({ token }: { token: string }) => {
				const revoked = this.getAuthority().revokeBearerGrant(token);
				if (revoked === 0) {
					return actionNotOK(`No zcap-like bearer grant found for token ${token}`);
				}
				return actionOKWithProducts({ token, revoked });
			},
		},
		showZcapLikeBearerGrants: {
			exact: "show zcap-like bearer grants",
			outputSchema: z.object({ grants: z.array(zcapLikeGrantSchema) }),
			action: () => {
				const grants = this.getAuthority().listBearerGrants();
				this.getWorld().eventLogger.info(JSON.stringify(grants, null, 2));
				return actionOKWithProducts({ grants });
			},
		},
	};

	private getAuthority(): IZcapLikeAuthority {
		if (!this.authority) {
			throw new Error("ZcapLikeStepper authority not initialized");
		}
		return this.authority;
	}
}

export default ZcapLikeStepper;
