/// <reference path="../../../base58-universal.d.ts" />
/** Names a P-256 public key as a did:key, which a holder delegates to, and the verification method its signatures name. */
import { encode } from "base58-universal";
import { itemAt } from "@haibun/core/lib/util/item-at.js";

/** The multicodec prefix of a P-256 public key, as a did:key names one: 0x1200 as an unsigned varint. */
const P256_PUBLIC = [0x80, 0x24];

/** Returns the did:key of a P-256 public key, and the verification method its signatures are made as. */
export function didKeyOf(jwk: JsonWebKey): { controller: string; keyId: string } {
	const fingerprint = `z${encode(new Uint8Array([...P256_PUBLIC, ...compressedPoint(jwk)]))}`;
	const controller = `did:key:${fingerprint}`;
	return { controller, keyId: `${controller}#${fingerprint}` };
}

/** Returns a P-256 public key as its compressed point: the parity of y, then x. */
function compressedPoint(jwk: JsonWebKey): Uint8Array {
	if (jwk.x === undefined || jwk.y === undefined) throw new Error("the page's public key doesn't state the coordinates that name it");
	const bytes = (b64url: string) => Uint8Array.from(atob(b64url.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
	const y = bytes(jwk.y);
	return new Uint8Array([itemAt(y, y.length - 1) & 1 ? 0x03 : 0x02, ...bytes(jwk.x)]);
}
