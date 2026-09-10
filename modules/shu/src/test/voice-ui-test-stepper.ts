/**
 * Test stepper that registers a UI-extension domain (no persistedAs: it is not
 * serialized in the graph DB) with a `ui` extension declaring a custom-element
 * component to slot into the actions bar's chat row.
 *
 * Drives the end-to-end "spa renders ui-extension components" pipeline:
 *   - ui flows through TDomainDefinition → TRegisteredDomain → concern catalog.
 *   - SPA's whenSiteMetadataReady resolves; loadUiExtensions imports the JS.
 *   - Custom element renders inside shu-actions-bar in ask mode.
 *
 * Used by tests/features/voice-ui.feature.ts.
 */
import { z } from "zod";
import { AStepper, IHasCycles, type IStepperCycles } from "@haibun/core/lib/astepper.js";
import { actionOK, getFromRuntime } from "@haibun/core/lib/util/index.js";
import { WEBSERVER, type IWebServer, type Context } from "@haibun/web-server-hono/defs.js";

const TEST_COMPONENT_URL = "/assets/voice-ui-test-component.js";

/** Trivial custom-element source served by the test stepper to verify dynamic import + render. */
const TEST_COMPONENT_JS = `
class VoiceUITestComponent extends HTMLElement {
	connectedCallback() {
		this.attachShadow({ mode: "open" }).innerHTML = '<button data-testid="voice-ui-test-mic">🗣️️</button>';
	}
}
customElements.define("voice-ui-test-component", VoiceUITestComponent);
`;

export const VOICE_UI_TEST_DOMAIN = "voice-ui-test";

export default class VoiceUITestStepper extends AStepper implements IHasCycles {
	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{
					selectors: [VOICE_UI_TEST_DOMAIN],
					schema: z.object({ id: z.string() }),
					description: "Voice UI test (drives ui extension propagation)",
					ui: {
						component: "voice-ui-test-component",
						slot: "action-bar-chat",
						js: TEST_COMPONENT_URL,
					},
				},
			],
		}),
		// The ui concern is declared in every feature that loads this stepper (it is
		// in the shared config.json), so every SPA tries to import the component JS.
		// Serve the asset in every feature, not only the one that calls
		// `serveTestComponent`: so the other features don't log a failed import.
		// `clearMounted()` (web-server startFeature, runs first) drops the prior
		// feature's routes, so re-registering here each feature is correct.
		startFeature: () => this.serveTestComponentRoute(),
	};

	/** Mount the component JS route on the live webserver. Idempotent within a feature. */
	private serveTestComponentRoute(): void {
		const webserver = getFromRuntime(this.getWorld().runtime, WEBSERVER) as IWebServer;
		webserver.addRouteIfAbsent("get", TEST_COMPONENT_URL, { description: "Voice UI test component" }, (c: Context) => {
			c.header("Content-Type", "application/javascript");
			return c.body(TEST_COMPONENT_JS);
		});
	}

	steps = {
		serveTestComponent: {
			gwta: "serve voice ui test component",
			action: () => {
				this.serveTestComponentRoute();
				return actionOK();
			},
		},
	};
}
