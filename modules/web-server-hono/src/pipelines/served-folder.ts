/**
 * What a served folder's files carry (ZH9, RD18): the read they require, as every read of this instance does, and the
 * artifact policy a response carries where its server dispatches `/rpc` calls, so a page among the files doesn't run a
 * script on the origin that holds a page's key and its calls. Other packages read it as
 * `@haibun/web-server-hono/served-folder.js`.
 */
import { READS_A_SERVED_FOLDER } from "@haibun/core/lib/domains/actions.js";
import { ARTIFACT_POLICY } from "@haibun/core/lib/domains/run-artifact.js";
import type { TRpcRefusal } from "@haibun/core/lib/rpc-wire.js";
import type { TRuntime } from "@haibun/core/lib/world.js";
import type { MiddlewareHandler, TServed } from "../ports.js";
import { requiringElse } from "./capability-verifier.js";

/** The header that carries a response's policy. */
const POLICY_HEADER = "Content-Security-Policy";

/** A response's middleware that gives the response the artifact policy as it leaves, while `holds` returns true. */
export const sandboxedWhile =
	(holds: () => boolean): MiddlewareHandler =>
	async (c, next) => {
		await next();
		if (holds()) c.res.headers.set(POLICY_HEADER, ARTIFACT_POLICY);
	};

/** A response's middleware that gives every response the artifact policy as it leaves. */
export const sandboxed: MiddlewareHandler = sandboxedWhile(() => true);

/** The refusal of a served file to a caller whose authority doesn't allow the read the file requires: its cause, the
 *  setting through which a deployment serves the files to every browser, and the request of the read as its remedy. */
export const servedFileRefusal = (path: string, allowingOption: string): TRpcRefusal => ({
	error: `${path}: a served file requires ${READS_A_SERVED_FOLDER}. A deployment that serves these files to every browser allows ${READS_A_SERVED_FOLDER} without a delegation in ${allowingOption}`,
	remedy: { do: "request", action: READS_A_SERVED_FOLDER },
});

/** What a served folder's routes read: actuality's runtime, the server's callers, the option that allows a read without a
 *  delegation, and whether the server dispatches `/rpc` calls, read for each response since RPC can be enabled later. */
export type TServedFolderParts = { runtime: TRuntime; served: TServed; allowingOption: string; dispatchesRpc: () => boolean };

/** The middleware each request for a served folder's file passes: the read the file requires, then the artifact policy
 *  where the server dispatches `/rpc` calls. */
export const servedFolderGates = ({ runtime, served, allowingOption, dispatchesRpc }: TServedFolderParts): MiddlewareHandler[] => [
	requiringElse(READS_A_SERVED_FOLDER, runtime, served, (path) => servedFileRefusal(path, allowingOption)),
	sandboxedWhile(dispatchesRpc),
];
