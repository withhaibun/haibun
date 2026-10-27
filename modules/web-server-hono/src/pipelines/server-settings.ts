/**
 * The settings of an instance's web server, read from its stepper's options: the port and interface it listens on, the
 * origins it is reached at, the actions every caller may take without a delegation, the people its routes admit by HTTP
 * basic auth, and whether each feature's server serves RPC.
 */
import type { AStepper } from "@haibun/core/lib/astepper.js";
import type { TModuleOptions } from "@haibun/core/lib/world.js";
import { getStepperOption } from "@haibun/core/lib/domains/util.js";
import { actionList, EVERY_ACTION } from "@haibun/core/lib/domains/actions.js";
import { basicAuthUsers, type TBasicAuthUser } from "@haibun/core/lib/domains/basic-auth.js";
import { isDev } from "@haibun/core/lib/domains/dev-mode.js";
import { DEFAULT_PORT, isLoopback, ORIGINS_REQUIRED, originList, WEB_SERVER_STEPPER } from "../domains/web-server.js";

/** What a server serves: the origins it is reached at, what every caller may do without a delegation, and who its routes admit. */
export type TServing = { origins: string[]; allowedWithoutDelegation: string[]; admitted: TBasicAuthUser[] };

/** Where a server listens, what it serves, and whether it serves RPC. An absent hostname listens on this machine's loopback interface. */
export type TServerSettings = { port: number; hostname: string | undefined; serving: TServing; rpc: boolean };

/** The settings a web server's stepper states in `moduleOptions`. Throws where its PORT isn't a positive whole number, where
 *  it runs in production without naming its origins, and where it would give every action to other hosts that don't sign in. */
export function serverSettings(stepper: AStepper, moduleOptions: TModuleOptions): TServerSettings {
	const portOption = getStepperOption(stepper, "PORT", moduleOptions);
	const port = portOption === undefined ? DEFAULT_PORT : Number(portOption);
	if (!Number.isInteger(port) || port <= 0) throw new Error(`${WEB_SERVER_STEPPER}: PORT option "${portOption}" must be a positive integer`);
	const hostname = getStepperOption(stepper, "INTERFACE", moduleOptions);
	const originsOption = getStepperOption(stepper, "ORIGINS", moduleOptions);
	const origins = originsOption === undefined ? [] : originList(originsOption);
	if (origins.length === 0 && !isDev()) throw new Error(`${WEB_SERVER_STEPPER}: ${ORIGINS_REQUIRED}`);
	const allowedWithoutDelegation = actionList(getStepperOption(stepper, "ALLOW_WITHOUT_DELEGATION", moduleOptions));
	const basicAuth = getStepperOption(stepper, "BASIC_AUTH", moduleOptions);
	const admitted = basicAuth === undefined ? [] : basicAuthUsers(basicAuth);
	// Every action, allowed to every caller of a server that other hosts reach without signing in, is every action given
	// to the network.
	if (allowedWithoutDelegation.includes(EVERY_ACTION) && hostname !== undefined && !isLoopback(hostname) && admitted.length === 0)
		throw new Error(
			`${WEB_SERVER_STEPPER}: ALLOW_WITHOUT_DELEGATION allows every action, and INTERFACE ${hostname} lets other hosts reach the server without BASIC_AUTH. Name the actions a caller may take, set BASIC_AUTH, or serve on 127.0.0.1.`,
		);
	return { port, hostname, serving: { origins, allowedWithoutDelegation, admitted }, rpc: getStepperOption(stepper, "RPC", moduleOptions) === "true" };
}
