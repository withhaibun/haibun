/**
 * A supervised child never outlives its owner. The supervisor's endFeature terminates children when a run closes, but
 * a process that STAYS (a kihan serve, any HAIBUN_STAY session) ends by signal or exit instead, and a child that
 * survives that is an orphan holding its port, refusing the owner's own next session with no way to ask it anything.
 *
 * One process-wide registry: every supervised child is entered at fork and leaves at its own exit. The first entry
 * installs the process hooks, SIGINT and SIGTERM terminate the children and then re-raise so the process ends exactly
 * as the signal would have ended it, and the exit hook covers the process.exit paths. Termination here is one SIGTERM
 * with no waiting: a signal handler cannot await, and a child that ignores it is beyond what an ending owner can do.
 */
import type { ChildProcess } from "child_process";

const supervised = new Set<ChildProcess>();
let hooksInstalled = false;

/** End every owned child now: the one action the exit and signal hooks share, callable deliberately by an embedder
 *  that is ending its session another way. */
export const terminateOwnedChildren = (): void => {
	for (const child of supervised) if (child.exitCode === null) child.kill("SIGTERM");
	supervised.clear();
};

function installHooks(): void {
	if (hooksInstalled) return;
	hooksInstalled = true;
	process.once("exit", terminateOwnedChildren);
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, () => {
			terminateOwnedChildren();
			// Re-raise: `once` has removed this handler, so the default applies and the process ends as the signal ends it.
			process.kill(process.pid, signal);
		});
	}
}

/** Enter a child under this process's ownership: it is terminated when the process ends, however the process ends. */
export function superviseChild(child: ChildProcess): void {
	installHooks();
	supervised.add(child);
	child.once("exit", () => supervised.delete(child));
}

/** The children currently owned: how a test observes the registry without reaching into it. */
export function supervisedCount(): number {
	return supervised.size;
}

/** End one child deliberately and wait for it: SIGTERM, then SIGKILL if it has not exited within 5s. The awaited
 *  counterpart to the hooks' unawaited termination, for an owner ending a child mid-session (endFeature, a restart):
 *  one home for how a child is ended, beside the registry that ends them all. */
export function terminate(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null) return Promise.resolve();
	return new Promise((resolve) => {
		const escalation = setTimeout(() => child.kill("SIGKILL"), 5_000);
		child.once("exit", () => {
			clearTimeout(escalation);
			resolve();
		});
		child.kill("SIGTERM");
	});
}
