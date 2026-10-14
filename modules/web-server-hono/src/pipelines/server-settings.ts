/**
 * The settings of an instance's web server, read from its stepper's options: the port and interface it listens on, the
 * actions every caller may take without a delegation, and the people its routes admit by HTTP basic auth.
 */
import type { AStepper } from "@haibun/core/lib/astepper.js";
import type { TModuleOptions } from "@haibun/core/lib/world.js";
import { getStepperOption } from "@haibun/core/lib/util/index.js";
import { actionList, EVERY_ACTION } from "@haibun/core/lib/actions.js";
import { basicAuthUsers, type TBasicAuthUser } from "@haibun/core/lib/basic-auth.js";
import { isLoopback } from "../ports.js";
import { DEFAULT_PORT, WEB_SERVER_STEPPER } from "../domains/web-server.js";

/** Where a server listens, what every caller may do without a delegation, and who its routes admit. An absent hostname
 *  listens on this machine's loopback interface. */
export type TServerSettings = { port: number; hostname: string | undefined; allowedWithoutDelegation: string[]; admitted: TBasicAuthUser[] };

/** The settings a web server's stepper states in `moduleOptions`. Throws where its PORT isn't a positive whole number, and
 *  where it would give every action to other hosts that don't sign in. */
export function serverSettings(stepper: AStepper, moduleOptions: TModuleOptions): TServerSettings {
	const portOption = getStepperOption(stepper, "PORT", moduleOptions);
	const port = portOption === undefined ? DEFAULT_PORT : Number(portOption);
	if (!Number.isInteger(port) || port <= 0) throw new Error(`${WEB_SERVER_STEPPER}: PORT option "${portOption}" must be a positive integer`);
	const hostname = getStepperOption(stepper, "INTERFACE", moduleOptions);
	const allowedWithoutDelegation = actionList(getStepperOption(stepper, "ALLOW_WITHOUT_DELEGATION", moduleOptions));
	const basicAuth = getStepperOption(stepper, "BASIC_AUTH", moduleOptions);
	const admitted = basicAuth === undefined ? [] : basicAuthUsers(basicAuth);
	// Every action, allowed to every caller of a server that other hosts reach without signing in, is every action given
	// to the network.
	if (allowedWithoutDelegation.includes(EVERY_ACTION) && hostname !== undefined && !isLoopback(hostname) && admitted.length === 0)
		throw new Error(
			`${WEB_SERVER_STEPPER}: ALLOW_WITHOUT_DELEGATION allows every action, and INTERFACE ${hostname} lets other hosts reach the server without BASIC_AUTH. Name the actions a caller may take, set BASIC_AUTH, or serve on 127.0.0.1.`,
		);
	return { port, hostname, allowedWithoutDelegation, admitted };
}
