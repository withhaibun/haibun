/**
 * Child process entry point for subprocess-transport tests.
 * Run by SubprocessTransport.spawn() to verify the stdio protocol.
 */

import { AStepper } from "../astepper.js";
import { OK } from "../../schema/protocol.js";
import { actionOKWithProducts } from "../util/index.js";
import { runSubprocess } from "../subprocess-runner.js";
import { getDefaultWorld } from "./lib.js";

class EchoStepper extends AStepper {
	description = "Steps that echo a message and answer a ping, run in a subprocess for tests of the subprocess transport.";
	steps = {
		echo: {
			gwta: "echo {message}",
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
