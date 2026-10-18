/**
 * The composition root of the web server: the Hono server each feature serves through, the runtime that holds it, the
 * ports this process listens on, and what the server reaches outside the process.
 */
import path from "path";
import type { TWorld, TRuntime } from "@haibun/core/lib/world.js";
import { WEBSERVER } from "./domains/web-server.js";
import type { IWebServer } from "./ports.js";
import { ServerHono } from "./adapters/server-hono.js";
import { unsignedRequest, whyNotSignedInOnly } from "./adapters/auth.js";
import { stopProcessAfter } from "./adapters/process.js";
import type { TBasicAuthUser } from "@haibun/core/lib/domains/basic-auth.js";

/** The folder whose files a feature serves by a relative path: `files` in the process's starting directory. */
const SERVED_FILES = "files";

/** A server of this instance: it serves its files and its store, and admits whom the settings name. */
export function newServer(world: TWorld, allowedWithoutDelegation: readonly string[], admitted: readonly TBasicAuthUser[]): IWebServer {
	return new ServerHono(world.eventLogger, path.join(process.cwd(), SERVED_FILES), () => world.shared.getStore(), allowedWithoutDelegation, admitted);
}

/** Holds the feature's server in the runtime, where other steppers read it under WEBSERVER. */
export function holdServer(runtime: TRuntime, server: IWebServer): void {
	runtime[WEBSERVER] = server;
}

/** The feature's server, which the web server's stepper holds in the runtime. Throws for `stepper`, naming the stepper
 *  that serves it, where the runtime doesn't hold one. */
export function heldServer(runtime: TRuntime, stepper: string): IWebServer {
	const server = runtime[WEBSERVER] as IWebServer | undefined;
	if (server === undefined) throw new Error(`${stepper}: the runtime doesn't hold a webserver. Add the WebServerStepper to the configuration before ${stepper}.`);
	return server;
}

/** The ports this process listens on, each with why. */
export const listeningPorts = (): ReadonlyMap<number, string> => ServerHono.listeningPorts;

/** Why `address` doesn't require a visitor to sign in, or undefined where it does, read from the address's own response. */
export const whyNotSignedIn = (address: string): Promise<string | undefined> => whyNotSignedInOnly(address, unsignedRequest);

/** Ends this process once the response to the step that ends it is sent. */
export const stopProcess = (): void => stopProcessAfter();
