// @vitest-environment jsdom
// Both implementations of the page's conduit, held to one specification: the live one over /rpc, and the one a test
// installs to answer from its own function.
import { LiveConduit, type TStreamChunk } from "./hypermedia.js";
import { TestConduit } from "./test-setup.js";
import { describeConduit, type TConduitUnderTest } from "./test/conduit-conformance.js";

type TArranged = { answer?: unknown; failure?: string; chunks?: TStreamChunk[] };

/** What a case arranged, by method, and what the steps were asked: the part both harnesses share. */
function arrangements(): {
	of: (method: string) => TArranged;
	asked: () => Array<{ method: string; params: Record<string, unknown> }>;
	record: (method: string, params: Record<string, unknown>) => void;
	answers: TConduitUnderTest["answers"];
	fails: TConduitUnderTest["fails"];
	streams: TConduitUnderTest["streams"];
} {
	const by = new Map<string, TArranged>();
	const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
	return {
		of: (method) => by.get(method) ?? {},
		asked: () => calls,
		record: (method, params) => calls.push({ method, params }),
		answers: (method, answer) => by.set(method, { answer }),
		fails: (method, failure) => by.set(method, { failure }),
		streams: (method, chunks) => by.set(method, { chunks }),
	};
}

describeConduit("answering from a test's own function", () => {
	const arranged = arrangements();
	const conduit = new TestConduit((method, params) => {
		arranged.record(method, params);
		const one = arranged.of(method);
		if (one.failure !== undefined) throw new Error(one.failure);
		if (one.chunks !== undefined) return one.chunks;
		return one.answer;
	});
	return { conduit, ...arranged };
});

const line = (chunk: unknown): Uint8Array => new TextEncoder().encode(`${JSON.stringify(chunk)}\n`);

describeConduit("over a running service", () => {
	const arranged = arrangements();
	const fetchWas = globalThis.fetch;
	globalThis.fetch = ((url: string, init: { body: string }) => {
		const envelope = JSON.parse(init.body) as { method: string; params: Record<string, unknown> };
		if (envelope.method === "action.begin") return Promise.resolve({ ok: true, status: 200, json: async () => ({ seqPath: [1] }) });
		arranged.record(envelope.method, envelope.params);
		const one = arranged.of(envelope.method);
		if (one.failure !== undefined) return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: one.failure }) });
		if (one.chunks !== undefined) {
			return Promise.resolve({
				ok: true,
				status: 200,
				body: new ReadableStream<Uint8Array>({
					start(control) {
						for (const chunk of one.chunks ?? []) control.enqueue(line(chunk));
						control.close();
					},
				}),
			});
		}
		return Promise.resolve({ ok: true, status: 200, json: async () => one.answer });
	}) as unknown as typeof globalThis.fetch;
	return {
		conduit: new LiveConduit(),
		...arranged,
		done: () => {
			globalThis.fetch = fetchWas;
		},
	};
});
