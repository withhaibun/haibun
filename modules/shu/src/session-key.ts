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
import { pagePinned } from "./page-pinned.js";
import { sessionCredentialSchema } from "./session-schema.js";

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
	/** Where the deployment recorded what it issued, when it keeps a record: a view shows what a reader holds as that
	 *  record, so an action leads to what granted it rather than being a word on a page. */
	record?: { persistedAs: string; id: string };
};

type THeld = { session: TSession; sign(options: { data: Uint8Array }): Promise<Uint8Array> };

// A reader is one reader across every bundle of its page, so what it holds is the page's, and so is the opening of it:
// a bundle that signs a request waits on the same opening the app started rather than starting one of its own.
const SESSION_KEY = "__SHU_READER_SESSION__";
const pinned = (): { held?: THeld; opening?: Promise<TSession | undefined> } => pagePinned(SESSION_KEY, () => ({}));

/**
 * The key this page signs with, made here and kept here: its private half is not readable material and never leaves
 * the browser's key store, so what a reader sends is a signature rather than anything that could be taken and reused.
 * Only the public half is presented, as a JSON Web Key; how a credential names that key is the deployment's own
 * business, which is why this asks rather than encoding one.
 */
export async function pageKey(): Promise<{ publicKey: JsonWebKey; sign: THeld["sign"] }> {
	// A browser gives a page its key store only in a secure context: over https, or from localhost. Served otherwise
	// there is no key for a reader to control and nothing it could prove, which is a fact about how the deployment is
	// reached rather than a fault in the page, so it is said as that.
	if (!globalThis.crypto?.subtle) {
		throw new Error(
			`a reader can only make a key it controls in a secure context (https, or localhost); this page was served from ${globalThis.location?.origin ?? "an origin"}, where the browser withholds its key store`,
		);
	}
	const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
	const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
	const sign = async ({ data }: { data: Uint8Array }): Promise<Uint8Array> =>
		new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, data as unknown as BufferSource));
	return { publicKey, sign };
}

/**
 * Ask the deployment for what this reader may act under, presenting the public half of the key the page controls.
 * `issue` is the call that reaches the deployment's own issuing step, so this module assumes nothing about how that
 * step is named or what form the credential takes. A deployment that declares nothing has answered: the page holds
 * nothing and signs nothing. An answer that declares actions but arrives without the credential to act under them is
 * a fault in the deployment's issuing, and is said here, where it happened, rather than surfacing later as
 * unexplained refusals of everything the reader was told it may do.
 */
export function openSession(issue: (holderKey: JsonWebKey) => Promise<unknown>): Promise<TSession | undefined> {
	const opening = open(issue);
	pinned().opening = opening;
	return opening;
}

/**
 * Wait for the opening the page started, for a caller that is about to act under what it holds. A page that never
 * opened one has nothing to wait for. An opening that failed fails here, at the request that needed it, rather than
 * as a reader silently able to do nothing.
 */
export async function sessionReady(): Promise<void> {
	await pinned().opening;
}

async function open(issue: (holderKey: JsonWebKey) => Promise<unknown>): Promise<TSession | undefined> {
	const { publicKey, sign } = await pageKey();
	const issued = sessionCredentialSchema.parse(await issue(publicKey));
	if (issued.allowedAction.length === 0) return undefined;
	const { keyId, credential, expires, allowedAction, record } = issued;
	if (!credential || !keyId || !expires) {
		const missing = [!credential && "credential", !keyId && "keyId", !expires && "expires"].filter(Boolean).join(", ");
		throw new Error(`open session: the deployment declared ${allowedAction.join(", ")} but issued no ${missing} to act under`);
	}
	pinned().held = { session: { keyId, credential, allowedAction, expires, record }, sign };
	return session();
}

/** What this reader holds, for a view that shows what it may do. Undefined where the deployment gave it nothing. */
export function session(): TSession | undefined {
	return pinned().held?.session;
}

/** Forget what this reader holds, which is what closing a session means: the key goes with it, and so does the
 *  opening it came from, so nothing waits on a session this reader no longer has. */
export function closeSession(): void {
	pinned().held = undefined;
	pinned().opening = undefined;
}

/**
 * The headers that prove this reader is asking for this, of this. The signature covers the address, the method and the
 * body, so what is proven is the request rather than the holder's possession of anything.
 */
export async function signedHeaders(request: {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string;
	action: string;
}): Promise<Record<string, string> | undefined> {
	const held = pinned().held;
	if (!held) return undefined;
	return await signCapabilityInvocation({
		url: request.url,
		method: request.method,
		headers: request.headers,
		body: request.body,
		capability: held.session.credential,
		capabilityAction: request.action,
		invocationSigner: { id: held.session.keyId, sign: held.sign },
	});
}
