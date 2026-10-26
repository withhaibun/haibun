import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";

import { passWithDefaults, DEF_PROTO_OPTIONS, freePort } from "@haibun/core/lib/test/lib.js";
import LogicStepper from "@haibun/logic/logic-stepper.js";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { OK, type TStepArgs } from "@haibun/core/lib/domains/protocol.js";
import { getStepperOptionName, actionNotOK, perProcessOptionNames } from "@haibun/core/lib/domains/util.js";
import WebServerStepper from "./web-server-stepper.js";
import { BASIC_AUTH_OPTION } from "@haibun/core/lib/domains/basic-auth.js";
import { DOMAIN_LINK, DOMAIN_TEXT } from "@haibun/core/lib/domains/domains.js";
import { READS_A_SERVED_FOLDER } from "@haibun/core/lib/domains/actions.js";
import { ARTIFACT_POLICY } from "@haibun/core/lib/domains/run-artifact.js";
import { REFUSED_INVOCATION } from "@haibun/core/lib/rpc-wire.js";
import { servedFileRefusal } from "./pipelines/served-folder.js";

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
	description = "Fetches from the web server and checks what it returns.";
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
		refusedFrom: {
			gwta: `fetch from {url: ${DOMAIN_LINK}} is refused with the read it requires as its remedy`,
			action: async ({ url }: TStepArgs) => {
				const res = await fetch(String(url));
				const refused = servedFileRefusal(new URL(String(url)).pathname, ALLOWING);
				const body: unknown = await res.json();
				return res.status === REFUSED_INVOCATION && JSON.stringify(body) === JSON.stringify(refused) ? OK : actionNotOK(`${url} returned ${res.status} ${JSON.stringify(body)}`);
			},
		},
		policyOf: {
			gwta: `fetch from {url: ${DOMAIN_LINK}} carries the policy {policy: ${DOMAIN_TEXT}}`,
			action: async ({ url, policy }: TStepArgs) => {
				const carried = String((await fetch(String(url))).headers.get("content-security-policy"));
				return carried === String(policy) ? OK : actionNotOK(`${url} carries the policy ${carried}`);
			},
		},
	};
}

/** The option through which a deployment allows a read without a delegation. */
const ALLOWING = getStepperOptionName(WebServerStepper, "ALLOW_WITHOUT_DELEGATION");
/** A deployment that serves its files to every browser. */
const SERVES_A_SITE = { [ALLOWING]: READS_A_SERVED_FOLDER };

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
		const open = await passWithDefaults("", [WebServerStepper, LogicStepper], options({ [INTERFACE]: "0.0.0.0" }));
		expect(open.ok).toBe(false);
		expect(JSON.stringify(open.failure)).toContain("ALLOW_WITHOUT_DELEGATION allows every action");
		expect((await passWithDefaults("", [WebServerStepper, LogicStepper], options({ [INTERFACE]: "127.0.0.1" }))).ok, "on this machine").toBe(true);
		expect((await passWithDefaults("", [WebServerStepper, LogicStepper], options({ [INTERFACE]: "0.0.0.0", [BASIC_AUTH_OPTION]: "reader:secret" }))).ok, "behind basic auth").toBe(
			true,
		);
	});

	it("refuses a served file to a caller that doesn't hold the read it requires, stating the cause and the remedy", async () => {
		const port = await freePort();
		const feature = {
			path: "/features/refused.feature",
			content: `
webserver is listening for "webserverstepper refuses a served file"
serve files at "/pub" from "test-content"
fetch from "http://localhost:${port}/pub/hello.txt" is refused with the read it requires as its remedy
`,
		};
		const moduleOptions = { [getStepperOptionName(WebServerStepper, "PORT")]: String(port) };
		const result = await passWithDefaults([feature], [WebServerStepper, VerifyStepper, LogicStepper], { ...DEF_PROTO_OPTIONS, moduleOptions });
		expect(result.ok, JSON.stringify(result.failure)).toBe(true);
	});

	it("serves a file to a caller that holds the read, under the artifact policy where the server serves rpc calls", async () => {
		const port = 8135;
		const hello = `http://localhost:${port}/pub/hello.txt`;
		const served = (policy: string) => ({
			path: "/features/policy.feature",
			content: `
webserver is listening for "webserverstepper serves under the artifact policy"
serve files at "/pub" from "test-content"
fetch from "${hello}" includes "Hello World"
fetch from "${hello}" carries the policy "${policy}"
`,
		});
		const moduleOptions = { [getStepperOptionName(WebServerStepper, "PORT")]: String(port), ...SERVES_A_SITE };
		const plain = await passWithDefaults([served("null")], [WebServerStepper, VerifyStepper, LogicStepper], { ...DEF_PROTO_OPTIONS, moduleOptions });
		expect(plain.ok, JSON.stringify(plain.failure)).toBe(true);
		const rpc = { ...moduleOptions, [getStepperOptionName(WebServerStepper, "RPC")]: "true" };
		const sandboxed = await passWithDefaults([served(ARTIFACT_POLICY)], [WebServerStepper, VerifyStepper, LogicStepper], { ...DEF_PROTO_OPTIONS, moduleOptions: rpc });
		expect(sandboxed.ok, JSON.stringify(sandboxed.failure)).toBe(true);
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

		const moduleOptions = { [getStepperOptionName(WebServerStepper, "PORT")]: String(port), ...SERVES_A_SITE };

		const result = await passWithDefaults([feature], [WebServerStepper, VerifyStepper, LogicStepper], { ...DEF_PROTO_OPTIONS, moduleOptions });
		if (!result.ok) {
			console.error(JSON.stringify(result.featureResults?.[0]?.stepResults, null, 2));
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

		const moduleOptions = { [getStepperOptionName(WebServerStepper, "PORT")]: String(port), ...SERVES_A_SITE };

		const result = await passWithDefaults([feature], [WebServerStepper, VerifyStepper, LogicStepper], { ...DEF_PROTO_OPTIONS, moduleOptions });
		if (!result.ok) {
			console.error(JSON.stringify(result.featureResults?.[0]?.stepResults, null, 2));
		}
		expect(result.ok).toBe(true);
	});
});
