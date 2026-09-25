/**
 * Child process entry point for subprocess-transport tests.
 * Run by SubprocessTransport.spawn() to verify the stdio protocol.
 */

import { AStepper } from "../astepper.js";
import { OK } from "../../schema/protocol.js";
import { actionOKWithProducts } from "../util/index.js";
import { runSubprocess } from "../subprocess-runner.js";
import { getDefaultWorld } from "./lib.js";
import { TEST_DOMAIN, declaresTestDomains } from "./test-domains.js";

class EchoStepper extends AStepper {
	description = "Steps that echo a message and answer a ping, run in a subprocess for tests of the subprocess transport.";
	cycles = declaresTestDomains();
	steps = {
		echo: {
			gwta: "echo {message}",
			productsDomain: TEST_DOMAIN.echoed,
			action: ({ message }: { message: string }) => actionOKWithProducts({ echoed: message }),
		},
		pong: {
			gwta: "pong",
			capability: "EchoStepper:protected",
			action: async () => OK,
		},
	};
}

const world = getDefaultWorld();
await runSubprocess([EchoStepper], world);
