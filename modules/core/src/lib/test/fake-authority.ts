/**
 * A stand-in for a consumer's authority at the boundary between processes, for tests of what the framework does with
 * one: an invoker that presents a holder, the action it invokes and a digest of the body, and a verifier that grants a
 * holder the actions it was told to, when the action it invokes is one of them. It proves nothing, so nothing outside a
 * test registers it. Loaded by a launched fixture's config as `@haibun/core/lib/test/fake-authority`.
 */
import { createHash } from "node:crypto";
import { AStepper } from "../astepper.js";
import { OK } from "../../schema/protocol.js";
import { actionNotOK } from "../util/index.js";
import { getAuthority } from "../session-authority.js";
import { actionList } from "../actions.js";
import type { IAuthorityInvoker, IAuthorityVerifier, TAuthorityEvidence, TDelegations, TOutgoingRequest } from "../authority-types.js";

const HOLDER_HEADER = "fake-holder";
const INVOCATION_HEADER = "capability-invocation";

const digestOf = (body: string): string => `SHA-256=${createHash("sha256").update(body).digest("base64")}`;

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

export class FakeVerifier implements IAuthorityVerifier {
	constructor(private readonly grants: Map<string, string[]>) {}

	verify(evidence: TAuthorityEvidence): Promise<{ ok: boolean; error?: string; principal?: string; allowedAction?: string[] }> {
		if (evidence.kind !== "request") return Promise.resolve({ ok: false, error: "the fake authority verifies requests only" });
		const headers = Object.fromEntries(Object.entries(evidence.headers).map(([name, value]) => [name.toLowerCase(), value]));
		const holder = headers[HOLDER_HEADER];
		const action = headers[INVOCATION_HEADER]?.match(/action="([^"]+)"/)?.[1];
		if (!holder || !action) return Promise.resolve({ ok: false, error: "the request presents no holder or no action" });
		if (headers.digest !== (evidence.body === undefined ? undefined : digestOf(evidence.body))) return Promise.resolve({ ok: false, error: "the presented digest is not of this request's body" });
		const granted = this.grants.get(holder);
		if (!granted?.includes(action)) return Promise.resolve({ ok: false, error: `${holder} holds no grant for ${action}` });
		return Promise.resolve({ ok: true, principal: holder, allowedAction: granted });
	}

	delegationsTo(): Promise<TDelegations> {
		// A holder here is granted by name, not by a document it could present.
		return Promise.resolve({ delegations: [] });
	}
}

export default class FakeAuthorityStepper extends AStepper {
	description = "Registers a stand-in authority for tests: a holder this process presents as, and the actions a holder is granted here.";
	private readonly grants = new Map<string, string[]>();

	steps = {
		presentAuthorityAs: {
			gwta: "present authority as {holder}",
			action: ({ holder }: { holder: string }) => this.withAuthority((authority) => authority.registerInvoker(new FakeInvoker(holder))),
		},
		acceptAuthority: {
			gwta: "accept authority from {holder} for {actions}",
			action: ({ holder, actions }: { holder: string; actions: string }) =>
				this.withAuthority((authority) => {
					this.grants.set(holder, actionList(actions));
					authority.registerVerifier(new FakeVerifier(this.grants));
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
