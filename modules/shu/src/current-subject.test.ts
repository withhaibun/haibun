/**
 * The active-record machine, held to its rules.
 *
 * Each event is asserted on its own, then the rules a reader relies on are asserted as sequences: closing a scope
 * returns to the scope activated before it, opening it again returns to its own entry unless another scope was
 * activated since, and an update never takes the lead. Random event sequences, seeded so a failure replays, then
 * assert against a second statement of the rule, written here as the activation history rather than read from the
 * module, so the two have to agree whatever order things happen in.
 */
import { describe, expect, it } from "vitest";
import { COMMENT_LABEL } from "@haibun/core/lib/resources.js";
import { anIndividual, aType } from "./schemas.js";
import {
	INITIAL_SUBJECT,
	SCOPE,
	SUBJECT_EVENTS,
	activeEntry,
	activeScope,
	currentSubject,
	entryOf,
	scopeEntry,
	transition,
	type TEntry,
	type TSubjectEvent,
	type TSubjectState,
} from "./current-subject.js";

const EMAIL = entryOf([anIndividual("Email", "a@test.com")], "private");
const OTHER = entryOf([anIndividual("Email", "b@test.com")], "private");
const QUESTION: TEntry = { record: { id: "cmt-ask-0.-1.3", label: COMMENT_LABEL }, seqPath: "0.-1.3", bundle: EMAIL.bundle };
const ANSWER: TEntry = { record: { id: "cmt-say-0.-1.3", label: COMMENT_LABEL }, seqPath: "0.-1.3", bundle: EMAIL.bundle };
const NOTHING = entryOf([], "private");

const run = (...events: TSubjectEvent[]): TSubjectState => events.reduce(transition, INITIAL_SUBJECT);
const activate = (scope: string, entry: TEntry): TSubjectEvent => ({ type: "activate", scope, entry });
const update = (scope: string, entry: TEntry): TSubjectEvent => ({ type: "update", scope, entry });
const open = (scope: string): TSubjectEvent => ({ type: "open", scope });
const close = (scope: string): TSubjectEvent => ({ type: "close", scope });

describe("an entry for a pane's patterns", () => {
	it("names the record the first pattern names, and carries the patterns as its bundle", () => {
		expect(EMAIL).toEqual({ record: { id: "a@test.com", label: "Email" }, bundle: { patterns: [anIndividual("Email", "a@test.com")], accessLevel: "private" } });
	});

	it("names no record for a type, and still bundles it", () => {
		const typed = entryOf([aType("Email")], "private");
		expect(typed.record).toBeNull();
		expect(typed.bundle.patterns).toEqual([aType("Email")]);
	});
});

describe("each event", () => {
	it("activate sets the scope's entry and stamps it newest", () => {
		const state = run(activate(SCOPE.page, EMAIL), activate(SCOPE.page, OTHER));
		expect(scopeEntry(state, SCOPE.page)).toEqual(OTHER);
		expect(state.scopes[SCOPE.page].stamp).toBe(INITIAL_SUBJECT.clock + 1);
	});

	it("update sets the scope's entry and keeps its stamp, and a scope never activated is the oldest", () => {
		const activated = run(activate(SCOPE.page, EMAIL));
		const updated = transition(activated, update(SCOPE.page, OTHER));
		expect(scopeEntry(updated, SCOPE.page)).toEqual(OTHER);
		expect(updated.scopes[SCOPE.page].stamp).toBe(activated.scopes[SCOPE.page].stamp);
		expect(run(update(SCOPE.actionsBar, ANSWER)).scopes[SCOPE.actionsBar].stamp).toBe(0);
	});

	it("open adds a scope once, and close removes it and keeps its entry", () => {
		const opened = run(open(SCOPE.actionsBar), open(SCOPE.actionsBar));
		expect(opened.open).toEqual([SCOPE.page, SCOPE.actionsBar]);
		const closed = transition(transition(opened, activate(SCOPE.actionsBar, ANSWER)), close(SCOPE.actionsBar));
		expect(closed.open).toEqual([SCOPE.page]);
		expect(scopeEntry(closed, SCOPE.actionsBar), "kept for the next open").toEqual(ANSWER);
	});

	it("lists every event it takes", () => {
		expect([...SUBJECT_EVENTS]).toEqual(["activate", "update", "open", "close"]);
	});
});

describe("the active entry", () => {
	it("is nothing before anything is activated", () => {
		expect(activeEntry(INITIAL_SUBJECT)).toBeNull();
		expect(currentSubject(INITIAL_SUBJECT)).toBeNull();
	});

	it("is the comment the conversation activated while the bar is open", () => {
		const state = run(activate(SCOPE.page, EMAIL), open(SCOPE.actionsBar), activate(SCOPE.actionsBar, QUESTION), activate(SCOPE.actionsBar, ANSWER));
		expect(activeScope(state)).toBe(SCOPE.actionsBar);
		expect(currentSubject(state)).toEqual(ANSWER.record);
	});

	it("returns to the page's record when the bar closes, and to the conversation when it opens again", () => {
		const closed = run(activate(SCOPE.page, EMAIL), open(SCOPE.actionsBar), activate(SCOPE.actionsBar, ANSWER), close(SCOPE.actionsBar));
		expect(currentSubject(closed), "the bar closed").toEqual(EMAIL.record);
		expect(currentSubject(transition(closed, open(SCOPE.actionsBar))), "the bar opened again").toEqual(ANSWER.record);
	});

	it("stays on a record the reader opened while the bar was closed, when the bar opens again", () => {
		const state = run(open(SCOPE.actionsBar), activate(SCOPE.actionsBar, ANSWER), close(SCOPE.actionsBar), activate(SCOPE.page, OTHER), open(SCOPE.actionsBar));
		expect(currentSubject(state)).toEqual(OTHER.record);
	});

	it("follows a comment the conversation records while the bar is closed only once the bar opens", () => {
		const closed = run(activate(SCOPE.page, EMAIL), activate(SCOPE.actionsBar, ANSWER));
		expect(currentSubject(closed), "a closed scope never leads").toEqual(EMAIL.record);
		expect(currentSubject(transition(closed, open(SCOPE.actionsBar)))).toEqual(ANSWER.record);
	});

	it("is nothing after a reader chooses nothing on the page, whatever a closed scope holds", () => {
		const state = run(open(SCOPE.actionsBar), activate(SCOPE.actionsBar, ANSWER), close(SCOPE.actionsBar), activate(SCOPE.page, NOTHING));
		expect(activeScope(state)).toBe(SCOPE.page);
		expect(currentSubject(state)).toBeNull();
	});

	it("does not move to a scope that is updated, such as a column closing or a session restored", () => {
		const state = run(activate(SCOPE.page, EMAIL), open(SCOPE.actionsBar), update(SCOPE.actionsBar, ANSWER));
		expect(currentSubject(state), "a restored session does not take the lead").toEqual(EMAIL.record);
		expect(currentSubject(transition(state, update(SCOPE.page, OTHER))), "an update to the active scope shows its new record").toEqual(OTHER.record);
	});

	it("is an updated scope's entry where no open scope was activated", () => {
		expect(currentSubject(run(open(SCOPE.actionsBar), update(SCOPE.actionsBar, ANSWER)))).toEqual(ANSWER.record);
	});
});

describe("any sequence of events", () => {
	// A small seeded generator, so a failing sequence is replayed by its seed.
	const seeded = (seed: number) => () => {
		seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
		return seed / 2_147_483_648;
	};
	const SCOPES = [SCOPE.page, SCOPE.actionsBar, "another-panel"];
	const ENTRIES = [EMAIL, OTHER, QUESTION, ANSWER, NOTHING];

	it("keeps the active entry that of the open scope activated last, else the open scope updated", () => {
		for (let seed = 1; seed <= 200; seed++) {
			const random = seeded(seed);
			let state = INITIAL_SUBJECT;
			// The rule stated again: the open scopes, the order scopes were activated in, and each scope's latest entry.
			let opened = new Set<string>([SCOPE.page]);
			const activations: string[] = [];
			const entries = new Map<string, TEntry>();
			const path: string[] = [];
			for (let step = 0; step < 40; step++) {
				const scope = SCOPES[Math.floor(random() * SCOPES.length)];
				const entry = ENTRIES[Math.floor(random() * ENTRIES.length)];
				const type = SUBJECT_EVENTS[Math.floor(random() * SUBJECT_EVENTS.length)];
				const event: TSubjectEvent = type === "activate" || type === "update" ? { type, scope, entry } : { type, scope };
				path.push(`${type}:${scope}`);
				state = transition(state, event);
				if (type === "activate") {
					const at = activations.indexOf(scope);
					if (at >= 0) activations.splice(at, 1);
					activations.push(scope);
					entries.set(scope, entry);
				}
				if (type === "update") entries.set(scope, entry);
				if (type === "open") opened.add(scope);
				if (type === "close") opened = new Set([...opened].filter((s) => s !== scope));
				const lastActivated = [...activations].reverse().find((s) => opened.has(s));
				const updatedOnly = [...opened].filter((s) => entries.has(s) && !activations.includes(s));
				const expected = lastActivated ?? updatedOnly[0] ?? null;
				const label = `seed ${seed}: ${path.join(" ")}`;
				expect(activeScope(state), label).toBe(expected);
				expect(activeEntry(state), label).toEqual(expected === null ? null : entries.get(expected));
			}
		}
	});
});
