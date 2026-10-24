/**
 * Reads actuality's steps: the step list, the domains and the concern catalog. The page reads them from the site, caches the
 * response on the device, and reads the device's copy where the site doesn't respond; a site's refusal of the read is
 * returned to the caller, so the page doesn't read from the device what the site refuses. The page reads them again
 * each time actuality signals they changed, and each time its stream opens after its first read began, since a change
 * actuality signals while the stream is closed doesn't reach the page.
 */
import { errorDetail } from "@haibun/core/lib/domains/util.js";
import { isServerUnreachable } from "@haibun/core/lib/rpc-wire.js";
import { STEPS_CHANGED } from "@haibun/core/lib/domains/protocol.js";
import { SHOW_STEP_DEFINITIONS_METHOD, STEP_DETAIL, readShownSteps } from "@haibun/core/lib/step-discovery.js";
import type { Machine } from "@haibun/core/lib/machines/machine.js";
import { reads } from "../domains/links.js";
import { REGISTRY_EVENT, REGISTRY_STATUS, type TRegistryEvent, type TRegistryRead, type TRegistryState, type TStepList } from "../machines/registry.js";
import type { TClientLog, TConduit, TEventStream } from "../ports.js";
import type { TDeviceStore } from "../client-cache/ports.js";

/** The source the registry reports under. */
const REGISTRY_SOURCE = "rpc-registry";

/** What the page holds of its reads of actuality's steps, across its bundles: the read under way, whether a read again waits
 *  for it, and the call that stops following actuality's signals, undefined until the first read. */
export type TRegistryReads = { pending: Promise<TStepList> | undefined; againQueued: boolean; unfollow: (() => void) | undefined };

/** What reading actuality's steps reads and writes: the registry machine, the reads under way, the conduit, the stream, and
 *  the device's store, which holds the steps a site served for a page the site doesn't serve. */
export type TReadStepsScope = {
	registry: Machine<TRegistryState, TRegistryEvent>;
	reads: TRegistryReads;
	conduit: () => TConduit;
	stream: () => TEventStream;
	device: () => TDeviceStore;
	log: TClientLog;
};

/** Returns actuality's steps: what the page holds, or a new read before the page holds them. A read under way is shared. */
export function readSteps(scope: TReadStepsScope): Promise<TStepList> {
	const state = scope.registry.state.get();
	if (state.status === REGISTRY_STATUS.READ) return Promise.resolve(state.read.list);
	return scope.reads.pending === undefined ? read(scope, REGISTRY_EVENT.READ) : scope.reads.pending;
}

/** Reads actuality's steps and moves the registry with `type`. The page holds what it read before until this read returns,
 *  so a step the page looks up during the read is found. */
async function read(scope: TReadStepsScope, type: TRegistryEvent["type"]): Promise<TStepList> {
	if (scope.reads.unfollow === undefined) scope.reads.unfollow = followActuality(scope);
	const discovery = discover(scope.conduit(), scope.device(), scope.log).then((registryRead) => {
		scope.registry.dispatch({ type, read: registryRead });
		return registryRead.list;
	});
	scope.reads.pending = discovery;
	try {
		return await discovery;
	} finally {
		scope.reads.pending = undefined;
	}
}

/** Reads actuality's steps from the site, and from the device's copy where the site doesn't respond. */
async function discover(conduit: TConduit, device: TDeviceStore, log: TClientLog): Promise<TRegistryRead> {
	try {
		const list = readShownSteps(
			await conduit.follow<Record<string, unknown>>(reads(SHOW_STEP_DEFINITIONS_METHOD), "rpc-registry: discover available steps"),
			STEP_DETAIL.definition,
		);
		void device.setRegistry(list).catch((err) => log.failure(REGISTRY_SOURCE, "the registry was not cached on the device", err));
		return { list, from: "site" };
	} catch (err) {
		if (!isServerUnreachable(err)) throw err;
		const cached = await device.registry();
		if (cached === undefined) throw err;
		log.report(
			"warn",
			REGISTRY_SOURCE,
			`the server did not respond; the registry cached on this device (${new Date(cached.savedAt).toISOString()}) is in use: ${errorDetail(err)}`,
		);
		return { list: readShownSteps(cached.response, STEP_DETAIL.definition), from: "device", savedAt: cached.savedAt };
	}
}

/** Follows actuality's signals that its steps changed, and its stream's openings after the first read began. A stream open at
 *  the first read is one that read follows, so the stream's call at subscription doesn't add a read. */
function followActuality(scope: TReadStepsScope): () => void {
	const stream = scope.stream();
	const stopSignals = stream.subscribe(
		() => readAgain(scope),
		(event) => event.kind === "control" && event.signal === STEPS_CHANGED,
	);
	let subscribed = false;
	const stopOpenings = stream.opened(() => {
		if (subscribed) readAgain(scope);
	});
	subscribed = true;
	return () => {
		stopSignals();
		stopOpenings();
	};
}

/** Reads actuality's steps again once the read under way ends, since that read may have begun before the change. Signals
 *  that arrive before the read again begins don't add a read. A site that doesn't respond leaves the page on the steps it
 *  holds, as every read does, and any other failure is reported. */
function readAgain(scope: TReadStepsScope): void {
	if (scope.reads.againQueued) return;
	scope.reads.againQueued = true;
	// The read under way reports its own failure, so the read again waits for it to settle either way.
	const under = scope.reads.pending === undefined ? Promise.resolve() : Promise.allSettled([scope.reads.pending]);
	void under
		.then(async () => {
			scope.reads.againQueued = false;
			await (scope.reads.pending === undefined ? read(scope, REGISTRY_EVENT.READ_AGAIN) : scope.reads.pending);
		})
		.catch((err) => (isServerUnreachable(err) ? undefined : scope.log.failure(REGISTRY_SOURCE, "actuality's steps were not read again", err)));
}
