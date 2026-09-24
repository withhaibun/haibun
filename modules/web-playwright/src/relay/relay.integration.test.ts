/**
 * A person's browser, attached through their extension and driven by a run's steps. The extension's side is the relay
 * client running against a real Chromium through the chrome.* fake, calling the relay over the instance's `/rpc` and
 * signing as a key that holds what attaching a browser requires. The run clicks and enters text in the person's tab;
 * a caller that may not attach, a second extension, and a step with no browser attached are each refused, saying why.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { failWithDefaults, freePort, passWithDefaults } from "@haibun/core/lib/test/lib.js";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { actionNotOK, errorDetail, getStepperOptionName } from "@haibun/core/lib/util/index.js";
import { DEFAULT_DEST, OK, type TStepArgs } from "@haibun/core/schema/protocol.js";
import AuthorityStepper from "@haibun/core/steps/authority-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import FakeAuthorityStepper, { FakeInvoker } from "@haibun/core/lib/test/fake-authority.js";
import StorageMem from "@haibun/storage-mem/storage-mem.js";
import WebServerStepper from "@haibun/web-server-hono/web-server-stepper.js";
import WebPlaywright, { WEB_PLAYWRIGHT_ACTIONS } from "../web-playwright.js";
import { BrowserFactory } from "../BrowserFactory.js";
import { ChromeOverCdp } from "../relay-client/chrome.test-fake.js";
import { RelayConnection } from "../relay-client/relayConnection.js";
import { openRelayChannel, type TSignRequest } from "../relay-client/relay-channel.js";

const PAGE = `<title>attached</title><button onclick="this.textContent='pressed'">press me</button><input aria-label="note" oninput="document.getElementById('echo').textContent=this.value"><p id="echo"></p>`;

let chrome: ChromeOverCdp;
let site: Server;
let siteUrl: string;

/** Sign each relay call as `holder`, invoking what attaching a browser requires; `nobody` signs nothing. */
const signedAs =
	(holder: string): TSignRequest =>
	(request) =>
		holder === "nobody" ? Promise.resolve({}) : new FakeInvoker(holder).sign(request, WEB_PLAYWRIGHT_ACTIONS.attach);

/** The extension a person runs: it attaches the tab they have open, and ends its attachment when they say. */
class PersonsExtension extends AStepper {
	description = "A person's extension, attaching the tab they have open to an instance's browser relay.";
	private connection?: RelayConnection;
	steps = {
		attaches: {
			gwta: "person's extension attaches their tab at {base}, signed by {holder}",
			action: async ({ base, holder }: TStepArgs) => {
				const channel = await openRelayChannel({ base: String(base), sign: signedAs(String(holder)) });
				this.connection = new RelayConnection(channel, chrome, () => undefined);
				this.connection.attachTab(chrome.firstTab());
				this.connection.didInitialize();
				return OK;
			},
		},
		refused: {
			gwta: "extension attaching at {base}, signed by {holder}, is refused for {why}",
			action: async ({ base, holder, why }: TStepArgs) => {
				try {
					await openRelayChannel({ base: String(base), sign: signedAs(String(holder)) });
					return actionNotOK("the relay held it");
				} catch (e) {
					return errorDetail(e).includes(String(why)) ? OK : actionNotOK(`refused for another reason: ${errorDetail(e)}`);
				}
			},
		},
		ends: {
			gwta: "person's extension ends its attachment",
			action: () => {
				this.connection?.close("the person detached");
				return OK;
			},
		},
	};
}

const steppers = [WebServerStepper, WebPlaywright, VariablesStepper, StorageMem, AuthorityStepper, FakeAuthorityStepper, PersonsExtension];
const options = (port: number) => ({
	options: { DEST: DEFAULT_DEST },
	moduleOptions: {
		[getStepperOptionName(WebPlaywright, "STORAGE")]: "StorageMem",
		[getStepperOptionName(WebPlaywright, "HEADLESS")]: "true",
		[getStepperOptionName(WebServerStepper, "PORT")]: String(port),
	},
});

beforeAll(async () => {
	site = createServer((_req, res) => res.writeHead(200, { "content-type": "text/html" }).end(PAGE));
	await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
	siteUrl = `http://127.0.0.1:${(site.address() as { port: number }).port}/`;
	chrome = await ChromeOverCdp.launch();
}, 60_000);

afterAll(async () => {
	await BrowserFactory.closeBrowsers();
	await chrome.close();
	await new Promise((resolve) => site.close(resolve));
});

describe("the browser relay", () => {
	it("drives the tab a person attached, and refuses a caller that may not attach and a second extension", { timeout: 60_000 }, async () => {
		const port = await freePort();
		const base = `http://localhost:${port}`;
		const feature = [
			"enable rpc",
			'webserver is listening for "relay"',
			`accept authority from "extension" for "${WEB_PLAYWRIGHT_ACTIONS.attach}"`,
			'accept authority from "reader" for "Read:public"',
			"serve the browser relay",
			`an extension attaching at "${base}", signed by "nobody", is refused for "not a call this caller may make"`,
			`an extension attaching at "${base}", signed by "reader", is refused for "holds no grant for ${WEB_PLAYWRIGHT_ACTIONS.attach}"`,
			`the person's extension attaches their tab at "${base}", signed by "extension"`,
			`an extension attaching at "${base}", signed by "extension", is refused for "a browser is already attached"`,
			`go to the "${siteUrl}" webpage`,
			'click "press me"',
			'see "pressed"',
			`set note as page-locator to "input[aria-label='note']"`,
			'enter "a note" into note',
			'see "a note"',
			"the person's extension ends its attachment",
		].join("\n");
		const result = await passWithDefaults([{ path: "/features/relay.feature", content: feature }], steppers, options(port));
		expect(result.ok, JSON.stringify(result.featureResults?.[0]?.stepResults?.filter((s) => !s.ok))).toBe(true);
	});

	it("refuses a step that needs the browser while none is attached, saying so", { timeout: 60_000 }, async () => {
		const port = await freePort();
		const feature = ["enable rpc", 'webserver is listening for "relay-detached"', "serve the browser relay", `go to the "${siteUrl}" webpage`].join("\n");
		const result = await failWithDefaults([{ path: "/features/relay-detached.feature", content: feature }], steppers, options(port));
		const failed = result.featureResults?.[0]?.stepResults?.find((step) => !step.ok) as { in?: string; errorMessage?: string } | undefined;
		expect(failed?.in).toBe(`go to the "${siteUrl}" webpage`);
		expect(failed?.errorMessage).toMatch(/no browser is attached/);
	});
});
