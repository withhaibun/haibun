/**
 * Tests the active-record machine against its rules.
 *
 * Each event is asserted on its own. The rules a reader relies on are then asserted as sequences. Closing a scope
 * makes the scope activated before it active again. Opening it again makes its own entry active unless another scope
 * was activated since. An update doesn't make its scope active over a scope that was activated. Random event sequences
 * are then checked against a second statement of the rule. The sequences are seeded, so a failed sequence can be
 * replayed. This test computes that statement as an activation history instead of reading it from the module. The
 * module and the history must select the same active entry for any order of events.
 */
import { describe, expect, it } from "vitest";
import { COMMENT_LABEL } from "@haibun/core/lib/resources.js";
import { anIndividual, aType } from "@haibun/core/lib/conversation/domains/conversation.js";
import { pickWith, runSequences } from "@haibun/core/lib/test/machine-table.js";
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
const QUESTION: TEntry = { record: { id: "cmt-ask-0.-1.3", label: COMMENT_LABEL }, turn: "cmt-ask-0.-1.3", bundle: EMAIL.bundle };
const ANSWER: TEntry = { record: { id: "cmt-say-0.-1.3", label: COMMENT_LABEL }, turn: "cmt-ask-0.-1.3", bundle: EMAIL.bundle };
const NOTHING = entryOf([], "private");

const run = (...events: TSubjectEvent[]): TSubjectState => events.reduce(transition, INITIAL_SUBJECT);
const activate = (scope: string, entry: TEntry): TSubjectEvent => ({ type: "activate", scope, entry });
const update = (scope: string, entry: TEntry): TSubjectEvent => ({ type: "update", scope, entry });
const open = (scope: string): TSubjectEvent => ({ type: "open", scope });
const close = (scope: string): TSubjectEvent => ({ type: "close", scope });
const stampOf = (state: TSubjectState, scope: string): number => {
	const held = state.scopes[scope];
	if (!held) throw new Error(`scope ${scope} doesn't hold a stamp`);
	return held.stamp;
};

describe("an entry for a pane's patterns", () => {
	it("names the record the first pattern names, and carries the patterns as its bundle", () => {
		expect(EMAIL).toEqual({ record: { id: "a@test.com", label: "Email" }, bundle: { patterns: [anIndividual("Email", "a@test.com")], accessLevel: "private" } });
	});

	it("doesn't name a record for a type, and still bundles it", () => {
		const typed = entryOf([aType("Email", [])], "private");
		expect(typed.record).toBeNull();
		expect(typed.bundle.patterns).toEqual([aType("Email", [])]);
	});
});

describe("each event", () => {
	it("activate sets the scope's entry and stamps it newest", () => {
		const state = run(activate(SCOPE.page, EMAIL), activate(SCOPE.page, OTHER));
		expect(scopeEntry(state, SCOPE.page)).toEqual(OTHER);
		expect(stampOf(state, SCOPE.page)).toBe(INITIAL_SUBJECT.clock + 1);
	});

	it("update sets the scope's entry and keeps its stamp, and a scope never activated is the oldest", () => {
		const activated = run(activate(SCOPE.page, EMAIL));
		const updated = transition(activated, update(SCOPE.page, OTHER));
		expect(scopeEntry(updated, SCOPE.page)).toEqual(OTHER);
		expect(stampOf(updated, SCOPE.page)).toBe(stampOf(activated, SCOPE.page));
		expect(stampOf(run(update(SCOPE.actionsBar, ANSWER)), SCOPE.actionsBar)).toBe(0);
	});

	it("open adds a scope once, and close removes it and keeps its entry", () => {
		const opened = run(open(SCOPE.actionsBar), open(SCOPE.actionsBar));
		expect(opened.open).toEqual([SCOPE.page, SCOPE.actionsBar]);
		const closed = transition(transition(opened, activate(SCOPE.actionsBar, ANSWER)), close(SCOPE.actionsBar));
		expect(closed.open).toEqual([SCOPE.page]);
		expect(scopeEntry(closed, SCOPE.actionsBar), "kept for the next open").toEqual(ANSWER);
	});

	it("clear removes the scope's entry and stamp, so the open scope activated before it is active, and an update after it is the oldest", () => {
		const cleared = run(activate(SCOPE.page, EMAIL), open(SCOPE.actionsBar), activate(SCOPE.actionsBar, ANSWER), { type: "clear", scope: SCOPE.actionsBar });
		expect(scopeEntry(cleared, SCOPE.actionsBar)).toBeNull();
		expect(currentSubject(cleared), "a new conversation leaves the page's record active").toEqual(EMAIL.record);
		expect(currentSubject(transition(cleared, update(SCOPE.actionsBar, ANSWER))), "a session restored after it doesn't become active").toEqual(EMAIL.record);
		expect(transition(INITIAL_SUBJECT, { type: "clear", scope: SCOPE.actionsBar }), "a scope without an entry is unchanged").toBe(INITIAL_SUBJECT);
	});

	it("lists every event it takes", () => {
		expect([...SUBJECT_EVENTS]).toEqual(["activate", "update", "clear", "open", "close"]);
	});
});

describe("the active entry", () => {
	it("is null before anything is activated", () => {
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
		expect(currentSubject(closed), "a closed scope is never active").toEqual(EMAIL.record);
		expect(currentSubject(transition(closed, open(SCOPE.actionsBar)))).toEqual(ANSWER.record);
	});

	it("is null after a reader chooses an empty entry on the page, whatever a closed scope holds", () => {
		const state = run(open(SCOPE.actionsBar), activate(SCOPE.actionsBar, ANSWER), close(SCOPE.actionsBar), activate(SCOPE.page, NOTHING));
		expect(activeScope(state)).toBe(SCOPE.page);
		expect(currentSubject(state)).toBeNull();
	});

	it("does not move to a scope that is updated, such as a column closing or a session restored", () => {
		const state = run(activate(SCOPE.page, EMAIL), open(SCOPE.actionsBar), update(SCOPE.actionsBar, ANSWER));
		expect(currentSubject(state), "a restored session doesn't become active").toEqual(EMAIL.record);
		expect(currentSubject(transition(state, update(SCOPE.page, OTHER))), "an update to the active scope shows its new record").toEqual(OTHER.record);
	});

	it("is an updated scope's entry where the open scopes weren't activated", () => {
		expect(currentSubject(run(open(SCOPE.actionsBar), update(SCOPE.actionsBar, ANSWER)))).toEqual(ANSWER.record);
	});
});

describe("any sequence of events", () => {
	const SCOPES = [SCOPE.page, SCOPE.actionsBar, "another-panel"];
	const ENTRIES = [EMAIL, OTHER, QUESTION, ANSWER, NOTHING];

	it("selects the entry of the open scope activated last, else of the first open scope that was only updated", () => {
		// The rule stated again: the open scopes, the activation order and each scope's latest entry.
		runSequences(
			() => ({ state: INITIAL_SUBJECT, opened: new Set<string>([SCOPE.page]), activations: [] as string[], entries: new Map<string, TEntry>() }),
			(context, random, label) => {
				const scope = pickWith(random, SCOPES);
				const entry = pickWith(random, ENTRIES);
				const type = pickWith(random, SUBJECT_EVENTS);
				const event: TSubjectEvent = type === "activate" || type === "update" ? { type, scope, entry } : { type, scope };
				const named = label(`${type}:${scope}`);
				context.state = transition(context.state, event);
				const { activations, entries } = context;
				if (type === "activate" || type === "clear") {
					const at = activations.indexOf(scope);
					if (at >= 0) activations.splice(at, 1);
				}
				if (type === "activate") {
					activations.push(scope);
					entries.set(scope, entry);
				}
				if (type === "update") entries.set(scope, entry);
				if (type === "clear") entries.delete(scope);
				if (type === "open") context.opened.add(scope);
				if (type === "close") context.opened.delete(scope);
				const lastActivated = [...activations].reverse().find((s) => context.opened.has(s));
				const updatedOnly = [...context.opened].filter((s) => entries.has(s) && !activations.includes(s));
				const expected = lastActivated ?? updatedOnly[0] ?? null;
				expect(activeScope(context.state), named).toBe(expected);
				expect(activeEntry(context.state), named).toEqual(expected === null ? null : entries.get(expected));
			},
		);
	});
});
