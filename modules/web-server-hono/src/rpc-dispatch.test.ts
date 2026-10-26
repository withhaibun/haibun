import { describe, it, expect, vi } from "vitest";
import {
	ACTION_BEGIN,
	ACTUALITY_HEADER,
	SSE_ROUTE,
	actualityRefusal,
	readNdjson,
	REFUSED_CALL_STATUS,
	REFUSED_INVOCATION,
	RELOAD,
	RPC_PROTOCOL,
	RpcRefusalSchema,
	rpcEnvelope,
} from "@haibun/core/lib/rpc-wire.js";
import { actualityAt } from "@haibun/core/lib/transport/adapters/rpc-call.js";
import { ActionSchema, FOLLOWS_THE_RUN, readAction } from "@haibun/core/lib/domains/actions.js";
import { STORE_METHOD_PREFIX, STORE_READ } from "@haibun/core/lib/domains/store-protocol.js";
import { GraphQuerySchema } from "@haibun/core/lib/quad-types.js";
import { z } from "zod";
import { passWithDefaults, DEF_PROTO_OPTIONS, freePort } from "@haibun/core/lib/test/lib.js";
import LogicStepper from "@haibun/logic/logic-stepper.js";
import { TEST_DOMAIN, declaresTestDomains } from "@haibun/core/lib/test/test-domains.js";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { LogEvent, OK, type TStepArgs } from "@haibun/core/lib/domains/protocol.js";
import { actionNotOK, actionOKWithProducts, getFromRuntime, getStepperOptionName } from "@haibun/core/lib/domains/util.js";
import AuthorityStepper from "@haibun/core/steps/authority-stepper.js";
import FakeAuthorityStepper, { DOMAIN_FAKE_HOLDER, FakeInvoker, fakeGrant } from "@haibun/core/lib/test/fake-authority.js";
import WebServerStepper from "./web-server-stepper.js";
import { WEBSERVER } from "./domains/web-server.js";
import type { IWebServer } from "./ports.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import { SHOW_STEP_DEFINITIONS_METHOD, SHOW_STEPS_ACTION, SHOW_STEPS_METHOD, readStepDefinitions, type TStepDefinition } from "@haibun/core/lib/step-discovery.js";
import { refusal } from "@haibun/core/lib/steps/pipelines/gate.js";
import { streamContext, type TStreamChunk } from "@haibun/core/lib/step-stream-context.js";
import { authorizedWith, readingAt } from "@haibun/core/lib/domains/capability-context.js";
import { Access, LinkRelations, PersistedVertexSchema, type AccessLevel } from "@haibun/core/lib/domains/resources.js";
import { TRANSPORT, type ITransport } from "./domains/transport.js";
import { DOMAIN_LINK, DOMAIN_NUMBER, DOMAIN_STEP_METHOD, DOMAIN_TEXT } from "@haibun/core/lib/domains/domains.js";
import { StepMethodSchema } from "@haibun/core/lib/steps/domains/step-method.js";

/** A family of protocol methods a test serves, and the action its method declares. */
const [PROBE_PREFIX, PROBE_NAME, PROBE_ACTION] = ["probe.", "held", "Probe:held"];
const PROBE_METHOD = `${PROBE_PREFIX}${PROBE_NAME}`;

class PingStepper extends AStepper {
	description = "Steps that respond to a ping, one of them protected and one gated by an admin capability.";
	cycles = declaresTestDomains();
	steps = {
		ping: { gwta: "ping", productsDomain: TEST_DOMAIN.pong, action: async () => actionOKWithProducts({ pong: true }) },
		protectedPing: { gwta: "protected ping", capability: "PingStepper:protected", productsDomain: TEST_DOMAIN.pong, action: async () => actionOKWithProducts({ pong: true }) },
		adminPing: { gwta: "admin ping", capability: "PingStepper:admin", action: async () => OK },
		readsAt: {
			gwta: "level this reads at",
			read: true,
			readsAt: Access.public,
			productsDomain: TEST_DOMAIN.readAt,
			action: async () => actionOKWithProducts({ at: readingAt() ?? "unbounded" }),
		},
		serveProbe: {
			gwta: "serve the probe family",
			action: () => {
				const webserver = getFromRuntime<IWebServer>(this.getWorld().runtime, WEBSERVER);
				// A family's method returns what the call holds and the level at which it reads, inside the call.
				webserver.addRpcMethods(
					PROBE_PREFIX,
					{ description: "returns what a call holds" },
					{ [PROBE_NAME]: { action: ActionSchema.parse(PROBE_ACTION), handle: async () => ({ held: authorizedWith(), at: readingAt() ?? "unbounded" }) } },
				);
				return OK;
			},
		},
		holdOpen: {
			gwta: "hold open",
			capability: "PingStepper:protected",
			action: async () => {
				const stream = streamContext.getStore();
				if (!stream) return actionNotOK("held open only as a streamed call");
				stream.emit({ status: "held" });
				await new Promise((resolve) => stream.signal.addEventListener("abort", resolve, { once: true }));
				return OK;
			},
		},
	};
}

/** The header that follows the stream of the host at `base` for the actuality its handshake returns. */
const following = async (base: string): Promise<Record<string, string>> => ({ [ACTUALITY_HEADER]: await actualityAt(base) });

/** A call's envelope to `url`, stating the actuality that the handshake of the host at `url` returns. */
async function rpcBody(url: string, fields: { method: string } & Record<string, unknown>): Promise<string> {
	return JSON.stringify({ jsonrpc: "2.0", protocol: RPC_PROTOCOL, id: "1", params: {}, ...fields, actualityId: await actualityAt(new URL(url).origin) });
}

/** The steps a read of actuality's declarations at `url` shows as callable to its caller, signed by `holder` where one is named. */
async function shownSteps(url: string, holder?: string): Promise<TStepDefinition[]> {
	const body = await rpcBody(url, { method: SHOW_STEP_DEFINITIONS_METHOD, asks: "read" });
	const headers = { "content-type": "application/json" };
	const res = await fetch(url, { method: "POST", headers: holder ? await new FakeInvoker(holder).sign({ method: "POST", url, headers, body }, SHOW_STEPS_ACTION) : headers, body });
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
	return readStepDefinitions(await res.json()).steps.filter((step) => step.callable);
}

/** A call to `method` at `url`, signed by `holder` for `action` where a holder is named, requesting a read at `readingAt`
 *  where it names one. */
async function postRpc(url: string, method: string, signer?: { holder: string; action: string }, readingAt?: string): Promise<Response> {
	const body = await rpcBody(url, { method, seqPath: [0, 1, 1, 1], ...(readingAt ? { readingAt } : {}) });
	const headers = { "content-type": "application/json" };
	return fetch(url, { method: "POST", headers: signer ? await new FakeInvoker(signer.holder).sign({ method: "POST", url, headers, body }, signer.action) : headers, body });
}

/** The level at which a call of `url` read, where the host served it. */
async function readAtLevel(res: Response): Promise<string> {
	const data = (await res.json()) as { at?: string; error?: string };
	if (!res.ok || data.error) throw new Error(`the read was refused: ${res.status} ${JSON.stringify(data)}`);
	return String(data.at);
}

/** Open actuality's event stream at `url`, signed by `holder` for `action` where a holder is named, and return its status. */
async function openStream(base: string, signer?: { holder: string; action: string }): Promise<number> {
	const url = `${base}${SSE_ROUTE}`;
	const headers = { ...(await following(base)), ...(signer ? await new FakeInvoker(signer.holder).sign({ method: "GET", url, headers: {} }, signer.action) : {}) };
	const stopped = new AbortController();
	const res = await fetch(url, { headers, signal: stopped.signal });
	stopped.abort();
	return res.status;
}

/** The id of the event that ends a following: sent last and at the least level, so every follower is sent it, after
 *  every event sent before it that it may read. */
const FOLLOWED_TO_HERE = "followed-to-here";
/** An event at each level, the least private first. */
const SENT_LEVELS = [Access.public, Access.opened, Access.private];

/**
 * Follow actuality's event stream at `url` as `signer`, send an event at each access level through `transport` and then
 * the end marker, and return the levels of the events the follower was sent. The stream subscribes before it responds,
 * so what is sent after the response arrives reaches it.
 */
async function levelsFollowed(base: string, signer: { holder: string; action: string }, transport: ITransport): Promise<string[]> {
	const url = `${base}${SSE_ROUTE}`;
	const headers = { ...(await following(base)), ...(await new FakeInvoker(signer.holder).sign({ method: "GET", url, headers: {} }, signer.action)) };
	const stopped = new AbortController();
	const res = await fetch(url, { headers, signal: stopped.signal });
	if (res.status !== 200 || !res.body) throw new Error(`the stream responded ${res.status}`);
	const event = (id: string, accessLevel: AccessLevel) => LogEvent.parse({ id, timestamp: Date.now(), kind: "log", level: "info", message: id, accessLevel });
	for (const level of SENT_LEVELS) transport.sendEvent(event(level, level));
	transport.sendEvent(event(FOLLOWED_TO_HERE, Access.public));
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	const sent: string[] = [];
	let held = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) throw new Error("the stream ended before the end of the following");
		held += decoder.decode(value, { stream: true });
		const messages = held.split("\n\n");
		held = messages.pop() ?? "";
		for (const message of messages) {
			const data = message.split("\n").find((line) => line.startsWith("data: "));
			if (!data) continue;
			const id = (JSON.parse(data.slice("data: ".length)) as { event: { id: string } }).event.id;
			if (id === FOLLOWED_TO_HERE) {
				stopped.abort();
				return sent;
			}
			sent.push(id);
		}
	}
}

class RpcVerifyStepper extends AStepper {
	description = "Steps that call a run over RPC and check what it returns.";
	cycles = declaresTestDomains();
	private heldStream?: ReadableStreamDefaultReader<Uint8Array>;
	private heldCall?: AsyncGenerator<TStreamChunk>;
	steps = {
		shownStepsPresentingNothing: {
			gwta: `steps shown at {url: ${DOMAIN_LINK}} presenting nothing include {included: ${DOMAIN_STEP_METHOD}}`,
			action: async ({ url, included }: TStepArgs) => {
				const methods = (await shownSteps(String(url))).map((step): string => step.method);
				return methods.includes(String(included)) ? OK : actionNotOK(`"${included}" not in [${methods.join(", ")}]`);
			},
		},
		shownStepsToHolder: {
			gwta: `steps shown at {url: ${DOMAIN_LINK}} to {holder: ${DOMAIN_FAKE_HOLDER}} include {included: ${DOMAIN_STEP_METHOD}} and not {excluded: ${DOMAIN_STEP_METHOD}}`,
			action: async ({ url, holder, included, excluded }: TStepArgs) => {
				const shown = await shownSteps(String(url), String(holder));
				const methods = shown.map((step): string => step.method);
				if (!methods.includes(String(included))) return actionNotOK(`"${included}" not in [${methods.join(", ")}]`);
				return methods.includes(String(excluded)) ? actionNotOK(`"${excluded}" is shown to ${holder}, who may not call it`) : OK;
			},
		},
		rpcCallSucceeds: {
			gwta: `rpc call to {url: ${DOMAIN_LINK}} with method {method: ${DOMAIN_STEP_METHOD}} succeeds`,
			action: async ({ url, method }: TStepArgs) => {
				const res = await fetch(String(url), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: await rpcBody(String(url), { method: String(method), seqPath: [0, 1, 1, 1] }),
				});
				if (!res.ok) return actionNotOK(`HTTP ${res.status}`);
				const data = await res.json();
				if (data.error) return actionNotOK(data.error);
				return OK;
			},
		},
		otherActualityRefused: {
			gwta: `rpc call to {url: ${DOMAIN_LINK}} and its event stream are refused for another actuality, naming the one it holds`,
			action: async ({ url }: TStepArgs) => {
				const base = new URL(String(url)).origin;
				const other = crypto.randomUUID();
				const refused = actualityRefusal(other, await actualityAt(base));
				const body = rpcEnvelope({ id: "1", method: "PingStepper-ping", params: {}, actualityId: other });
				const called = RpcRefusalSchema.parse(await (await fetch(String(url), { method: "POST", headers: { "Content-Type": "application/json" }, body })).json());
				const streamed = await fetch(`${base}${SSE_ROUTE}`, { headers: { [ACTUALITY_HEADER]: other } });
				const streamRefusal = RpcRefusalSchema.parse(await streamed.json());
				if (!refused || !called.error.includes(refused.error) || JSON.stringify(called.remedy) !== JSON.stringify(RELOAD.actuality))
					return actionNotOK(`the call wasn't refused naming the actuality held, offering to read it again: ${JSON.stringify(called)}`);
				return streamed.status === 400 && JSON.stringify(streamRefusal) === JSON.stringify(refused)
					? OK
					: actionNotOK(`the stream responded ${streamed.status}: ${JSON.stringify(streamRefusal)}`);
			},
		},
		rpcReadOfStepRefused: {
			gwta: `rpc read at {url: ${DOMAIN_LINK}} of {method: ${DOMAIN_STEP_METHOD}} is refused`,
			action: async ({ url, method }: TStepArgs) => {
				const res = await fetch(String(url), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: await rpcBody(String(url), { method: String(method), seqPath: [0, 1, 1, 1], asks: "read" }),
				});
				const data = (await res.json()) as { error?: string };
				if (res.status !== REFUSED_CALL_STATUS) return actionNotOK(`served a read of a step that doesn't declare itself a read: HTTP ${res.status}`);
				return typeof data.error === "string" && data.error.includes("does not declare itself one") ? OK : actionNotOK(`refused without stating why: ${JSON.stringify(data)}`);
			},
		},
		rpcReadOfUncallableRefusedAlike: {
			gwta: `rpc read at {url: ${DOMAIN_LINK}} of {method: ${DOMAIN_STEP_METHOD}} without a capability invocation is refused as a call outside its capabilities`,
			action: async ({ url, method }: TStepArgs) => {
				const res = await fetch(String(url), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: await rpcBody(String(url), { method: String(method), seqPath: [0, 1, 1, 1], asks: "read" }),
				});
				const data = (await res.json()) as { error?: string };
				const expected = refusal(String(method), undefined, undefined).error;
				return res.status === REFUSED_CALL_STATUS && data.error === expected ? OK : actionNotOK(`Expected "${expected}", got ${res.status} ${JSON.stringify(data)}`);
			},
		},
		rpcReadOfStepAnswered: {
			gwta: `rpc read at {url: ${DOMAIN_LINK}} of {method: ${DOMAIN_STEP_METHOD}} is answered`,
			action: async ({ url, method }: TStepArgs) => {
				const res = await fetch(String(url), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: await rpcBody(String(url), { method: String(method), seqPath: [0, 1, 1, 1], asks: "read" }),
				});
				const data = (await res.json()) as { error?: string };
				if (!res.ok || data.error) return actionNotOK(`refused a read of a step that declares itself one: ${res.status} ${JSON.stringify(data)}`);
				return OK;
			},
		},
		rpcCallRefusedUnauthenticated: {
			gwta: `rpc call to {url: ${DOMAIN_LINK}} with method {method: ${DOMAIN_STEP_METHOD}} presenting authority without a registered verifier is refused unauthenticated`,
			action: async ({ url, method }: TStepArgs) => {
				const res = await fetch(String(url), {
					method: "POST",
					headers: { "Content-Type": "application/json", "capability-invocation": `zcap capability="urn:uuid:x",action="PingStepper:protected"` },
					body: await rpcBody(String(url), { method: String(method), seqPath: [0, 1, 1, 1] }),
				});
				const data = await res.json();
				if (res.status !== REFUSED_INVOCATION) return actionNotOK(`Expected HTTP ${REFUSED_INVOCATION}, got ${res.status}: ${JSON.stringify(data)}`);
				if (data.pong !== undefined) return actionNotOK(`the step ran: ${JSON.stringify(data)}`);
				return String(data.error).includes("a verifier isn't registered to check it") ? OK : actionNotOK(`Expected the refusal to state why, got ${JSON.stringify(data)}`);
			},
		},
		rpcCallSucceedsSigned: {
			gwta: `rpc call to {url: ${DOMAIN_LINK}} with method {method: ${DOMAIN_STEP_METHOD}} succeeds when signed by {holder: ${DOMAIN_FAKE_HOLDER}} for {action: ${TEST_DOMAIN.action}}`,
			action: async ({ url, method, holder, action }: TStepArgs) => {
				const res = await postRpc(String(url), String(method), { holder: String(holder), action: String(action) });
				if (!res.ok) return actionNotOK(`HTTP ${res.status}: ${await res.text()}`);
				const data = await res.json();
				if (data.error) return actionNotOK(data.error);
				return data.pong === true ? OK : actionNotOK(`Expected the protected ping to return pong, got ${JSON.stringify(data)}`);
			},
		},
		rpcCallDeniedForCapability: {
			gwta: `rpc call to {url: ${DOMAIN_LINK}} with method {method: ${DOMAIN_STEP_METHOD}} is denied for capability {capability: ${TEST_DOMAIN.action}} when signed by {holder: ${DOMAIN_FAKE_HOLDER}} for {action: ${TEST_DOMAIN.action}}`,
			action: async ({ url, method, capability, holder, action }: TStepArgs) => {
				const res = await postRpc(String(url), String(method), { holder: String(holder), action: String(action) });
				const data = await res.json();
				if (res.status !== REFUSED_CALL_STATUS) return actionNotOK(`Expected HTTP ${REFUSED_CALL_STATUS}, got ${res.status}`);
				if (typeof data.error !== "string" || !data.error.includes(`capability ${String(capability)} required`)) {
					return actionNotOK(`Expected capability error, got ${JSON.stringify(data)}`);
				}
				return OK;
			},
		},
		rpcRefusedPresentingNothing: {
			gwta: `rpc call to {url: ${DOMAIN_LINK}} with method {method: ${DOMAIN_STEP_METHOD}} without a capability invocation is refused`,
			action: async ({ url, method }: TStepArgs) => {
				const res = await postRpc(String(url), String(method));
				const data = (await res.json()) as { error?: string; pong?: boolean };
				const expected = refusal(String(method), undefined, undefined).error;
				return res.status === REFUSED_CALL_STATUS && data.error === expected ? OK : actionNotOK(`Expected "${expected}", got ${res.status} ${JSON.stringify(data)}`);
			},
		},
		rpcUnknownSigned: {
			gwta: `rpc call to {url: ${DOMAIN_LINK}} with method {method: ${DOMAIN_STEP_METHOD}} is unknown when signed by {holder: ${DOMAIN_FAKE_HOLDER}} for {action: ${TEST_DOMAIN.action}}`,
			action: async ({ url, method, holder, action }: TStepArgs) => {
				const res = await postRpc(String(url), String(method), { holder: String(holder), action: String(action) });
				const data = (await res.json()) as { error?: string };
				const expected = refusal(String(method), undefined, String(holder)).error;
				return res.status === REFUSED_CALL_STATUS && data.error === expected ? OK : actionNotOK(`Expected "${expected}", got ${res.status} ${JSON.stringify(data)}`);
			},
		},
		probeHolds: {
			gwta: `probe family at {url: ${DOMAIN_LINK}} presenting nothing holds what is allowed and reads at {level: ${TEST_DOMAIN.accessLevel}}`,
			action: async ({ url, level }: TStepArgs) => {
				const answered = (await (await postRpc(String(url), PROBE_METHOD)).json()) as { held?: unknown; at?: string };
				const held = [answered.held].flat();
				return held.includes(PROBE_ACTION) && answered.at === String(level) ? OK : actionNotOK(`held ${JSON.stringify(answered)}`);
			},
		},
		rpcReadsAtPresentingNothing: {
			gwta: `rpc read at {url: ${DOMAIN_LINK}} presenting nothing reads at {level: ${TEST_DOMAIN.accessLevel}}`,
			action: async ({ url, level }: TStepArgs) => {
				const at = await readAtLevel(await postRpc(String(url), "PingStepper-readsAt"));
				return at === String(level) ? OK : actionNotOK(`read at ${at}`);
			},
		},
		rpcReadsAtSigned: {
			gwta: `rpc read at {url: ${DOMAIN_LINK}} signed by {holder: ${DOMAIN_FAKE_HOLDER}} for {action: ${TEST_DOMAIN.action}} reads at {level: ${TEST_DOMAIN.accessLevel}}`,
			action: async ({ url, holder, action, level }: TStepArgs) => {
				const at = await readAtLevel(await postRpc(String(url), "PingStepper-readsAt", { holder: String(holder), action: String(action) }));
				return at === String(level) ? OK : actionNotOK(`read at ${at}`);
			},
		},
		rpcReadsAtAsked: {
			gwta: `rpc read asking for {asked: ${TEST_DOMAIN.accessLevel}} at {url: ${DOMAIN_LINK}} signed by {holder: ${DOMAIN_FAKE_HOLDER}} for {action: ${TEST_DOMAIN.action}} reads at {level: ${TEST_DOMAIN.accessLevel}}`,
			action: async ({ url, holder, action, asked, level }: TStepArgs) => {
				const at = await readAtLevel(await postRpc(String(url), "PingStepper-readsAt", { holder: String(holder), action: String(action) }, String(asked)));
				return at === String(level) ? OK : actionNotOK(`read at ${at}`);
			},
		},
		streamAnswers: {
			gwta: `event stream at {url: ${DOMAIN_LINK}} presenting nothing answers {status: ${DOMAIN_NUMBER}}`,
			action: async ({ url, status }: TStepArgs) => {
				const answered = await openStream(String(url));
				return answered === Number(status) ? OK : actionNotOK(`responded ${answered}`);
			},
		},
		streamAnswersSigned: {
			gwta: `event stream at {url: ${DOMAIN_LINK}} signed by {holder: ${DOMAIN_FAKE_HOLDER}} for {action: ${TEST_DOMAIN.action}} answers {status: ${DOMAIN_NUMBER}}`,
			action: async ({ url, holder, action, status }: TStepArgs) => {
				const answered = await openStream(String(url), { holder: String(holder), action: String(action) });
				return answered === Number(status) ? OK : actionNotOK(`responded ${answered}`);
			},
		},
		streamSendsLevels: {
			gwta: `event stream at {url: ${DOMAIN_LINK}} signed by {holder: ${DOMAIN_FAKE_HOLDER}} for {action: ${TEST_DOMAIN.action}} is sent the events at {levels: ${TEST_DOMAIN.accessLevels}}`,
			action: async ({ url, holder, action, levels }: TStepArgs) => {
				const transport = this.getWorld().runtime[TRANSPORT] as ITransport;
				const sent = await levelsFollowed(String(url), { holder: String(holder), action: String(action) }, transport);
				return sent.join(",") === String(levels) ? OK : actionNotOK(`the follower was sent the events at levels [${sent.join(",")}]`);
			},
		},
		holdEventStream: {
			gwta: `event stream at {url: ${DOMAIN_LINK}} signed by {holder: ${DOMAIN_FAKE_HOLDER}} for {action: ${TEST_DOMAIN.action}} is held open`,
			action: async ({ url, holder, action }: TStepArgs) => {
				const at = `${String(url)}${SSE_ROUTE}`;
				const headers = { ...(await following(String(url))), ...(await new FakeInvoker(String(holder)).sign({ method: "GET", url: at, headers: {} }, String(action))) };
				const res = await fetch(at, { headers });
				if (res.status !== 200 || !res.body) return actionNotOK(`the stream responded ${res.status}`);
				this.heldStream = res.body.getReader();
				return OK;
			},
		},
		heldEventStreamEnds: {
			gwta: "held event stream ends",
			action: async () => {
				const reader = this.heldStream;
				if (!reader) return actionNotOK("an event stream isn't held");
				while (!(await reader.read()).done);
				return OK;
			},
		},
		holdStreamedCall: {
			gwta: `streamed call at {url: ${DOMAIN_LINK}} to {method: ${DOMAIN_STEP_METHOD}} signed by {holder: ${DOMAIN_FAKE_HOLDER}} for {action: ${TEST_DOMAIN.action}} is held open`,
			action: async ({ url, method, holder, action }: TStepArgs) => {
				const body = await rpcBody(String(url), { method: String(method), seqPath: [0, 1, 1, 1], stream: true });
				const headers = { "content-type": "application/json" };
				const res = await fetch(String(url), {
					method: "POST",
					headers: await new FakeInvoker(String(holder)).sign({ method: "POST", url: String(url), headers, body }, String(action)),
					body,
				});
				if (!res.body) return actionNotOK(`the call responded ${res.status} without a stream`);
				this.heldCall = readNdjson<TStreamChunk>(res.body);
				const first = await this.heldCall.next();
				return first.value?.status === "held" ? OK : actionNotOK(`the call was not held open: ${JSON.stringify(first.value)}`);
			},
		},
		heldCallEnds: {
			gwta: `held streamed call ends with {reason: ${DOMAIN_TEXT}}`,
			action: async ({ reason }: TStepArgs) => {
				if (!this.heldCall) return actionNotOK("a streamed call isn't held");
				const rest: TStreamChunk[] = [];
				for await (const chunk of this.heldCall) rest.push(chunk);
				return rest.at(-1)?.error === String(reason) ? OK : actionNotOK(`ended with ${JSON.stringify(rest)}`);
			},
		},
		rpcOldFormatIgnored: {
			gwta: `rpc old format to {url: ${DOMAIN_LINK}} is not dispatched`,
			action: async ({ url }: TStepArgs) => {
				const res = await fetch(String(url), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ type: "rpc", id: "1", method: SHOW_STEPS_METHOD, params: {} }),
				});
				const data = await res.json();
				// The old format doesn't parse as a JSON-RPC 2.0 request, so it is refused and a handler doesn't process it.
				if ("steps" in data) return actionNotOK("the old format was dispatched");
				return OK;
			},
		},
	};
}

/** A server on `port` that serves RPC, where every caller holds `allowedWithoutDelegation`, where the case states it: an empty list otherwise. */
function makeOptions(port: number, allowedWithoutDelegation?: string) {
	return {
		...DEF_PROTO_OPTIONS,
		moduleOptions: {
			[getStepperOptionName(WebServerStepper, "PORT")]: String(port),
			[getStepperOptionName(WebServerStepper, "RPC")]: "true",
			...(allowedWithoutDelegation ? { [getStepperOptionName(WebServerStepper, "ALLOW_WITHOUT_DELEGATION")]: allowedWithoutDelegation } : {}),
		},
	};
}

/** What actuality narrated about the calls it served, so a case can state which of them it narrates. */
const narrated: string[] = [];

class ReadStepper extends AStepper {
	description = "A step that declares itself a read, and a step that checks which RPC calls actuality narrated.";
	override async setWorld(world: Parameters<AStepper["setWorld"]>[0], steppers: Parameters<AStepper["setWorld"]>[1]) {
		await super.setWorld(world, steppers);
		narrated.length = 0;
		world.eventLogger.subscribe(
			(event) => {
				const said = (event as { message?: unknown }).message;
				if (typeof said === "string" && said.startsWith("RPC: ")) narrated.push(said);
			},
			{ kinds: ["log"] },
		);
	}

	steps = {
		asked: { gwta: "run is asked what it holds", read: true, readsAt: Access.public, action: () => Promise.resolve(OK) },
		narratedCalls: {
			gwta: "run narrated the call that acted on it and not the call that read it",
			action: () => {
				const named = (method: string) => narrated.filter((line) => line.includes(method)).length;
				if (named("ReadStepper-asked") > 0) return Promise.resolve(actionNotOK(`serving a read was narrated: ${JSON.stringify(narrated)}`));
				return Promise.resolve(named("PingStepper-ping") > 0 ? OK : actionNotOK(`serving an act was not narrated: ${JSON.stringify(narrated)}`));
			},
		},
	};
}

const NOTICE_LABEL = "TestNotice";
const NOTICE_ID = "notice-1";
const NOTICE_COUNT_ACTION = "NoticeStepper:count";
const NOTICE_COUNT_METHOD = "NoticeStepper-countNotices";
const STORE_READ_METHOD = `${STORE_METHOD_PREFIX}readRecords`;
const READS_PUBLIC = readAction(Access.public);

/** A public record, a step that counts its records without declaring itself a read, and the requests that read them. */
class NoticeStepper extends AStepper {
	description = "Holds a public notice and reads it through a step and through the store's protocol.";
	cycles = {
		getConcerns: () => ({
			domains: [
				{
					selectors: ["test-notice"],
					schema: PersistedVertexSchema.extend({ id: z.string() }),
					description: "A notice anyone may read",
					topology: { persistedAs: NOTICE_LABEL, id: "id", accessLevel: Access.public, properties: { id: LinkRelations.IDENTIFIER.rel } },
				},
			],
		}),
	};
	steps = {
		holdsNotice: {
			exact: "public notice is held",
			action: async () => {
				await this.getWorld().shared.getStore().upsertIndividual(NOTICE_LABEL, { id: NOTICE_ID });
				return OK;
			},
		},
		countNotices: {
			exact: "count the notices",
			capability: NOTICE_COUNT_ACTION,
			productsDomain: TEST_DOMAIN.count,
			action: async () =>
				actionOKWithProducts({
					count: (
						await this.getWorld()
							.shared.getStore()
							.readRecords(GraphQuerySchema.parse({ label: NOTICE_LABEL }))
					).vertices.length,
				}),
		},
		refusedWithoutRead: {
			gwta: `rpc call to {url: ${DOMAIN_LINK}} without a capability invocation is refused with the read action it lacks`,
			action: async ({ url }: TStepArgs) => {
				const method = String(url).slice(String(url).lastIndexOf("/") + 1);
				const params = method === STORE_READ_METHOD ? { query: { label: NOTICE_LABEL } } : {};
				const res = await fetch(String(url), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: await rpcBody(String(url), { method, seqPath: [0, 1, 1, 1], params }),
				});
				const text = await res.text();
				if (text.includes(NOTICE_ID) || text.includes('"count":1')) return actionNotOK(`a caller without a read action read the notice: ${res.status} ${text}`);
				const remedy = RpcRefusalSchema.safeParse(JSON.parse(text)).data?.remedy;
				return remedy?.do === "request" && remedy.action === READS_PUBLIC ? OK : actionNotOK(`the refusal doesn't request ${READS_PUBLIC}: ${res.status} ${text}`);
			},
		},
	};
}

const steppers = [WebServerStepper, PingStepper, RpcVerifyStepper, ReadStepper, Haibun, LogicStepper];
/** The steppers with a stand-in authority, for a case whose caller signs what it calls. */
const signedSteppers = [AuthorityStepper, FakeAuthorityStepper, ...steppers];

describe("RPC dispatch via WebServerStepper", () => {
	it("refuses each read of records to a caller that doesn't hold a read action, through a step and through the store's protocol", async () => {
		const port = await freePort();
		const base = `http://localhost:${port}/rpc`;
		const feature = {
			path: "/features/test.feature",
			content: `
webserver is listening for "rpc-without-read"
public notice is held
rpc call to "${base}/${NOTICE_COUNT_METHOD}" without a capability invocation is refused with the read action it lacks
rpc call to "${base}/${STORE_READ_METHOD}" without a capability invocation is refused with the read action it lacks
`,
		};
		const result = await passWithDefaults([feature], [...steppers, NoticeStepper], makeOptions(port, `${NOTICE_COUNT_ACTION},${STORE_READ}`));
		expect(result.ok, JSON.stringify(result.failure)).toBe(true);
	});

	it("refuses a call and a stream that state another actuality than the one the instance holds", async () => {
		const port = await freePort();
		const feature = {
			path: "/features/test.feature",
			content: `
webserver is listening for "other-actuality"
rpc call to "http://localhost:${port}/rpc/PingStepper-ping" and its event stream are refused for another actuality, naming the one it holds
`,
		};
		const result = await passWithDefaults([feature], steppers, makeOptions(port, `PingStepper:ping,${FOLLOWS_THE_RUN}`));
		expect(result.ok, JSON.stringify(result.featureResults?.[0]?.stepResults.filter((step) => !step.ok))).toBe(true);
	});

	it("does not narrate serving a read, since a page reading actuality would read again for its own reading", async () => {
		const port = await freePort();
		const feature = {
			path: "/features/test.feature",
			content: `
webserver is listening for "rpc-read-narration"
rpc call to "http://localhost:${port}/rpc/ReadStepper-asked" with method "ReadStepper-asked" succeeds
rpc call to "http://localhost:${port}/rpc/PingStepper-ping" with method "PingStepper-ping" succeeds
run narrated the call that acted on it and not the call that read it
`,
		};
		const result = await passWithDefaults([feature], steppers, makeOptions(port, "PingStepper:ping,Read:public"));
		expect(result.ok).toBe(true);
	});

	it("serves a read of a step that declares itself one, and refuses a read of a step that doesn't", async () => {
		// A read is served and doesn't leave a record of the reading, so the step itself declares what may be read that way.
		// Actuality refuses a read of a step that doesn't declare itself a read, rather than serving it and recording the reading
		// as something it did. Such a record would write about being read for as long as a page follows it.
		const port = await freePort();
		const feature = {
			path: "/features/test.feature",
			content: `
webserver is listening for "rpc-asks-read"
rpc read at "http://localhost:${port}/rpc/ReadStepper-asked" of "ReadStepper-asked" is answered
rpc read at "http://localhost:${port}/rpc/PingStepper-ping" of "PingStepper-ping" is refused
rpc read at "http://localhost:${port}/rpc/PingStepper-protectedRpcPing" of "PingStepper-protectedRpcPing" without a capability invocation is refused as a call outside its capabilities
rpc read at "http://localhost:${port}/rpc/Nowhere-nothing" of "Nowhere-nothing" without a capability invocation is refused as a call outside its capabilities
`,
		};
		const result = await passWithDefaults([feature], steppers, makeOptions(port, "PingStepper:ping,Read:public"));
		expect(result.ok).toBe(true);
	});

	it("refuses a call presenting authority that actuality can't verify, as unauthenticated, and doesn't run a step", async () => {
		// A proof that isn't checked doesn't grant an action, and a request running with an empty grant would still run every
		// step that doesn't require a capability, so a request presenting one is refused whole.
		const port = await freePort();
		const feature = {
			path: "/features/test.feature",
			content: `
webserver is listening for "rpc-unverified-proof"
rpc call to "http://localhost:${port}/rpc/PingStepper-ping" with method "PingStepper-ping" presenting authority without a registered verifier is refused unauthenticated
`,
		};
		const result = await passWithDefaults([feature], steppers, makeOptions(port));
		expect(result.ok).toBe(true);
	});

	it("refuses to end the instance for a caller that doesn't present authority, since ending it takes WebServer:stop", async () => {
		const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
		try {
			const port = await freePort();
			const feature = {
				path: "/features/test.feature",
				content: `
webserver is listening for "rpc-stop-refused"
rpc call to "http://localhost:${port}/rpc/WebServerStepper-stopInstance" with method "WebServerStepper-stopInstance" without a capability invocation is refused
`,
			};
			const result = await passWithDefaults([feature], steppers, makeOptions(port));
			expect(result.ok).toBe(true);
			await new Promise((r) => setTimeout(r, 150));
			expect(kill, "the process is never signalled").not.toHaveBeenCalled();
		} finally {
			kill.mockRestore();
		}
	});

	it("executes a step via RPC", async () => {
		const port = await freePort();
		const feature = {
			path: "/features/test.feature",
			content: `
webserver is listening for "rpc-step-exec"
rpc call to "http://localhost:${port}/rpc/PingStepper-ping" with method "PingStepper-ping" succeeds
`,
		};
		const result = await passWithDefaults([feature], steppers, makeOptions(port, "PingStepper:ping"));
		expect(result.ok).toBe(true);
	});

	it("refuses a caller that doesn't present authority every step, alike whether the step exists, so a refusal doesn't map actuality", async () => {
		const port = await freePort();
		const feature = {
			path: "/features/test.feature",
			content: `
webserver is listening for "rpc-deny-by-default"
rpc call to "http://localhost:${port}/rpc/PingStepper-ping" with method "PingStepper-ping" without a capability invocation is refused
rpc call to "http://localhost:${port}/rpc/PingStepper-readsAt" with method "PingStepper-readsAt" without a capability invocation is refused
rpc call to "http://localhost:${port}/rpc/Nowhere-nothing" with method "Nowhere-nothing" without a capability invocation is refused
rpc call to "http://localhost:${port}/rpc/${SHOW_STEPS_METHOD}" with method "${SHOW_STEPS_METHOD}" without a capability invocation is refused
`,
		};
		const result = await passWithDefaults([feature], steppers, makeOptions(port));
		expect(result.ok, "and a caller that doesn't hold an action can't call a step, even the list of steps").toBe(true);
	});

	it("grants every caller what the deployment allows without a delegation, beside what it proves", async () => {
		const port = await freePort();
		const feature = {
			path: "/features/test.feature",
			content: `
webserver is listening for "rpc-allowed-without-delegation"
accept authority from "agent" for "PingStepper:protected"
rpc call to "http://localhost:${port}/rpc/PingStepper-ping" with method "PingStepper-ping" succeeds
rpc call to "http://localhost:${port}/rpc/PingStepper-protectedPing" with method "PingStepper-protectedPing" succeeds when signed by "agent" for "PingStepper:protected"
rpc call to "http://localhost:${port}/rpc/PingStepper-adminPing" with method "PingStepper-adminPing" without a capability invocation is refused
`,
		};
		const result = await passWithDefaults([feature], signedSteppers, makeOptions(port, "PingStepper:ping"));
		expect(result.ok).toBe(true);
	});

	it("runs a protocol method under what the call presented and at the level it reads, as a dispatched step runs", async () => {
		const port = await freePort();
		const feature = {
			path: "/features/test.feature",
			content: `
webserver is listening for "rpc-family-authority"
serve the probe family
probe family at "http://localhost:${port}/rpc/${PROBE_METHOD}" presenting nothing holds what is allowed and reads at "public"
`,
		};
		const result = await passWithDefaults([feature], signedSteppers, makeOptions(port, `${PROBE_ACTION},Read:public`));
		expect(result.ok, JSON.stringify(result.failure ?? "")).toBe(true);
	});

	it("bounds what a caller reads by the broadest read it holds, and by the level it requests, which can only be narrower", async () => {
		const port = await freePort();
		const url = `http://localhost:${port}/rpc/PingStepper-readsAt`;
		const feature = {
			path: "/features/test.feature",
			content: `
webserver is listening for "rpc-read-ceiling"
accept authority from "owner" for "Read:private"
rpc read at "${url}" presenting nothing reads at "public"
rpc read at "${url}" signed by "owner" for "Read:private" reads at "private"
rpc read asking for "public" at "${url}" signed by "owner" for "Read:private" reads at "public"
`,
		};
		const result = await passWithDefaults([feature], signedSteppers, makeOptions(port, "Read:public"));
		expect(result.ok).toBe(true);
	});

	it("opens actuality's event stream to a caller holding a read, and sends each follower the events it may read at their level", async () => {
		const port = await freePort();
		const url = `http://localhost:${port}`;
		const feature = {
			path: "/features/test.feature",
			content: `
webserver is listening for "sse-gated"
accept authority from "owner" for "Read:private"
accept authority from "member" for "Read:opened"
accept authority from "reader" for "Read:public"
accept authority from "agent" for "PingStepper:protected"
accept authority from "keeper" for "Read:public, Read:private"
event stream at "${url}" presenting nothing answers 403
event stream at "${url}" signed by "agent" for "PingStepper:protected" answers 403
event stream at "${url}" signed by "reader" for "Read:public" is sent the events at "public"
event stream at "${url}" signed by "member" for "Read:opened" is sent the events at "public,opened"
event stream at "${url}" signed by "owner" for "Read:private" is sent the events at "public,opened,private"
event stream at "${url}" signed by "keeper" for "Read:public" is sent the events at "public,opened,private"
`,
		};
		const result = await passWithDefaults([feature], signedSteppers, makeOptions(port));
		expect(result.ok).toBe(true);
	});

	it("ends a follower's event stream and a streamed call once the authority each was opened under is withdrawn, stating why", async () => {
		const port = await freePort();
		const base = `http://localhost:${port}`;
		const feature = {
			path: "/features/test.feature",
			content: `
webserver is listening for "lapsing"
accept authority from "owner" for "Read:private"
accept authority from "agent" for "PingStepper:protected"
event stream at "${base}" signed by "owner" for "Read:private" is held open
streamed call at "${base}/rpc/PingStepper-holdOpen" to "PingStepper-holdOpen" signed by "agent" for "PingStepper:protected" is held open
withdraw authority from "owner"
held event stream ends
event stream at "${base}" signed by "owner" for "Read:private" answers ${REFUSED_INVOCATION}
withdraw authority from "agent"
held streamed call ends with "${fakeGrant("agent")} was revoked"
`,
		};
		const result = await passWithDefaults([feature], signedSteppers, makeOptions(port));
		expect(result.ok, JSON.stringify(result.featureResults?.[0]?.stepResults?.filter((step) => !step.ok))).toBe(true);
	});

	it("rejects old-format RPC envelope", async () => {
		const port = await freePort();
		const feature = {
			path: "/features/test.feature",
			content: `
webserver is listening for "rpc-old-format"
rpc old format to "http://localhost:${port}/rpc/${SHOW_STEPS_METHOD}" is not dispatched
`,
		};
		const result = await passWithDefaults([feature], steppers, makeOptions(port));
		expect(result.ok).toBe(true);
	});

	it("shows a caller the steps it holds what they require for, and not the steps it may not call", async () => {
		const port = await freePort();
		const feature = {
			path: "/features/shown-steps.feature",
			content: `
webserver is listening for "rpc-shown-steps"
accept authority from "agent" for "PingStepper:protected,Read:public"
steps shown at "http://localhost:${port}/rpc/${SHOW_STEP_DEFINITIONS_METHOD}" to "agent" include "PingStepper-protectedPing" and not "PingStepper-adminPing"
rpc call to "http://localhost:${port}/rpc/PingStepper-adminPing" with method "PingStepper-adminPing" is denied for capability "PingStepper:admin" when signed by "agent" for "PingStepper:protected"
`,
		};
		const result = await passWithDefaults([feature], signedSteppers, makeOptions(port));
		expect(result.ok).toBe(true);
	});

	it("shows and dispatches a step injected into actuality's registry after rpc is enabled, as every other caller of actuality does", async () => {
		const port = await freePort();
		class Injects extends AStepper {
			description = "A step that copies a step into actuality's registry under another name, as a transport injects one.";
			steps = {
				injectAStep: {
					gwta: "inject a step into actuality's registry",
					action: () => {
						const registry = this.getWorld().runtime.stepRegistry;
						const ping = registry?.get("PingStepper-ping");
						if (!registry || !ping) return Promise.resolve(actionNotOK("actuality doesn't hold a ping to copy"));
						registry.inject([{ ...ping, descriptor: { ...ping.descriptor, method: StepMethodSchema.parse("Injected-ping"), stepperName: "Injected", stepName: "ping" } }]);
						return Promise.resolve(OK);
					},
				},
			};
		}
		const feature = {
			path: "/features/injected.feature",
			content: `
webserver is listening for "rpc-injected"
inject a step into actuality's registry
steps shown at "http://localhost:${port}/rpc/${SHOW_STEP_DEFINITIONS_METHOD}" presenting nothing include "Injected-ping"
rpc call to "http://localhost:${port}/rpc/Injected-ping" with method "Injected-ping" succeeds
`,
		};
		const result = await passWithDefaults([feature], [...steppers, Injects], makeOptions(port, "PingStepper:ping,Read:public"));
		expect(result.ok).toBe(true);
	});

	it("action.begin allocates a unique seqPath root per call", async () => {
		const port = await freePort();
		let first: number[] | undefined;
		let second: number[] | undefined;

		class BeginActionStepper extends AStepper {
			description = "Begins an action over RPC twice, keeping the seqPath each response states.";
			steps = {
				callBeginActionTwice: {
					gwta: `begin action twice at {url: ${DOMAIN_LINK}}`,
					action: async ({ url }: { url: string }) => {
						const u = String(url);
						const body = rpcEnvelope({ id: "1", method: ACTION_BEGIN, params: {} });
						const headers = { "Content-Type": "application/json" };
						const r1 = (await (await fetch(u, { method: "POST", headers, body })).json()) as Record<string, unknown>;
						const r2 = (await (await fetch(u, { method: "POST", headers, body })).json()) as Record<string, unknown>;
						first = Array.isArray(r1.seqPath) ? (r1.seqPath as number[]) : undefined;
						second = Array.isArray(r2.seqPath) ? (r2.seqPath as number[]) : undefined;
						return OK;
					},
				},
			};
		}

		const feature = {
			path: "/features/begin-action.feature",
			content: `
webserver is listening for "rpc-begin-action"
begin action twice at "http://localhost:${port}/rpc/${ACTION_BEGIN}"
`,
		};
		const r = await passWithDefaults([feature], [WebServerStepper, PingStepper, BeginActionStepper, LogicStepper], makeOptions(port));
		expect(r.ok).toBe(true);
		if (!first || !second) throw new Error("begin action did not return seqPaths");
		expect(first.length).toBeGreaterThan(0);
		expect(first.join(".")).not.toBe(second.join("."));
	});

	it("synthesises a seqPath when the caller omits one", async () => {
		const port = await freePort();
		let rpcResponse: Record<string, unknown> | undefined;

		class MissingSeqPathStepper extends AStepper {
			description = "Makes an RPC call that doesn't state a seqPath.";
			steps = {
				callWithoutSeqPath: {
					gwta: `rpc call to {url: ${DOMAIN_LINK}} without seqPath succeeds`,
					action: async ({ url }: { url: string }) => {
						const res = await fetch(String(url), {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: await rpcBody(String(url), { method: "PingStepper-ping" }),
						});
						rpcResponse = (await res.json()) as Record<string, unknown>;
						return OK;
					},
				},
			};
		}

		const feature = {
			path: "/features/missing-seqpath.feature",
			content: `
webserver is listening for "rpc-missing-seqpath"
rpc call to "http://localhost:${port}/rpc/PingStepper-ping" without seqPath succeeds
`,
		};
		const r = await passWithDefaults([feature], [WebServerStepper, PingStepper, MissingSeqPathStepper, LogicStepper], makeOptions(port, "PingStepper:ping"));
		expect(r.ok).toBe(true);
		// External callers without a feature-step context get a server-synthesised seqPath; the call succeeds.
		expect(rpcResponse?.error).toBeUndefined();
		expect(rpcResponse?.pong).toBe(true);
	});

	it("denies protected RPC steps without capability and allows them with capability", async () => {
		const port = await freePort();
		const feature = {
			path: "/features/protected-rpc.feature",
			content: `
webserver is listening for "rpc-protected-step"
accept authority from "agent" for "PingStepper:protected"
rpc call to "http://localhost:${port}/rpc/PingStepper-protectedPing" with method "PingStepper-protectedPing" without a capability invocation is refused
rpc call to "http://localhost:${port}/rpc/Nowhere-nothing" with method "Nowhere-nothing" is unknown when signed by "agent" for "PingStepper:protected"
rpc call to "http://localhost:${port}/rpc/PingStepper-protectedPing" with method "PingStepper-protectedPing" succeeds when signed by "agent" for "PingStepper:protected"
`,
		};
		const result = await passWithDefaults([feature], signedSteppers, makeOptions(port));
		expect(result.ok).toBe(true);
	});

	it("keeps what a signed caller may do least-privilege: a verified action opens only the steps that take it", async () => {
		const port = await freePort();
		const feature = {
			path: "/features/rpc-least-privilege.feature",
			content: `
webserver is listening for "rpc-least-privilege"
accept authority from "agent" for "PingStepper:protected"
rpc call to "http://localhost:${port}/rpc/PingStepper-protectedPing" with method "PingStepper-protectedPing" succeeds when signed by "agent" for "PingStepper:protected"
rpc call to "http://localhost:${port}/rpc/PingStepper-adminPing" with method "PingStepper-adminPing" is denied for capability "PingStepper:admin" when signed by "agent" for "PingStepper:protected"
`,
		};
		const result = await passWithDefaults([feature], signedSteppers, makeOptions(port));
		expect(result.ok).toBe(true);
	});

	it("authorizes a signed call for the action it invokes, and not for another its holder holds", async () => {
		const port = await freePort();
		const feature = {
			path: "/features/rpc-invoked-action.feature",
			content: `
webserver is listening for "rpc-invoked-action"
accept authority from "agent" for "PingStepper:protected, PingStepper:admin"
rpc call to "http://localhost:${port}/rpc/PingStepper-protectedPing" with method "PingStepper-protectedPing" succeeds when signed by "agent" for "PingStepper:protected"
rpc call to "http://localhost:${port}/rpc/PingStepper-adminPing" with method "PingStepper-adminPing" is denied for capability "PingStepper:admin" when signed by "agent" for "PingStepper:protected"
`,
		};
		const result = await passWithDefaults([feature], signedSteppers, makeOptions(port));
		expect(result.ok).toBe(true);
	});

	it("stream:true routes through dispatchStep, chunks flow via streamContext, errors land on seqPath", async () => {
		const port = await freePort();
		const collectedChunks: TStreamChunk[] = [];

		class StreamingStepper extends AStepper {
			description = "Emits three streaming chunks, or refuses the stream.";
			steps = {
				stream3: {
					gwta: "emit three streaming chunks",
					action: () => {
						const sctx = streamContext.getStore();
						sctx?.emit({ status: "starting" });
						sctx?.emit({ text: "alpha" });
						sctx?.emit({ text: "beta" });
						return OK;
					},
				},
				failStream: { gwta: "stream that refuses", action: () => actionNotOK("stream refused") },
			};
		}

		class StreamingRpcVerifyStepper extends AStepper {
			description = "Makes a streaming RPC call and checks its chunks arrive.";
			steps = {
				streamChunksArrive: {
					gwta: `stream rpc call to {url: ${DOMAIN_LINK}} method {method: ${DOMAIN_STEP_METHOD}} emits chunks`,
					action: async ({ url, method }: TStepArgs) => {
						const res = await fetch(String(url), {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: await rpcBody(String(url), { method: String(method), seqPath: [0, 1, 1, 1], stream: true }),
						});
						if (!res.ok) return actionNotOK(`HTTP ${res.status}`);
						if (!res.body) return actionNotOK("the response doesn't have a body");
						const reader = res.body.getReader();
						const decoder = new TextDecoder();
						let buf = "";
						while (true) {
							const { done, value } = await reader.read();
							if (done) break;
							buf += decoder.decode(value, { stream: true });
							const lines = buf.split("\n");
							buf = lines.pop() ?? "";
							for (const line of lines) {
								if (!line.trim()) continue;
								collectedChunks.push(JSON.parse(line) as TStreamChunk);
							}
						}
						return OK;
					},
				},
			};
		}

		const feature = {
			path: "/features/stream-rpc.feature",
			content: `
webserver is listening for "stream-rpc"
stream rpc call to "http://localhost:${port}/rpc/StreamingStepper-stream3" method "StreamingStepper-stream3" emits chunks
`,
		};
		const result = await passWithDefaults([feature], [WebServerStepper, StreamingStepper, StreamingRpcVerifyStepper, LogicStepper], makeOptions(port, "StreamingStepper:stream3"));
		expect(result.ok).toBe(true);
		// All three streamed chunks arrived via streamContext.emit; the stream doesn't hold a terminal "products" record because dispatch was OK.
		expect(collectedChunks).toEqual([{ status: "starting" }, { text: "alpha" }, { text: "beta" }]);
	});

	it("stream:true refusal emits a single terminating {error} record naming the step once, whether the step refused or threw", async () => {
		const port = await freePort();
		const collectedChunks: Record<string, unknown>[] = [];

		class StreamingStepper extends AStepper {
			description = "Refuses a stream, or fails it with an error.";
			steps = {
				refuse: { gwta: "refuse the stream", action: () => actionNotOK("nope") },
				fail: {
					gwta: "fail the stream",
					action: () => {
						throw new Error("broke");
					},
				},
			};
		}

		class StreamingErrorVerifyStepper extends AStepper {
			description = "Makes a streaming RPC call and checks it ends with an error.";
			steps = {
				streamErrorArrives: {
					gwta: `stream rpc call to {url: ${DOMAIN_LINK}} method {method: ${DOMAIN_STEP_METHOD}} emits an error`,
					action: async ({ url, method }: TStepArgs) => {
						const res = await fetch(String(url), {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: await rpcBody(String(url), { method: String(method), seqPath: [0, 1, 1, 1], stream: true }),
						});
						if (!res.body) return actionNotOK("the response doesn't have a body");
						const reader = res.body.getReader();
						const decoder = new TextDecoder();
						let buf = "";
						while (true) {
							const { done, value } = await reader.read();
							if (done) break;
							buf += decoder.decode(value, { stream: true });
							const lines = buf.split("\n");
							buf = lines.pop() ?? "";
							for (const line of lines) {
								if (!line.trim()) continue;
								collectedChunks.push(JSON.parse(line) as Record<string, unknown>);
							}
						}
						return OK;
					},
				},
			};
		}

		const feature = {
			path: "/features/stream-rpc-error.feature",
			content: `
webserver is listening for "stream-rpc-error"
stream rpc call to "http://localhost:${port}/rpc/StreamingStepper-refuse" method "StreamingStepper-refuse" emits an error
stream rpc call to "http://localhost:${port}/rpc/StreamingStepper-fail" method "StreamingStepper-fail" emits an error
`,
		};
		const result = await passWithDefaults(
			[feature],
			[WebServerStepper, StreamingStepper, StreamingErrorVerifyStepper, LogicStepper],
			makeOptions(port, "StreamingStepper:refuse,StreamingStepper:fail"),
		);
		expect(result.ok).toBe(true);
		expect(collectedChunks.map((chunk) => chunk.error)).toEqual(["StreamingStepper-refuse: nope", "StreamingStepper-fail: the step threw: broke"]);
	});
});
