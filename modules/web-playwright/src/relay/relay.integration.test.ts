/**
 * A person's browser, attached through their extension and driven by a run's steps. The extension's side is the relay
 * client running against a real Chromium through the chrome.* fake, calling the relay over the instance's `/rpc` and
 * signing as a key that holds what attaching a browser requires. Actuality clicks and enters text in the person's tab;
 * a caller that may not attach, a second extension, and a step without a browser attached are each refused, stating why.
 * The person attaches again after ending an attachment, and withdrawing what the extension holds ends its attachment.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { failWithDefaults, freePort, passWithDefaults } from "@haibun/core/lib/test/lib.js";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { actionNotOK, errorDetail, getStepperOptionName } from "@haibun/core/lib/util/index.js";
import { DEFAULT_DEST, OK, type TStepArgs } from "@haibun/core/schema/protocol.js";
import AuthorityStepper from "@haibun/core/steps/authority-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import FakeAuthorityStepper, { FakeInvoker, fakeGrant, DOMAIN_FAKE_HOLDER } from "@haibun/core/lib/test/fake-authority.js";
import StorageMem from "@haibun/storage-mem/storage-mem.js";
import WebServerStepper from "@haibun/web-server-hono/web-server-stepper.js";
import WebPlaywright from "../web-playwright.js";
import { WEB_PLAYWRIGHT_ACTIONS } from "../actions.js";
import { BrowserFactory } from "../BrowserFactory.js";
import { ChromeOverCdp } from "../relay-client/chrome.test-fake.js";
import { RelayConnection } from "../relay-client/relayConnection.js";
import { openRelayChannel } from "../relay-client/relay-channel.js";
import type { TProveRequest } from "@haibun/core/lib/rpc-wire.js";
import { DOMAIN_LINK, DOMAIN_TEXT } from "@haibun/core/lib/domains.js";

const PAGE = `<title>attached</title><button onclick="this.textContent='pressed'">press me</button><input aria-label="note" oninput="document.getElementById('echo').textContent=this.value"><p id="echo"></p>`;

let chrome: ChromeOverCdp;
let site: Server;
let siteUrl: string;

/** Sign each relay call as `holder`, invoking what attaching a browser requires; `nobody` doesn't sign a request. */
const signedAs =
	(holder: string): TProveRequest =>
	(request) =>
		holder === "nobody" ? Promise.resolve(request.headers) : new FakeInvoker(holder).sign(request, WEB_PLAYWRIGHT_ACTIONS.attach);

/** The extension a person runs: it attaches the tab they have open, and ends its attachment when they say. */
class PersonsExtension extends AStepper {
	description = "A person's extension, attaching the tab they have open to an instance's browser relay.";
	private connection?: RelayConnection;
	private ended?: Promise<string>;
	steps = {
		attaches: {
			gwta: `person's extension attaches their tab at {base: ${DOMAIN_LINK}}, signed by {holder: ${DOMAIN_FAKE_HOLDER}}`,
			action: async ({ base, holder }: TStepArgs) => {
				const channel = await openRelayChannel({ base: String(base), sign: signedAs(String(holder)) });
				this.connection = new RelayConnection(channel, chrome, () => undefined);
				const ended = Promise.withResolvers<string>();
				this.connection.onclose = ended.resolve;
				this.ended = ended.promise;
				this.connection.attachTab(chrome.firstTab());
				this.connection.didInitialize();
				return OK;
			},
		},
		refused: {
			gwta: `extension attaching at {base: ${DOMAIN_LINK}}, signed by {holder: ${DOMAIN_FAKE_HOLDER}}, is refused for {why: ${DOMAIN_TEXT}}`,
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
		toldEnded: {
			gwta: `person's extension is told its attachment ended because {why: ${DOMAIN_TEXT}}`,
			action: async ({ why }: TStepArgs) => {
				if (!this.ended) return actionNotOK("the extension attached nothing");
				const reason = await this.ended;
				return reason.includes(String(why)) ? OK : actionNotOK(`it ended because ${reason}`);
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
	it("drives the tab a person attached, refuses a caller that may not attach and a second extension, and ends the attachment when its grant is withdrawn", {
		timeout: 60_000,
	}, async () => {
		const port = await freePort();
		const base = `http://localhost:${port}`;
		const feature = [
			"enable rpc",
			'webserver is listening for "relay"',
			`accept authority from "extension" for "${WEB_PLAYWRIGHT_ACTIONS.attach}"`,
			'accept authority from "reader" for "Read:public"',
			`accept authority from "another extension" for "${WEB_PLAYWRIGHT_ACTIONS.attach}"`,
			"serve the browser relay",
			`an extension attaching at "${base}", signed by "nobody", is refused for "not a call this caller may make"`,
			`an extension attaching at "${base}", signed by "reader", is refused for "holds no grant for ${WEB_PLAYWRIGHT_ACTIONS.attach}"`,
			`the person's extension attaches their tab at "${base}", signed by "extension"`,
			`an extension attaching at "${base}", signed by "another extension", is refused for "a browser is already attached"`,
			`go to the "${siteUrl}" webpage`,
			'click "press me"',
			'see "pressed"',
			`set note as page-locator to "input[aria-label='note']"`,
			'enter "a note" into note',
			'see "a note"',
			"the person's extension ends its attachment",
			`the person's extension attaches their tab at "${base}", signed by "extension"`,
			`go to the "${siteUrl}" webpage`,
			'see "press me"',
			'withdraw authority from "extension"',
			`the person's extension is told its attachment ended because "${fakeGrant("extension")} was revoked"`,
		].join("\n");
		const result = await passWithDefaults([{ path: "/features/relay.feature", content: feature }], steppers, options(port));
		expect(result.ok, JSON.stringify(result.featureResults?.[0]?.stepResults?.filter((s) => !s.ok))).toBe(true);
	});

	it("refuses a step that needs the browser while a browser isn't attached, stating so", { timeout: 60_000 }, async () => {
		const port = await freePort();
		const feature = ["enable rpc", 'webserver is listening for "relay-detached"', "serve the browser relay", `go to the "${siteUrl}" webpage`].join("\n");
		const result = await failWithDefaults([{ path: "/features/relay-detached.feature", content: feature }], steppers, options(port));
		const failed = result.featureResults?.[0]?.stepResults?.find((step) => !step.ok) as { in?: string; errorMessage?: string } | undefined;
		expect(failed?.in).toBe(`go to the "${siteUrl}" webpage`);
		expect(failed?.errorMessage).toMatch(/a browser isn't attached/);
	});
});
