/**
 * Test stepper that registers a vertex domain with a `ui` extension declaring
 * a custom-element component to slot into the actions bar's chat row.
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
import { LinkRelations } from "@haibun/core/lib/resources.js";
import { actionOK, getFromRuntime } from "@haibun/core/lib/util/index.js";
import { WEBSERVER, type IWebServer, type Context } from "@haibun/web-server-hono/defs.js";

/** Trivial custom-element source served by the test stepper to verify dynamic import + render. */
const TEST_COMPONENT_JS = `
class VoiceUITestComponent extends HTMLElement {
	connectedCallback() {
		this.attachShadow({ mode: "open" }).innerHTML = '<button data-testid="voice-ui-test-mic">🎙️</button>';
	}
}
customElements.define("voice-ui-test-component", VoiceUITestComponent);
`;

export const VOICE_UI_TEST_DOMAIN = "voice-ui-test";
export const VOICE_UI_TEST_LABEL = "VoiceUITest";

export default class VoiceUITestStepper extends AStepper implements IHasCycles {
	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{
					selectors: [VOICE_UI_TEST_DOMAIN],
					schema: z.object({ id: z.string() }),
					description: "Voice UI test (drives ui extension propagation)",
					topology: {
						vertexLabel: VOICE_UI_TEST_LABEL,
						id: "id",
						properties: { id: LinkRelations.IDENTIFIER.rel },
					},
					ui: {
						component: "voice-ui-test-component",
						slot: "action-bar-chat",
						js: "/assets/voice-ui-test-component.js",
					},
				},
			],
		}),
	};

	steps = {
		serveTestComponent: {
			gwta: "serve voice ui test component",
			action: () => {
				const webserver = getFromRuntime(this.getWorld().runtime, WEBSERVER) as IWebServer;
				webserver.addRoute("get", "/assets/voice-ui-test-component.js", { description: "Voice UI test component" }, (c: Context) => {
					c.header("Content-Type", "application/javascript");
					return c.body(TEST_COMPONENT_JS);
				});
				return actionOK();
			},
		},
	};
}
