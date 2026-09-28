/**
 * A stand-in for a consumer's authority at the boundary between processes, for tests of what the framework does with
 * one: an invoker that presents a holder, the action it invokes and a digest of the body, and a verifier that grants a
 * holder the actions it was told to, when they allow the action it invokes, as core reads what an action allows. Each
 * holder's grant is one capability, which what it allows rests on, and withdrawing it is reported as its revocation. It
 * doesn't prove an identity, so code outside a test doesn't register it. Loaded by a launched fixture's config as
 * `@haibun/core/lib/test/fake-authority`.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { AStepper, type IStepperCycles } from "../astepper.js";
import { DOMAIN_ACTIONS } from "../domains.js";
import type { TDomainDefinition } from "../resources.js";
import { OK } from "../../schema/protocol.js";
import { actionNotOK } from "../util/index.js";
import { getAuthority } from "../session-authority.js";
import { capabilityAllows } from "../actions.js";
import type { IAuthorityInvoker, IAuthorityVerifier, TAuthorityAct, TAuthorityEvidence, TDelegations, TOutgoingRequest, TVerdict } from "../authority-types.js";

const HOLDER_HEADER = "fake-holder";
/** The name the stand-in authority presents an invocation as and grants actions to. */
export const DOMAIN_FAKE_HOLDER = "fake-authority-holder";
/** The holder domain's definition, which a fixture taking a holder registers beside the stepper. */
export const FAKE_HOLDER_DOMAIN: TDomainDefinition = {
	selectors: [DOMAIN_FAKE_HOLDER],
	schema: z.string().min(1),
	description: "The name the stand-in authority presents an invocation as and grants actions to.",
};
const INVOCATION_HEADER = "capability-invocation";

const digestOf = (body: string): string => `SHA-256=${createHash("sha256").update(body).digest("base64")}`;

/** The capability a holder's grant is. */
export const fakeGrant = (holder: string): string => `urn:fake-grant:${holder}`;

export class FakeInvoker implements IAuthorityInvoker {
	constructor(private readonly holder: string) {}

	sign = (request: TOutgoingRequest, action: string): Promise<Record<string, string>> =>
		Promise.resolve({
			...request.headers,
			[INVOCATION_HEADER]: `fake action="${action}"`,
			[HOLDER_HEADER]: this.holder,
			...(request.body === undefined ? {} : { digest: digestOf(request.body) }),
		});
}

class FakeVerifier implements IAuthorityVerifier {
	constructor(private readonly grants: Map<string, string[]>) {}

	verify(evidence: TAuthorityEvidence): Promise<TVerdict> {
		if (evidence.kind !== "request") return Promise.resolve({ ok: false, error: "the fake authority verifies requests only" });
		const headers = Object.fromEntries(Object.entries(evidence.headers).map(([name, value]) => [name.toLowerCase(), value]));
		const holder = headers[HOLDER_HEADER];
		const action = headers[INVOCATION_HEADER]?.match(/action="([^"]+)"/)?.[1];
		if (!holder || !action) return Promise.resolve({ ok: false, error: "the request presents no holder or no action" });
		if (headers.digest !== (evidence.body === undefined ? undefined : digestOf(evidence.body)))
			return Promise.resolve({ ok: false, error: "the presented digest is not of this request's body" });
		const granted = this.grants.get(holder);
		if (!capabilityAllows(granted, action)) return Promise.resolve({ ok: false, error: `${holder} holds no grant for ${action}` });
		return Promise.resolve({ ok: true, principal: holder, allowedAction: granted, restsOn: { capabilities: [fakeGrant(holder)] } });
	}

	delegationsTo(): Promise<TDelegations> {
		// A holder here is granted by name, not by a document it could present.
		return Promise.resolve({ delegations: [] });
	}

	record(): Promise<TAuthorityAct> {
		return Promise.resolve({ ok: false, error: "the fake authority grants by name, and records no delegation document" });
	}

	revoke(): Promise<TAuthorityAct> {
		return Promise.resolve({ ok: false, error: "the fake authority's grants are withdrawn with `withdraw authority from {holder}`" });
	}
}

export default class FakeAuthorityStepper extends AStepper {
	description = "Registers a stand-in authority for tests: a holder this process presents as, and the actions a holder is granted here.";
	private readonly grants = new Map<string, string[]>();

	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [FAKE_HOLDER_DOMAIN],
		}),
	};

	steps = {
		presentAuthorityAs: {
			gwta: `present authority as {holder: ${DOMAIN_FAKE_HOLDER}}`,
			action: ({ holder }: { holder: string }) => this.withAuthority((authority) => authority.registerInvoker(new FakeInvoker(holder))),
		},
		acceptAuthority: {
			gwta: `accept authority from {holder: ${DOMAIN_FAKE_HOLDER}} for {actions: ${DOMAIN_ACTIONS}}`,
			action: ({ holder, actions }: { holder: string; actions: string[] }) =>
				this.withAuthority((authority) => {
					this.grants.set(holder, actions);
					authority.registerVerifier(new FakeVerifier(this.grants));
				}),
		},
		withdrawAuthority: {
			gwta: `withdraw authority from {holder: ${DOMAIN_FAKE_HOLDER}}`,
			action: ({ holder }: { holder: string }) =>
				this.withAuthority((authority) => {
					this.grants.delete(holder);
					authority.revoked(fakeGrant(holder));
				}),
		},
	};

	private withAuthority(register: (authority: NonNullable<ReturnType<typeof getAuthority>>) => void) {
		const authority = getAuthority(this.getWorld().runtime);
		if (!authority) return Promise.resolve(actionNotOK("this run holds no authority to register a stand-in with"));
		register(authority);
		return Promise.resolve(OK);
	}
}
