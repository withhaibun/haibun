/**
 * SessionAuthority: the run's one capability authority. It holds what a consumer registers for the specification its
 * deployment uses: a verifier for evidence presented to this run, and an invoker for authority this run presents
 * elsewhere. haibun-core stays crypto-free, so it reads no proof and signs nothing itself.
 */
import type { TRuntime } from "./world.js";
import { runReadingAsTheInstance } from "./capability-context.js";
import type {
	IAuthority,
	IAuthorityInvoker,
	IAuthorityVerifier,
	TAuthorityEvidence,
	TDelegations,
	TOutgoingRequest,
	TRequestSigner,
	TRestsOn,
	TVerdict,
} from "./authority-types.js";

export const AUTHORITY_KEY = "authority";

/** The longest delay a timer takes; a longer one fires at once. */
const LONGEST_TIMER_MS = 2 ** 31 - 1;

export class SessionAuthority implements IAuthority {
	private verifier?: IAuthorityVerifier;
	private invoker?: IAuthorityInvoker;
	/** The held calls resting on each capability, by its id. */
	private held = new Map<string, Set<AbortController>>();

	registerVerifier(verifier: IAuthorityVerifier): void {
		this.verifier = verifier;
	}

	hasVerifier(): boolean {
		return this.verifier !== undefined;
	}

	delegationsTo(controller: string): Promise<TDelegations> {
		// Nothing registered to verify a delegation means nothing here was delegated through one.
		const verifier = this.verifier;
		return verifier ? runReadingAsTheInstance(() => verifier.delegationsTo(controller)) : Promise.resolve({ delegations: [] });
	}

	registerInvoker(invoker: IAuthorityInvoker): void {
		this.invoker = invoker;
	}

	signRequest(request: TOutgoingRequest, action: string): Promise<Record<string, string>> {
		if (!this.invoker) throw new Error(`nothing is registered to sign a request, so this process can't invoke ${action} at ${request.url}`);
		return this.invoker.sign(request, action);
	}

	verifyEvidence(evidence: TAuthorityEvidence): Promise<TVerdict> {
		const verifier = this.verifier;
		if (!verifier) return Promise.resolve({ ok: false, error: "no verifier is registered to decide this evidence" });
		// A chain is checked against the instance's own records, whatever the call presenting it may read.
		return runReadingAsTheInstance(() => verifier.verify(evidence));
	}

	revoked(capabilityId: string): void {
		for (const call of this.held.get(capabilityId) ?? []) call.abort(`${capabilityId} was revoked`);
	}

	holdWhile({ capabilities, expires }: TRestsOn): { signal: AbortSignal; release(): void } {
		const call = new AbortController();
		for (const id of capabilities) this.held.set(id, (this.held.get(id) ?? new Set()).add(call));
		let timer: ReturnType<typeof setTimeout> | undefined;
		const until = expires === undefined ? undefined : Date.parse(expires);
		if (Number.isNaN(until)) throw new Error(`a held call rests on authority whose expiry, ${expires}, is not a time`);
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

/** How a client in this process signs what it invokes elsewhere: through whatever invoker the run's authority holds when
 *  the call is made, so a client made before the invoker was registered still signs with it. */
export function requestSigner(runtime: TRuntime): TRequestSigner {
	return (request, action) => {
		const authority = getAuthority(runtime);
		if (!authority) throw new Error(`this process holds no authority, so it can't invoke ${action} at ${request.url}`);
		return authority.signRequest(request, action);
	};
}
