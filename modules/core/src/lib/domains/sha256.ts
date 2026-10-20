/** The SHA-256 of a text or of bytes, in hexadecimal. */
import { createHash } from "node:crypto";

export const sha256 = (content: string | Buffer): string => createHash("sha256").update(content).digest("hex");
