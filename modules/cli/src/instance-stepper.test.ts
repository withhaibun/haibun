/**
 * Supervising siblings: restarting an instance, and watching a run.
 *
 * What an instance serves comes from its source, so a change to that source takes effect only once it runs again.
 * Restart forks through the same path as start, so a restarted instance is launched exactly as it first was.
 *
 * A run is watched rather than awaited: it is started, read from a cursor while it happens, and stopped. What a
 * watcher relies on is the tail: a cursor that never re-reads, and a count of what fell out of it rather than a
 * silent gap. The tail is tested as itself; the steps are tested for what they refuse, since forking a real cli
 * belongs to the feature tests.
 */
import { describe, expect, it } from "vitest";
import InstanceStepper, { RunTail, runEnvironment } from "./instance-stepper.js";
import { emptyOutcome, accrueRunOutcome } from "./run-outcome.js";
import type { ChildProcess } from "child_process";
import { EventEmitter } from "node:events";

/** The supervisor, with a way to hold a run that has no process behind it: what the reading and stopping steps
 *  answer does not depend on a child, and starting a real one belongs to the feature tests. */
class SupervisorWithHeldRun extends InstanceStepper {
	hold(run: string, said = "", ended: number | null = null) {
		const tail = new RunTail();
		const outcome = emptyOutcome();
		const waiters: Array<() => void> = [];
		const take = (text: string) => {
			tail.append(text);
			const wasFinished = outcome.finished;
			accrueRunOutcome(outcome, text);
			if (!wasFinished && outcome.finished) for (const wake of waiters.splice(0)) wake();
		};
		take(said);
		// A held run stands in for a forked one, so it says when it ends the way a child does.
		const child = Object.assign(new EventEmitter(), { kill: () => true }) as unknown as ChildProcess;
		this.runs.set(run, { child, where: "/where", filter: "some-feature", tail, outcome, ended, waiters });
		return { say: take, end: (code: number) => this.endHeld(run, code) };
	}

	private endHeld(run: string, code: number) {
		const held = this.runs.get(run);
		if (!held) return;
		held.ended = code;
		held.child.emit("exit", code);
	}
}

type TResult = { ok: boolean; errorMessage?: string };
type TRead = { ok: boolean; errorMessage?: string; products?: { status: string; exitCode: number | null; cursor: number; output: string; dropped: number } };

const read = async (stepper: InstanceStepper, run: string, cursor: number) =>
	(await (stepper.steps.readRun.action as (a: { run: string; cursor: number }) => Promise<TRead>)({ run, cursor })) as TRead;
const stepper = () => new SupervisorWithHeldRun();

describe("a run's tail", () => {
	it("reads only what is new: the cursor it returns is where the next read starts", () => {
		const tail = new RunTail();
		tail.append("first line\n");
		const one = tail.since(0);
		expect(one.output).toBe("first line\n");
		tail.append("second line\n");
		expect(tail.since(one.cursor).output, "only what was said since the last read").toBe("second line\n");
	});

	it("counts what fell out of the tail, so a reader that missed some of it is told rather than shown a gap", () => {
		const tail = new RunTail(10);
		for (const chunk of ["01234", "56789", "ABCDE"]) tail.append(chunk);
		const read = tail.since(0);
		expect(read.output, "what is kept is the end of it").toBe("56789ABCDE");
		expect(read.dropped, "and the five characters no longer kept are counted").toBe(5);
		expect(read.cursor).toBe(15);
	});

	it("bounds itself against a single chunk longer than the whole tail", () => {
		const tail = new RunTail(10);
		tail.append("0123456789ABCDE");
		expect(tail.since(0).output).toBe("56789ABCDE");
		expect(tail.since(0).dropped).toBe(5);
	});
});

describe("watching a run", () => {
	it("answers with what the run has said since the cursor it was given", async () => {
		const s = stepper();
		const { say } = s.hold("a-run", "first line\n");
		const one = await read(s, "a-run", 0);
		expect(one.products?.output).toBe("first line\n");
		say("second line\n");
		const two = await read(s, "a-run", one.products?.cursor ?? 0);
		expect(two.products?.output, "only what was said since the last read").toBe("second line\n");
		expect(two.products?.status).toBe("running");
	});

	it("reports how a run ended, so a watcher stops watching", async () => {
		const s = stepper();
		const { end } = s.hold("a-run", "done\n");
		end(1);
		const result = await read(s, "a-run", 0);
		expect(result.products?.status).toBe("ended");
		expect(result.products?.exitCode).toBe(1);
	});

	it("refuses to start a second run under one name, rather than losing the first", async () => {
		const s = stepper();
		s.hold("a-run");
		const result = (await (s.steps.startRun.action as (a: { where: string; filter: string; port: number; run: string }) => Promise<TResult>)({
			where: "/where",
			filter: "f",
			port: 8296,
			run: "a-run",
		})) as TResult;
		expect(result.ok).toBe(false);
		expect(result.errorMessage).toMatch(/already running/);
	});

	it("refuses a held port by naming what answers there, before a child is forked to die on it", async () => {
		// The situation an operator meets after a session ends without its children: something answers on the run's
		// port, and "address in use" deep in a dead child's output names neither the occupant nor the recourse.
		const { createServer } = await import("node:http");
		const { mkdtempSync, writeFileSync } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const path = await import("node:path");
		const server = createServer((_req, res) => {
			res.statusCode = 404;
			res.end("not haibun");
		});
		await new Promise<void>((resolve) => server.listen(0, resolve));
		const port = (server.address() as { port: number }).port;
		const dir = mkdtempSync(path.join(tmpdir(), "busy-port-"));
		writeFileSync(path.join(dir, "config.json"), "{}");
		const s = stepper();
		const result = (await (s.steps.startRun.action as (a: { where: string; filter: string; from: string; port: number; run: string }) => Promise<TResult>)({
			where: dir,
			filter: "",
			from: "",
			port,
			run: "r-busy",
		})) as TResult;
		server.close();
		expect(result.ok).toBe(false);
		expect(result.errorMessage).toContain(`port ${port} is already answering`);
		expect(result.errorMessage, "what answers is named, so the refusal is actionable").toContain("not a haibun host");
	});

	it("refuses to read or stop a run it never started, rather than answering for nothing", async () => {
		const s = stepper();
		expect((await read(s, "no-such-run", 0)).errorMessage).toMatch(/started no run "no-such-run"/);
		const stop = (await (s.steps.stopRun.action as (a: { run: string }) => Promise<TResult>)({ run: "no-such-run" })) as TResult;
		expect(stop.errorMessage).toMatch(/started no run "no-such-run"/);
	});
});

describe("restarting an instance", () => {
	it("refuses a port this run launched nothing on, rather than starting something unasked", async () => {
		const result = (await (stepper().steps.restartInstance.action as (a: { port: number }) => Promise<TResult>)({ port: 8299 })) as TResult;
		expect(result.ok).toBe(false);
		expect(result.errorMessage).toMatch(/launched no instance on port 8299/);
	});

	it("refuses to start from a directory with no config, naming the directory", async () => {
		const result = (await (stepper().steps.startInstance.action as (a: { where: string; port: number; hostId: number }) => Promise<TResult>)({
			where: "/nonexistent-instance-dir",
			port: 8298,
			hostId: 9,
		})) as TResult;
		expect(result.ok).toBe(false);
		expect(result.errorMessage).toMatch(/no config\.json in .*nonexistent-instance-dir/);
	});
});

describe("what a run is started with", () => {
	it("asks the run for its events, since this process reads them rather than watching a formatted log", () => {
		expect(runEnvironment({}, 0, false).HAIBUN_NDJSON).toBe("true");
	});

	it("decides the run's port, its identity and whether it stays up, rather than passing on the supervisor's", () => {
		// What a child must not inherit is read from the options that declare themselves per-process; the port option
		// is one, and this stands in for its declaration.
		const perProcess = ["HAIBUN_O_WEBSERVERSTEPPER_PORT"];
		const supervisorEnv = { HAIBUN_O_WEBSERVERSTEPPER_PORT: "8290", HAIBUN_STAY: "always", HAIBUN_HOST_ID: "1", HAIBUN_KEY: "kept" };
		const reported = { HAIBUN_KEY: "kept", HAIBUN_NDJSON: "true" };
		expect(runEnvironment(supervisorEnv, 0, false, undefined, perProcess), "a run that ends with its features serves where its features say").toEqual(reported);
		expect(runEnvironment(supervisorEnv, 8331, false, undefined, perProcess), "a port of its own is not a reason to keep it running").toEqual({
			...reported,
			HAIBUN_O_WEBSERVERSTEPPER_PORT: "8331",
		});
		expect(
			runEnvironment({}, 8331, false).HAIBUN_O_WEBSERVERSTEPPER_PORT,
			"an instance serves on the port it was given, whether or not the launcher holds a web server of its own",
		).toBe("8331");
		expect(runEnvironment(supervisorEnv, 8331, true, 9, perProcess), "a run to be asked about afterwards serves on its port, takes its own id, and stays").toEqual({
			...reported,
			HAIBUN_O_WEBSERVERSTEPPER_PORT: "8331",
			HAIBUN_HOST_ID: "9",
			HAIBUN_STAY: "always",
		});
	});
});

describe("waiting for a run", () => {
	it("answers the moment the run ends, rather than when it is next asked", async () => {
		const s = stepper();
		const { end } = s.hold("a-run", "working\n");
		const waited = (s.steps.waitRun.action as (a: { run: string; seconds: number; cursor: number }) => Promise<TRead>)({ run: "a-run", seconds: 30, cursor: 0 });
		setTimeout(() => end(0), 5);
		const result = await waited;
		expect(result.products?.status, "the wait returned because the run ended, not because a timer fired").toBe("ended");
		expect(result.products?.exitCode).toBe(0);
	});

	it("answers with the run still running when the caller's patience runs out, which is not an error", async () => {
		const s = stepper();
		s.hold("a-run", "still going\n");
		const result = await (s.steps.waitRun.action as (a: { run: string; seconds: number; cursor: number }) => Promise<TRead>)({ run: "a-run", seconds: 0.01, cursor: 0 });
		expect(result.ok).toBe(true);
		expect(result.products?.status).toBe("running");
	});

	it("refuses to wait for a run it never started", async () => {
		const s = stepper();
		const result = (await (s.steps.waitRun.action as (a: { run: string; seconds: number; cursor: number }) => Promise<TResult>)({
			run: "no-such",
			seconds: 1,
			cursor: 0,
		})) as TResult;
		expect(result.errorMessage).toMatch(/started no run "no-such"/);
	});
});

describe("a run left standing", () => {
	it("is done when its features are, since it will not exit", async () => {
		const s = stepper();
		const { say } = s.hold("standing-run", "");
		const waited = (s.steps.waitRun.action as (a: { run: string; seconds: number; cursor: number }) => Promise<TRead>)({ run: "standing-run", seconds: 30, cursor: 0 });
		setTimeout(() => say('{"kind":"lifecycle","stage":"end","status":"completed","type":"execution"}\n'), 5);
		const result = await waited;
		expect(result.products?.finished, "the run said its features were over, and went on serving").toBe(true);
		expect(result.products?.status, "nothing exited, so it is still running as a process").toBe("running");
	});
});
