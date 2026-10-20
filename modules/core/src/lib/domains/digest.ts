/** The SHA-256 of a text or of bytes, and a level's digests: each part of what the level depends on by name, with its SHA-256. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { SEQ_PATH_FIELD } from "../actuality/domains/seq-path.js";

export const sha256 = (content: string | Buffer): string => createHash("sha256").update(content).digest("hex");
export const DigestSchema = z.record(z.string(), z.string());
export type TDigest = z.infer<typeof DigestSchema>;
/** The part of a scenario's digest that holds its declared lines. */
export const DECLARED_LINES = "lines";
/** The field of a level's record that states its digests as JSON text, so a reader selects the records of one state by it. */
export const digestFields = (digest: TDigest | undefined) => (digest === undefined ? undefined : { [SEQ_PATH_FIELD.digest]: JSON.stringify(digest) });
/** A level's digests read from the JSON text its record states. */
export const DigestTextSchema = z.preprocess((text) => JSON.parse(z.string().parse(text)), DigestSchema);
