/**
 * SessionAuthority: the run's one capability authority. It holds what a consumer registers for the specification its
 * deployment uses: a verifier for evidence presented to this run, an issuer, and an invoker for authority this run
 * presents elsewhere. haibun-core stays crypto-free, so it reads no proof and signs nothing itself.
 */
import type { TRuntime } from "./world.js";
import type {
	IAuthority,
	IAuthorityInvoker,
	IAuthorityIssuer,
	IAuthorityVerifier,
	TAuthorityEvidence,
	TCredentialRequest,
	TIssuedCredential,
	TOutgoingRequest,
	TRequestSigner,
} from "./authority-types.js";

export const AUTHORITY_KEY = "authority";

export class SessionAuthority implements IAuthority {
	private verifier?: IAuthorityVerifier;
	private issuer?: IAuthorityIssuer;
	private invoker?: IAuthorityInvoker;

	registerVerifier(verifier: IAuthorityVerifier): void {
		this.verifier = verifier;
	}

	hasVerifier(): boolean {
		return this.verifier !== undefined;
	}

	registerIssuer(issuer: IAuthorityIssuer): void {
		this.issuer = issuer;
	}

	issueCredential(request: TCredentialRequest): Promise<TIssuedCredential> {
		if (!this.issuer) throw new Error("nothing is registered to issue a credential, so this deployment cannot give a holder authority it can prove");
		return this.issuer.issue(request);
	}

	registerInvoker(invoker: IAuthorityInvoker): void {
		this.invoker = invoker;
	}

	signRequest(request: TOutgoingRequest, action: string): Promise<Record<string, string>> {
		if (!this.invoker) throw new Error(`nothing is registered to sign a request, so this process can't invoke ${action} at ${request.url}`);
		return this.invoker.sign(request, action);
	}

	verifyEvidence(evidence: TAuthorityEvidence): Promise<{ ok: boolean; error?: string; principal?: string; allowedAction?: string[] }> {
		if (!this.verifier) return Promise.resolve({ ok: false, error: "no verifier is registered to decide this evidence" });
		return this.verifier.verify(evidence);
	}

	clear(): void {
		this.verifier = undefined;
		this.issuer = undefined;
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
