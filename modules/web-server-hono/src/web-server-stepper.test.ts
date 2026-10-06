import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";

import { passWithDefaults, DEF_PROTO_OPTIONS } from "@haibun/core/lib/test/lib.js";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { OK, type TStepArgs } from "@haibun/core/schema/protocol.js";
import { getStepperOptionName, actionNotOK, perProcessOptionNames } from "@haibun/core/lib/util/index.js";
import WebServerStepper from "./web-server-stepper.js";
import { BASIC_AUTH_OPTION } from "@haibun/core/lib/basic-auth.js";
import { DOMAIN_LINK, DOMAIN_TEXT } from "@haibun/core/lib/domains.js";

// WebServerStepper expects a 'files' directory in cwd
const FILES_DIR = path.join(process.cwd(), "files");
const TEST_CONTENT_DIR = path.join(FILES_DIR, "test-content");

beforeAll(() => {
	if (!fs.existsSync(TEST_CONTENT_DIR)) {
		fs.mkdirSync(TEST_CONTENT_DIR, { recursive: true });
	}
	fs.writeFileSync(path.join(TEST_CONTENT_DIR, "hello.txt"), "Hello World");
});

afterAll(() => {
	// Clean up created files
	if (fs.existsSync(FILES_DIR)) {
		fs.rmSync(FILES_DIR, { recursive: true, force: true });
	}
});

class VerifyStepper extends AStepper {
	steps = {
		fetchFrom: {
			gwta: `fetch from {url: ${DOMAIN_LINK}} includes {text: ${DOMAIN_TEXT}}`,
			action: async ({ url, text }: TStepArgs) => {
				try {
					const res = await fetch(String(url));
					if (!res.ok) {
						return actionNotOK(`Fetch failed: ${res.status} ${res.statusText}`);
					}
					const content = await res.text();
					if (content.includes(String(text))) {
						return OK;
					}
					return actionNotOK(`Expected ${text} in ${content}`);
				} catch (e) {
					return actionNotOK(String(e));
				}
			},
		},
	};
}

describe("what an instance a run launches holds", () => {
	it("states what it allows without a delegation in its own configuration, rather than holding its launcher's", () => {
		expect(perProcessOptionNames([new WebServerStepper()])).toContain(getStepperOptionName(WebServerStepper, "ALLOW_WITHOUT_DELEGATION"));
	});
});

describe("the web server's basic auth option", () => {
	it("is the one core names, which a launched instance inherits and its launcher signs in with", () => {
		expect(getStepperOptionName(WebServerStepper, "BASIC_AUTH")).toBe(BASIC_AUTH_OPTION);
	});
});

describe("WebServerStepper Integration", () => {
	it("refuses every action to every caller of a server other hosts reach without basic auth, and allows it on this machine or behind basic auth", async () => {
		const options = (moduleOptions: Record<string, string>) => ({
			...DEF_PROTO_OPTIONS,
			moduleOptions: { [getStepperOptionName(WebServerStepper, "ALLOW_WITHOUT_DELEGATION")]: "*", ...moduleOptions },
		});
		const INTERFACE = getStepperOptionName(WebServerStepper, "INTERFACE");
		const open = await passWithDefaults("", [WebServerStepper], options({ [INTERFACE]: "0.0.0.0" }));
		expect(open.ok).toBe(false);
		expect(JSON.stringify(open.failure)).toContain("ALLOW_WITHOUT_DELEGATION allows every action");
		expect((await passWithDefaults("", [WebServerStepper], options({ [INTERFACE]: "127.0.0.1" }))).ok, "on this machine").toBe(true);
		expect((await passWithDefaults("", [WebServerStepper], options({ [INTERFACE]: "0.0.0.0", [BASIC_AUTH_OPTION]: "reader:secret" }))).ok, "behind basic auth").toBe(true);
	});

	it("serves files from a directory", async () => {
		const port = 8132;
		// Serve 'test-content' which is inside 'files'
		const feature = {
			path: "/features/test.feature",
			content: `
webserver is listening for "webserverstepper serves files"
serve files at "/pub" from "test-content"
fetch from "http://localhost:${port}/pub/hello.txt" includes "Hello World"
`,
		};

		const moduleOptions = { [getStepperOptionName(WebServerStepper, "PORT")]: String(port) };

		const result = await passWithDefaults([feature], [WebServerStepper, VerifyStepper], { ...DEF_PROTO_OPTIONS, moduleOptions });
		if (!result.ok) {
			console.error(JSON.stringify(result.featureResults?.[0].stepResults, null, 2));
		}
		expect(result.ok).toBe(true);
	});

	it("serves directory index", async () => {
		const port = 8133;
		const feature = {
			path: "/features/index.feature",
			content: `
webserver is listening for "webserverstepper serves index"
index files from "test-content"
fetch from "http://localhost:${port}/" includes "hello.txt"
`,
		};

		const moduleOptions = { [getStepperOptionName(WebServerStepper, "PORT")]: String(port) };

		const result = await passWithDefaults([feature], [WebServerStepper, VerifyStepper], { ...DEF_PROTO_OPTIONS, moduleOptions });
		if (!result.ok) {
			console.error(JSON.stringify(result.featureResults?.[0].stepResults, null, 2));
		}
		expect(result.ok).toBe(true);
	});
});
