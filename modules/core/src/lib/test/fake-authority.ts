/**
 * Implements a stand-in for a consumer's authority across a process boundary. Tests of how the framework calls an
 * authority use it. Its invoker signs a request with headers that present a holder and the invoked action. A further
 * header presents the body's digest where the request has a body. Its verifier rejects a request whose digest doesn't
 * match its body. It accepts the request when the actions a test granted the holder allow the invoked action. Core's
 * `capabilityAllows` determines whether a granted action allows the invoked one. Each holder's grant is one capability.
 * A verdict's `restsOn` names that capability. Withdrawing a grant reports that capability as revoked. The stand-in
 * doesn't prove an identity, so code outside a test doesn't register it. A launched fixture's config loads it as
 * `@haibun/core/lib/test/fake-authority`.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { AStepper, type IStepperCycles } from "../steps/domains/stepper.js";
import { DOMAIN_ACTIONS } from "../domains/domains.js";
import type { TDomainDefinition } from "../domains/resources.js";
import { OK } from "../domains/protocol.js";
import { getAuthority, heldAuthority } from "../domains/session-authority.js";
import { capabilityAllows } from "../domains/actions.js";
import type { IAuthorityInvoker, IAuthorityVerifier, TAuthorityAct, TAuthorityEvidence, TDelegations, TOutgoingRequest, TVerdict } from "../domains/authority-types.js";

const HOLDER_HEADER = "fake-holder";
/** The domain of a holder's name. The stand-in invoker presents the name on each request it signs, and a test grants actions to it. */
export const DOMAIN_FAKE_HOLDER = "fake-authority-holder";
/** The holder domain's definition. The fake authority stepper declares it, and `testDomainDefinitions` contains it for test steppers whose steps take a holder. */
export const FAKE_HOLDER_DOMAIN: TDomainDefinition = {
	selectors: [DOMAIN_FAKE_HOLDER],
	schema: z.string().min(1),
	description: "A holder's name. The stand-in invoker presents it on each request it signs, and a test grants actions to it.",
};
const INVOCATION_HEADER = "capability-invocation";

const digestOf = (body: string): string => `SHA-256=${createHash("sha256").update(body).digest("base64")}`;

/** Returns the capability id of a holder's grant. */
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
		if (!holder || !action) return Promise.resolve({ ok: false, error: "the request doesn't present both a holder and an action" });
		if (headers.digest !== (evidence.body === undefined ? undefined : digestOf(evidence.body)))
			return Promise.resolve({ ok: false, error: "the presented digest is not of this request's body" });
		const granted = this.grants.get(holder);
		if (!capabilityAllows(granted, action)) return Promise.resolve({ ok: false, error: `${holder} doesn't hold a grant for ${action}` });
		return Promise.resolve({ ok: true, principal: holder, allowedAction: granted, invoked: action, restsOn: { capabilities: [fakeGrant(holder)] } });
	}

	delegationsTo(): Promise<TDelegations> {
		// The fake authority grants by name, so a holder doesn't hold a delegation document.
		return Promise.resolve({ delegations: [] });
	}

	record(): Promise<TAuthorityAct> {
		return Promise.resolve({ ok: false, error: "the fake authority doesn't record a delegation document because it grants by name" });
	}

	revoke(): Promise<TAuthorityAct> {
		return Promise.resolve({ ok: false, error: "the fake authority doesn't revoke a capability: withdraw a grant with `withdraw authority from {holder}`" });
	}
}

/** Returns a verifier built from the methods a test supplies. `verify` is required. `delegationsTo` defaults to an empty
 *  list. `record` and `revoke` default to a refusal. */
export const stubVerifier = (stated: Pick<IAuthorityVerifier, "verify"> & Partial<IAuthorityVerifier>): IAuthorityVerifier => ({
	delegationsTo: () => Promise.resolve({ delegations: [] }),
	record: () => Promise.resolve({ ok: false, error: "the stub verifier doesn't record a delegation" }),
	revoke: () => Promise.resolve({ ok: false, error: "the stub verifier doesn't revoke a capability" }),
	...stated,
});

export default class FakeAuthorityStepper extends AStepper {
	description = "Registers a stand-in authority for tests. Its steps set the holder that this process's requests present, grant actions to a holder and withdraw a holder's grant.";
	private readonly grants = new Map<string, string[]>();

	cycles: IStepperCycles = { getConcerns: () => ({ domains: [FAKE_HOLDER_DOMAIN] }) };

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
		register(heldAuthority(this.getWorld().runtime, "registering a stand-in"));
		return Promise.resolve(OK);
	}
}
