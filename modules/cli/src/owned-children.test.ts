/**
 * A supervised child never outlives its owner: entering a child installs the process hooks, ending the owned children
 * terminates the living and spares the ended, and a child that exits on its own leaves the registry. The signal path
 * cannot be driven here without ending the test process itself; it shares terminateOwnedChildren with the exit hook,
 * which is what these drive directly.
 */
import { describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "child_process";
import { superviseChild, supervisedCount, terminateOwnedChildren } from "./owned-children.js";

type TFake = ChildProcess & { kills: string[]; end: () => void };

function fakeChild(exited = false): TFake {
	const listeners: Array<() => void> = [];
	const child = {
		exitCode: exited ? 0 : null,
		kills: [] as string[],
		kill(signal: string) {
			(this as TFake).kills.push(signal);
			return true;
		},
		once(event: string, listener: () => void) {
			if (event === "exit") listeners.push(listener);
			return this;
		},
		end() {
			(this as unknown as { exitCode: number }).exitCode = 0;
			for (const listener of listeners.splice(0)) listener();
		},
	};
	return child as unknown as TFake;
}

describe("children owned for the life of the process", () => {
	it("terminates the living and spares the already-ended, and the registry is empty after", () => {
		const living = fakeChild();
		const ended = fakeChild(true);
		superviseChild(living);
		superviseChild(ended);
		terminateOwnedChildren();
		expect(living.kills, "one SIGTERM, with no waiting an ending owner cannot do").toEqual(["SIGTERM"]);
		expect(ended.kills, "a child already over is not signalled").toEqual([]);
		expect(supervisedCount()).toBe(0);
	});

	it("lets a child that ends on its own leave the registry, so a long session does not accrue the ended", () => {
		const child = fakeChild();
		superviseChild(child);
		const before = supervisedCount();
		child.end();
		expect(supervisedCount()).toBe(before - 1);
	});

	it("installs the process hooks once, however many children are entered", () => {
		const sigterm = process.listeners("SIGTERM").length;
		superviseChild(fakeChild());
		superviseChild(fakeChild());
		expect(process.listeners("SIGTERM").length, "one handler answers for every child").toBeLessThanOrEqual(sigterm + 1);
		expect(vi.isMockFunction(process.exit), "and nothing here replaced process.exit").toBe(false);
		terminateOwnedChildren();
	});
});
