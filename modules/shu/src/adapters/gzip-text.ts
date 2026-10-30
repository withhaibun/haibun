/** Text gzipped by zlib's threads, off the event loop. */
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import type { TGzipText } from "../ports.js";

const gzipped = promisify(gzip);

export const gzipText: TGzipText = async (text) => new Uint8Array(await gzipped(text));
