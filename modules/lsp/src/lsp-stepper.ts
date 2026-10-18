/**
 * The Language Server Protocol for haibun features in an editor: completion, hover, diagnostics and semantic highlighting.
 * Once the world is set, the stepper starts the language server over the connection the root builds.
 */
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { OK } from "@haibun/core/lib/domains/protocol.js";
import { LanguageServer } from "./pipelines/language-server.js";
import { lspPorts } from "./root.js";

export default class LspStepper extends AStepper {
	description = "Provides completion, hover, diagnostics and semantic highlighting for haibun features in an IDE.";

	steps = { lspIsReady: { gwta: "lsp is ready", action: () => Promise.resolve(OK) } } as const satisfies TStepperSteps;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		// The connection writes the protocol's messages to standard output, so the logger leaves the console to it.
		world.eventLogger.suppressConsole = true;
		const { backgrounds } = world.runtime;
		new LanguageServer({ ports: lspPorts(), world, steppers, backgrounds: backgrounds === undefined ? [] : [...backgrounds], log: world.eventLogger }).listen();
	}
}
