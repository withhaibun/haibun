/**
 * SessionAuthority is actuality's one capability authority. It holds the verifier and the invoker that a consumer
 * registers for the specification its deployment uses. The verifier verifies evidence presented to actuality. The
 * invoker signs each request in which actuality presents its authority to another host. haibun-core doesn't contain
 * cryptography, so it doesn't read a proof or sign a request itself.
 */
import type { TRuntime } from "./actuality/domains/world.js";
import { actingFor, runReadingAsTheInstance } from "./capability-context.js";
import type {
	IAuthority,
	IAuthorityInvoker,
	IAuthorityVerifier,
	TActingFor,
	TAuthorityAct,
	TAuthorityEvidence,
	TDelegations,
	THeldCalls,
	TOutgoingRequest,
	TRequestSigner,
	TRestsOn,
	TVerdict,
} from "./authority-types.js";

export const AUTHORITY_KEY = "authority";

/** The longest delay setTimeout accepts. A longer delay fires at once. */
const LONGEST_TIMER_MS = 2 ** 31 - 1;

export class SessionAuthority implements IAuthority {
	private verifier?: IAuthorityVerifier;
	private invoker?: IAuthorityInvoker;
	/** The held calls that rest on each capability, keyed by the capability's id. */
	private held = new Map<string, Set<AbortController>>();

	registerVerifier(verifier: IAuthorityVerifier): void {
		this.verifier = verifier;
	}

	hasVerifier(): boolean {
		return this.verifier !== undefined;
	}

	delegationsTo(controller: string): Promise<TDelegations> {
		// The list of delegations is empty where a verifier isn't registered, since this process doesn't delegate without one.
		const verifier = this.verifier;
		return verifier ? runReadingAsTheInstance(() => verifier.delegationsTo(controller)) : Promise.resolve({ delegations: [] });
	}

	registerInvoker(invoker: IAuthorityInvoker): void {
		this.invoker = invoker;
	}

	signRequest(request: TOutgoingRequest, action: string): Promise<Record<string, string>> {
		if (!this.invoker) throw new Error(`a signer isn't registered, so this process can't invoke ${action} at ${request.url}`);
		return this.invoker.sign(request, action);
	}

	verifyEvidence(evidence: TAuthorityEvidence): Promise<TVerdict> {
		const verifier = this.verifier;
		if (!verifier) return Promise.resolve({ ok: false, error: "a verifier isn't registered to verify this evidence" });
		// The verifier checks a chain against the instance's records without the read ceiling of the presenting call.
		return runReadingAsTheInstance(() => verifier.verify(evidence));
	}

	recordDelegation(document: Record<string, unknown>): Promise<TAuthorityAct> {
		return this.act((verifier, by) => verifier.record(document, by));
	}

	revoke(capabilityId: string): Promise<TAuthorityAct> {
		return this.act((verifier, by) => verifier.revoke(capabilityId, by));
	}

	/** Runs an act of the authority for the principal that `actingFor` returns. The act reads the instance's records
	 *  without the read ceiling of the call. */
	private act(done: (verifier: IAuthorityVerifier, by: TActingFor) => Promise<TAuthorityAct>): Promise<TAuthorityAct> {
		const verifier = this.verifier;
		if (!verifier) return Promise.resolve({ ok: false, error: "a verifier isn't registered to record or revoke a delegation" });
		const by = actingFor();
		if (!by) return Promise.resolve({ ok: false, error: "a caller that didn't prove a key and holds less than every action doesn't record or revoke a delegation" });
		return runReadingAsTheInstance(() => done(verifier, by));
	}

	heldCalls(): THeldCalls {
		return { capabilities: [...this.held].map(([capability, calls]) => ({ capability, calls: calls.size })) };
	}

	revoked(capabilityId: string): void {
		const calls = this.held.get(capabilityId);
		if (calls !== undefined) for (const call of calls) call.abort(`${capabilityId} was revoked`);
	}

	holdWhile({ capabilities, expires }: TRestsOn): { signal: AbortSignal; release(): void } {
		const call = new AbortController();
		for (const id of capabilities) {
			const calls = this.held.get(id);
			if (calls === undefined) this.held.set(id, new Set([call]));
			else calls.add(call);
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		const until = expires === undefined ? undefined : Date.parse(expires);
		if (Number.isNaN(until)) throw new Error(`a held call rests on authority with an expiry that isn't a time: ${expires}`);
		const expiring = () => {
			const left = (until as number) - Date.now();
			if (left <= 0) call.abort(`the authority it rests on expired at ${expires}`);
			else timer = setTimeout(expiring, Math.min(left, LONGEST_TIMER_MS));
		};
		if (until !== undefined) expiring();
		const release = () => {
			clearTimeout(timer);
			for (const id of capabilities) {
				const calls = this.held.get(id);
				calls?.delete(call);
				if (calls?.size === 0) this.held.delete(id);
			}
		};
		call.signal.addEventListener("abort", release, { once: true });
		return { signal: call.signal, release };
	}

	clear(): void {
		this.verifier = undefined;
		this.invoker = undefined;
	}
}

export function getAuthority(runtime: TRuntime): IAuthority | undefined {
	return runtime.keys?.[AUTHORITY_KEY] as IAuthority | undefined;
}

/** Returns actuality's authority. Throws where actuality doesn't hold one, and the error names `need` as the operation
 *  that requires it. */
export function heldAuthority(runtime: TRuntime, need: string): IAuthority {
	const authority = getAuthority(runtime);
	if (!authority) throw new Error(`actuality doesn't hold an authority, which ${need} requires`);
	return authority;
}

/** Returns the signer a client in this process uses for its requests to other hosts. The signer reads actuality's
 *  authority at each call, so a client created before the invoker's registration still signs with that invoker. */
export function requestSigner(runtime: TRuntime): TRequestSigner {
	return (request, action) => heldAuthority(runtime, `invoking ${action} at ${request.url}`).signRequest(request, action);
}
