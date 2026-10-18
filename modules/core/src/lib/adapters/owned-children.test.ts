/**
 * A supervised child process doesn't keep running after its owner ends. superviseChild installs the process hooks.
 * terminateOwnedChildren sends SIGTERM to each running child and skips each exited child. A child that exits by itself
 * is removed from the registry. These tests can't drive the signal path without ending the test process. The signal
 * hooks and the exit hook call terminateOwnedChildren, and these tests call it directly.
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

describe("children owned until the process ends", () => {
	it("sends SIGTERM to a running child, skips an exited child, and empties the registry", () => {
		const living = fakeChild();
		const ended = fakeChild(true);
		superviseChild(living);
		superviseChild(ended);
		terminateOwnedChildren();
		expect(living.kills, "terminateOwnedChildren sends one SIGTERM and doesn't wait, because a signal handler can't await").toEqual(["SIGTERM"]);
		expect(ended.kills, "an exited child isn't signalled").toEqual([]);
		expect(supervisedCount()).toBe(0);
	});

	it("removes a child that exits by itself from the registry, so the registry doesn't grow over a long session", () => {
		const child = fakeChild();
		superviseChild(child);
		const before = supervisedCount();
		child.end();
		expect(supervisedCount()).toBe(before - 1);
	});

	it("installs the process hooks once for any number of supervised children", () => {
		const sigterm = process.listeners("SIGTERM").length;
		superviseChild(fakeChild());
		superviseChild(fakeChild());
		expect(process.listeners("SIGTERM").length, "one SIGTERM listener handles every child").toBeLessThanOrEqual(sigterm + 1);
		expect(vi.isMockFunction(process.exit), "process.exit isn't a mock function").toBe(false);
		terminateOwnedChildren();
	});
});
