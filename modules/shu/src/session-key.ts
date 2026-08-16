/**
 * The key a reader's page controls, and the credential it acts under.
 *
 * The page makes its own key pair, whose private half is never readable material and never leaves the browser's key
 * store, and presents only the public half. What it gets back is a credential naming that key, which it proves control
 * of by signing each request it makes. No secret is transmitted, none is stored, and a credential taken from the page
 * is worth nothing to whoever took it: they cannot sign with a key they do not hold.
 *
 * The credential's form belongs to the deployment's own authority specification. What this module knows is that a
 * reader presents a key, receives something to act with, and signs what it asks.
 */
import { signCapabilityInvocation } from "@digitalbazaar/http-signature-zcap-invoke";

/** What a reader holds while its page is open: the key it signs with, and what the deployment gave it to act under. */
export type TSession = {
	/** The identifier the credential names this reader's key by, which its signatures are made as. */
	keyId: string;
	/** The credential the reader presents, in whatever form the deployment's authority issues. */
	credential: Record<string, unknown>;
	/** What it allows, which is what a view reads to know what a reader may do. */
	allowedAction: string[];
	/** When it stops holding. */
	expires: string;
};

type THeld = TSession & { sign(options: { data: Uint8Array }): Promise<Uint8Array> };

// A page is more than one bundle — the app, a panel a deployment adds — and a reader is one reader across all of them.
// The session is pinned to the page rather than held per bundle, so what a panel may do is what the app was given.
const SESSION_KEY = "__SHU_READER_SESSION__";
const pinned = (): { held?: THeld } => {
	const g = globalThis as unknown as Record<string, { held?: THeld } | undefined>;
	const existing = g[SESSION_KEY];
	if (existing) return existing;
	const fresh: { held?: THeld } = {};
	g[SESSION_KEY] = fresh;
	return fresh;
};

/**
 * The key this page signs with, made here and kept here: its private half is not readable material and never leaves
 * the browser's key store, so what a reader sends is a signature rather than anything that could be taken and reused.
 * Only the public half is presented, as a JSON Web Key; how a credential names that key is the deployment's own
 * business, which is why this asks rather than encoding one.
 */
async function pageKey(): Promise<{ publicKey: JsonWebKey; sign: THeld["sign"] }> {
	const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
	const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
	const sign = async ({ data }: { data: Uint8Array }): Promise<Uint8Array> =>
		new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, data as unknown as BufferSource));
	return { publicKey, sign };
}

/**
 * Ask the deployment for what this reader may act under, presenting the public half of the key the page controls.
 * `issue` is the call that reaches the deployment's own issuing step, so this module assumes nothing about how that
 * step is named or what form the credential takes.
 */
export async function openSession(issue: (holderKey: JsonWebKey) => Promise<Partial<TSession> & { allowedAction: string[] }>): Promise<TSession | undefined> {
	const { publicKey, sign } = await pageKey();
	const issued = await issue(publicKey);
	// A deployment that gives a reader nothing has answered: the page holds nothing and signs nothing, and its key is
	// of no use to it, so it is not kept.
	if (!issued.credential || !issued.keyId || !issued.expires) return undefined;
	pinned().held = { keyId: issued.keyId, credential: issued.credential, allowedAction: issued.allowedAction, expires: issued.expires, sign };
	return session();
}

/** What this reader holds, for a view that shows what it may do. Undefined where the deployment gave it nothing. */
export function session(): TSession | undefined {
	const held = pinned().held;
	return held ? { keyId: held.keyId, credential: held.credential, allowedAction: held.allowedAction, expires: held.expires } : undefined;
}

/** Forget what this reader holds, which is what closing a session means: the key goes with it. */
export function closeSession(): void {
	pinned().held = undefined;
}

/**
 * The headers that prove this reader is asking for this, of this. The signature covers the address, the method and the
 * body, so what is proven is the request rather than the holder's possession of anything.
 */
export async function signedHeaders(request: { url: string; method: string; headers: Record<string, string>; json: unknown; action: string }): Promise<Record<string, string> | undefined> {
	const held = pinned().held;
	if (!held) return undefined;
	return await signCapabilityInvocation({
		url: request.url,
		method: request.method,
		headers: request.headers,
		json: request.json,
		capability: held.credential,
		capabilityAction: request.action,
		invocationSigner: { id: held.keyId, sign: held.sign },
	});
}
