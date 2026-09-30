/**
 * Where a signed request carries its HTTP Signature.
 *
 * The HTTP Signatures draft (draft-cavage-http-signatures §4) defines two carriers for one signature: the
 * `Authorization` header under the `Signature` scheme, and the `Signature` header. A request here carries it in
 * `Signature`. `Authorization` then stays with whatever admits a person to the site, such as a proxy's basic auth,
 * which refuses a request whose `Authorization` it doesn't recognize. The signature covers the same fields either way,
 * and it doesn't cover the header that carries it.
 */
type THeaders = Record<string, string | undefined>;

export const SIGNATURE_HEADER = "signature";
const AUTHORIZATION_HEADER = "authorization";
const SIGNATURE_SCHEME = "Signature ";

/** Signed headers as a request sends them: the signature a signing library wrote to `Authorization`, carried in `Signature`. */
export function carriedInSignature(signed: Record<string, string>): Record<string, string> {
	const { [AUTHORIZATION_HEADER]: authorization, ...rest } = signed;
	if (!authorization?.startsWith(SIGNATURE_SCHEME)) throw new Error("the signed headers don't carry a signature under the Signature scheme");
	return { ...rest, [SIGNATURE_HEADER]: authorization.slice(SIGNATURE_SCHEME.length) };
}

/** The signature a request carries, as its parameters, or undefined where it doesn't carry one. */
export function carriedSignature(headers: THeaders): string | undefined {
	return Object.entries(headers).find(([name]) => name.toLowerCase() === SIGNATURE_HEADER)?.[1];
}

/** A request's headers as a verifying library reads them, from `Authorization`: the carried signature in place of whatever
 *  `Authorization` the request arrived with, which was for the proxy. */
export function readFromAuthorization(headers: THeaders): THeaders {
	const signature = carriedSignature(headers);
	const rest = Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== AUTHORIZATION_HEADER && name.toLowerCase() !== SIGNATURE_HEADER));
	return signature === undefined ? rest : { ...rest, [AUTHORIZATION_HEADER]: `${SIGNATURE_SCHEME}${signature}` };
}
