/** An unpacked extension's id, as Chromium derives it from the public key its manifest pins. */
import { createHash } from "node:crypto";

/** The letter Chromium writes for the hex digit 0; each later digit is the next letter. */
const LETTER_A = 97;
const ID_DIGITS = 32;

/** The first 32 hex digits of the key's SHA-256, each written as a letter from a to p. */
export function extensionIdOf(key: string): string {
	const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, ID_DIGITS);
	return [...hex].map((digit) => String.fromCharCode(LETTER_A + Number.parseInt(digit, 16))).join("");
}
