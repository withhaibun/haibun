/**
 * Tests InstanceStepper's supervision of sibling processes: restarting an instance, and watching a run.
 *
 * An instance serves what its source declares, so a change to that source takes effect when the instance restarts.
 * Restart forks through the same path as start, so a restarted instance is launched as it was first launched.
 *
 * A caller starts a run, reads its output from a cursor while it executes, and stops it. The caller doesn't await a
 * run. RunTail holds a run's output. A read returns the cursor for the next read, so a reader doesn't re-read output.
 * RunTail counts the characters it drops. A read returns the number of requested characters that RunTail dropped.
 * These tests cover RunTail, runEnvironment, verifiedRun and the steps against a held run. The feature tests fork a
 * real cli.
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import InstanceStepper, { type TRun } from "./instance-stepper.js";
import { RunTail, featureFilterDomainDefinition, runEnvironment, runReadSchema } from "./domains/run.js";
import { verifiedRun } from "./pipelines/run-conditions.js";
import { supervisorPorts } from "./root.js";
import { execFileSync } from "node:child_process";
import nodeFS from "node:fs";
import os from "node:os";
import path from "node:path";
import { getConfigFromBase } from "./pipelines/specl.js";
import { processBaseEnvToOptionsAndErrors } from "./domains/base-options.js";
import { recordActuality, verificationOf } from "./adapters/actualities.js";
import { emptyOutcome } from "./pipelines/run-outcome.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { readEvery } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { SEQ_PATH_EDGE, SEQ_PATH_FIELD } from "@haibun/core/lib/seq-path.js";
import { RECORDED_STATUS } from "@haibun/core/lib/domains/protocol.js";
import type { ChildProcess } from "child_process";
import { EventEmitter } from "node:events";

/** Records an actuality of a group that ended as `status`, with the digests `v` read, as an actuality records itself in the actualities file. */
const recordOutcome = (v: Parameters<typeof recordActuality>[0], status: string) =>
	recordActuality(
		v,
		{ ok: true, featureResults: [] } as never,
		new Map([
			[
				"execution",
				{
					id: "1-0",
					stepText: "a run",
					actionStatus: status,
					accessLevel: "private",
					level: "info",
					actualityLevel: "execution",
					generatedAtTime: new Date(0).toISOString(),
					endedAtTime: new Date(1).toISOString(),
					digest: v.digest,
				},
			],
		]),
	);

/** The names of a held run's records: its key and its host. */
const HELD_NAMING = { key: "1700000000000", hostId: 0 };

/** InstanceStepper with a method that holds a run without a process. The products of the listing, reading, waiting and
 *  stopping steps don't depend on a child process. The feature tests start a real one. */
class SupervisorWithHeldRun extends InstanceStepper {
	hold(run: string, said = "", ended: number | null = null) {
		// A held run replaces a forked run in these tests. Its EventEmitter child emits `exit` when the held run ends, as a
		// child process does.
		const child: ChildProcess = Object.assign(new EventEmitter(), { exitCode: null, kill: () => child.emit("exit", null) }) as unknown as ChildProcess;
		const held: TRun = { child, tail: new RunTail(), outcome: emptyOutcome(), ended, waiters: [], naming: HELD_NAMING, stated: {}, levels: new Map(), writing: Promise.resolve() };
		this.runs.set(run, held);
		this.take(held, said);
		return { say: (text: string) => this.take(held, text), end: (code: number) => this.endHeld(run, code) };
	}

	private endHeld(run: string, code: number) {
		const held = this.runs.get(run);
		if (!held) return;
		held.ended = code;
		held.child.emit("exit", code);
	}
}

type TResult = { ok: boolean; errorMessage?: string };
type TRead = { ok: boolean; errorMessage?: string; products?: z.infer<typeof runReadSchema> };

const read = async (stepper: InstanceStepper, run: string, cursor: number) =>
	(await (stepper.steps.readRun.action as (a: { run: string; cursor: number }) => Promise<TRead>)({ run, cursor })) as TRead;
const stepper = () => {
	const supervisor = new SupervisorWithHeldRun();
	void supervisor.setWorld(getDefaultWorld(), []);
	return supervisor;
};

describe("a run's tail", () => {
	it("returns only the output after the cursor, and returns the cursor where the next read starts", () => {
		const tail = new RunTail();
		tail.append("first line\n");
		const one = tail.since(0);
		expect(one.output).toBe("first line\n");
		tail.append("second line\n");
		expect(tail.since(one.cursor).output, "only what was logged since the last read").toBe("second line\n");
	});

	it("counts the output the tail dropped, so a read from before the kept output returns the dropped count", () => {
		const tail = new RunTail(10);
		for (const chunk of ["01234", "56789", "ABCDE"]) tail.append(chunk);
		const read = tail.since(0);
		expect(read.output, "the tail keeps the most recent output").toBe("56789ABCDE");
		expect(read.dropped, "and counts the five dropped characters").toBe(5);
		expect(read.cursor).toBe(15);
	});

	it("keeps only the end of a single chunk longer than the whole tail", () => {
		const tail = new RunTail(10);
		tail.append("0123456789ABCDE");
		expect(tail.since(0).output).toBe("56789ABCDE");
		expect(tail.since(0).dropped).toBe(5);
	});
});

describe("the instances and runs a process started", () => {
	it("lists each run as running or ended", async () => {
		const s = stepper();
		s.hold("a-run");
		s.hold("an-ended-run", "", 0);
		const shown = await s.steps.showInstances.action();
		expect(shown.products).toEqual({
			instances: [],
			runs: [
				{ run: "a-run", status: "running" },
				{ run: "an-ended-run", status: "ended" },
			],
		});
	});
});

describe("watching a run", () => {
	it("returns the output logged since the given cursor", async () => {
		const s = stepper();
		const { say } = s.hold("a-run", "first line\n");
		const one = await read(s, "a-run", 0);
		expect(one.products?.output).toBe("first line\n");
		say("second line\n");
		const two = await read(s, "a-run", one.products?.cursor ?? 0);
		expect(two.products?.output, "only what was logged since the last read").toBe("second line\n");
		expect(two.products?.status).toBe("running");
	});

	it("returns how a run ended, so a watcher stops watching", async () => {
		const s = stepper();
		const { end } = s.hold("a-run", "done\n");
		end(1);
		const result = await read(s, "a-run", 0);
		expect(result.products?.status).toBe("ended");
		expect(result.products?.exitCode).toBe(1);
	});

	it("refuses to start a run under the name of a run this process holds", async () => {
		const s = stepper();
		s.hold("a-run");
		const result = (await (s.steps.startRun.action as (a: { where: string; filter: string; port: number; run: string }) => Promise<TResult>)({
			where: "/where",
			filter: "f",
			port: 8296,
			run: "a-run",
		})) as TResult;
		expect(result.ok).toBe(false);
		expect(result.errorMessage).toMatch(/already holds a run named "a-run"/);
	});

	it("refuses a port in use before forking a child, and describes the server on that port", async () => {
		// An operator finds this state after a session ends and its children keep running. A server responds on the
		// requested port. An "address in use" error in the exited child's output doesn't name that server or the remedy.
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
		expect(result.errorMessage).toContain(`port ${port} is already in use`);
		expect(result.errorMessage, "the refusal describes the server on the port").toContain("not a haibun host");
	});

	it("refuses to read or stop a run this process didn't start, and doesn't return a status for a run that doesn't exist", async () => {
		const s = stepper();
		await expect(read(s, "no-such-run", 0)).rejects.toThrow(/didn't start a run "no-such-run"/);
		await expect((s.steps.stopRun.action as (a: { run: string }) => Promise<TResult>)({ run: "no-such-run" })).rejects.toThrow(/didn't start a run "no-such-run"/);
	});
});

describe("restarting an instance", () => {
	it("refuses a port where this process didn't launch an instance, and doesn't start a new one", async () => {
		await expect((stepper().steps.restartInstance.action as (a: { port: number }) => Promise<TResult>)({ port: 8299 })).rejects.toThrow(/didn't launch an instance on port 8299/);
	});

	it("refuses to start from a directory without a config, and names the directory", async () => {
		const starting = (stepper().steps.startInstance.action as (a: { where: string; port: number; hostId: number }) => Promise<TResult>)({
			where: "/nonexistent-instance-dir",
			port: 8298,
			hostId: 9,
		});
		await expect(starting).rejects.toThrow(/nonexistent-instance-dir doesn't hold a config\.json/);
	});
});

describe("whether a run would repeat the outcome of an earlier run", () => {
	/** Creates a group of features in its own git repository, so its state depends only on its own files. */
	const aGroup = () => {
		const dir = nodeFS.realpathSync(nodeFS.mkdtempSync(path.join(os.tmpdir(), "haibun-verified-run-")));
		execFileSync("git", ["init", "-q"], { cwd: dir });
		const config = path.join(dir, "config.json");
		nodeFS.writeFileSync(config, JSON.stringify({ steppers: [] }));
		nodeFS.mkdirSync(path.join(dir, "features"));
		nodeFS.writeFileSync(path.join(dir, "features/a.feature"), "Feature: a\n");
		return { dir, config };
	};

	it("starts features that haven't run against their present state, and refuses features that have, whether they passed or failed", () => {
		const { dir, config } = aGroup();
		const env = runEnvironment({}, 0, false);
		expect(verifiedRun(supervisorPorts, config, dir, "", dir, env)).toBeUndefined();
		// v() computes the verification that the child would record from the same environment.
		const { options, moduleOptions } = processBaseEnvToOptionsAndErrors(env, getConfigFromBase([dir], nodeFS));
		const v = () => verificationOf({ configPath: config, specl: getConfigFromBase([dir], nodeFS), bases: [dir], cwd: dir, filter: [], options, moduleOptions }) as never;
		recordOutcome(v(), "failed");
		expect(verifiedRun(supervisorPorts, config, dir, "", dir, env), "a run that failed against this state would fail the same way").toBe("failed");
		recordOutcome(v(), "passed");
		expect(verifiedRun(supervisorPorts, config, dir, "", dir, env), "verifiedRun returns the recorded pass for the same features, state and conditions").toBe("passed");
		expect(verifiedRun(supervisorPorts, config, dir, "a", dir, env), "a run narrowed to some of the features is a different run").toBeUndefined();
		nodeFS.writeFileSync(path.join(dir, "features/a.feature"), "Feature: a, changed\n");
		expect(verifiedRun(supervisorPorts, config, dir, "", dir, env), "a changed dependency makes a new state that doesn't have a recorded outcome").toBeUndefined();
	});

	it("reads the .env file in a run's starting directory as the child does, so an option set there changes the conditions verifiedRun compares", () => {
		const { dir, config } = aGroup();
		const env = runEnvironment({}, 0, false);
		const { options, moduleOptions } = processBaseEnvToOptionsAndErrors(env, getConfigFromBase([dir], nodeFS));
		recordOutcome(verificationOf({ configPath: config, specl: getConfigFromBase([dir], nodeFS), bases: [dir], cwd: dir, filter: [], options, moduleOptions }) as never, "passed");
		expect(verifiedRun(supervisorPorts, config, dir, "", dir, env)).toBe("passed");
		nodeFS.writeFileSync(path.join(dir, ".env"), "HAIBUN_O_WEBSERVERSTEPPER_PORT=8399\n");
		expect(verifiedRun(supervisorPorts, config, dir, "", dir, env), "the child would read that file, so its conditions differ from the recorded conditions").toBeUndefined();
	});
});

describe("what a run is started with", () => {
	it("requests the child's events as NDJSON, since the supervisor reads events and not a formatted log", () => {
		expect(runEnvironment({}, 0, false).HAIBUN_NDJSON).toBe("true");
	});

	it("determines the child's port, host id, stay and once options, and doesn't pass on the supervisor's", () => {
		// The caller passes runEnvironment the names of the options that declare themselves per-process. The web server's
		// port option is one of them. `perProcess` holds its name here in place of that declaration.
		const perProcess = ["HAIBUN_O_WEBSERVERSTEPPER_PORT"];
		const supervisorEnv = { HAIBUN_O_WEBSERVERSTEPPER_PORT: "8290", HAIBUN_STAY: "always", HAIBUN_HOST_ID: "1", HAIBUN_ONCE: "true", HAIBUN_KEY: "kept" };
		const reported = { HAIBUN_KEY: "kept", HAIBUN_NDJSON: "true" };
		expect(runEnvironment(supervisorEnv, 0, false, undefined, perProcess), "a run that ends with its features serves on the ports its features declare").toEqual(reported);
		expect(runEnvironment(supervisorEnv, 8331, false, undefined, perProcess), "a port of its own doesn't keep it running").toEqual({
			...reported,
			HAIBUN_O_WEBSERVERSTEPPER_PORT: "8331",
		});
		expect(
			runEnvironment({ ...supervisorEnv, HAIBUN_O_MONITORSTEPPER_PORT: "7777" }, 8331, false, undefined, [...perProcess, "HAIBUN_O_MONITORSTEPPER_PORT"]),
			"a port the supervisor holds for its monitor isn't passed on or set to the run's port",
		).toEqual({ ...reported, HAIBUN_O_WEBSERVERSTEPPER_PORT: "8331" });
		expect(
			runEnvironment({}, 8331, false).HAIBUN_O_WEBSERVERSTEPPER_PORT,
			"an instance serves on the port it was given, whether or not the launcher holds a web server of its own",
		).toBe("8331");
		expect(runEnvironment(supervisorEnv, 8331, true, 9, perProcess), "a standing run serves on its port, takes its own host id, and stays up").toEqual({
			...reported,
			HAIBUN_O_WEBSERVERSTEPPER_PORT: "8331",
			HAIBUN_HOST_ID: "9",
			HAIBUN_STAY: "always",
		});
	});
});

describe("waiting for a run", () => {
	it("returns as soon as a run ends, without a further read", async () => {
		const s = stepper();
		const { end } = s.hold("a-run", "working\n");
		const waited = (s.steps.waitRun.action as (a: { run: string; seconds: number; cursor: number }) => Promise<TRead>)({ run: "a-run", seconds: 30, cursor: 0 });
		setTimeout(() => end(0), 5);
		const result = await waited;
		expect(result.products?.status, "the wait returned at exit, not at its timeout").toBe("ended");
		expect(result.products?.exitCode).toBe(0);
	});

	it("returns a running status without an error when the timeout passes", async () => {
		const s = stepper();
		s.hold("a-run", "still going\n");
		const result = await (s.steps.waitRun.action as (a: { run: string; seconds: number; cursor: number }) => Promise<TRead>)({ run: "a-run", seconds: 0.01, cursor: 0 });
		expect(result.ok).toBe(true);
		expect(result.products?.status).toBe("running");
	});

	it("refuses to wait for a run this process didn't start", async () => {
		const s = stepper();
		const waiting = (s.steps.waitRun.action as (a: { run: string; seconds: number; cursor: number }) => Promise<TResult>)({ run: "no-such", seconds: 1, cursor: 0 });
		await expect(waiting).rejects.toThrow(/didn't start a run "no-such"/);
	});
});

describe("a run left standing", () => {
	it("is done when its execution ends, since its process doesn't exit", async () => {
		const s = stepper();
		const { say } = s.hold("standing-run", "");
		const waited = (s.steps.waitRun.action as (a: { run: string; seconds: number; cursor: number }) => Promise<TRead>)({ run: "standing-run", seconds: 30, cursor: 0 });
		say('{"id":"execution","timestamp":1,"kind":"lifecycle","stage":"start","status":"running","type":"execution","in":"/tests"}\n');
		setTimeout(() => say('{"id":"execution","timestamp":2,"kind":"lifecycle","stage":"end","status":"completed","type":"execution"}\n'), 5);
		const result = await waited;
		expect(result.products?.execution, "the child reported its execution ended, and its process kept serving").toBe("completed");
		expect(result.products?.status, "the process didn't exit, so it is still running").toBe("running");
	});
});

describe("the records of a run's levels", () => {
	const event = (fields: Record<string, unknown>) => `${JSON.stringify({ kind: "lifecycle", timestamp: 1700000000000, ...fields })}\n`;

	it("are written in this process's store from a run's moves, and a stopped run's levels that hadn't ended state that they stopped", async () => {
		const s = stepper();
		const { say } = s.hold("a-run");
		say(event({ id: "execution", type: "execution", stage: "start", status: "running", in: "/tests" }));
		say(event({ id: "feat-1", type: "feature", stage: "start", status: "running", featurePath: "/features/a.feature", featureName: "a" }));
		say(event({ id: "0.1.0.1", type: "step", stage: "end", status: "failed", in: "a step", error: "it failed" }));
		say(event({ id: "feat-1", type: "feature", stage: "end", status: "failed", featurePath: "/features/a.feature", featureName: "a" }));
		say(event({ id: "feat-2", type: "feature", stage: "start", status: "running", featurePath: "/features/b.feature", featureName: "b" }));
		say(event({ id: "feat-2.scen-1", type: "scenario", stage: "start", status: "running", scenarioName: "first" }));
		await (s.steps.stopRun.action as (a: { run: string }) => Promise<TResult>)({ run: "a-run" });
		const records = (await readEvery(s.getWorld().shared.getStore(), { label: SEQ_PATH_LABEL })).sort((a, b) =>
			String(a[SEQ_PATH_FIELD.id]).localeCompare(String(b[SEQ_PATH_FIELD.id])),
		);
		const { key } = HELD_NAMING;
		expect(records.map((r) => [r[SEQ_PATH_FIELD.id], r[SEQ_PATH_FIELD.stepText], r[SEQ_PATH_FIELD.actionStatus], r[SEQ_PATH_EDGE.isPartOf], r[SEQ_PATH_FIELD.error]])).toEqual([
			[`${key}-0`, "/tests", RECORDED_STATUS.stopped, undefined, undefined],
			[`${key}-1.0.1.0`, "a", RECORDED_STATUS.failed, `${key}-0`, "0.1.0.1: a step (it failed)"],
			[`${key}-2.0.2.0`, "b", RECORDED_STATUS.stopped, `${key}-0`, undefined],
			[`${key}-2.0.2.1`, "first", RECORDED_STATUS.stopped, `${key}-2.0.2.0`, undefined],
		]);
	});
});

describe("a run's feature filter", () => {
	it("accepts patterns of feature paths and an empty filter, and refuses a part that isn't a regular expression", () => {
		const { schema } = featureFilterDomainDefinition;
		expect(schema.safeParse("graph,a.*b").success).toBe(true);
		expect(schema.safeParse("").success, "an empty filter selects every feature").toBe(true);
		expect(schema.safeParse("graph,*").error?.issues[0]?.message).toMatch(/has a part that isn't a regular expression/);
	});
});
