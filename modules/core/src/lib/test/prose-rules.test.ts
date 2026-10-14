import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	allowanceFrom,
	NO_ALLOWANCE,
	PROSE_RULE_IDS,
	PROSE_RULES,
	proseOf,
	proseViolations,
	type TAllowance,
	type TProseRuleId,
	type TProseViolation,
	violationsIn,
} from "./prose-rules.js";

const MARKDOWN = "notes.md";
const SOURCE = "source.ts";
const SCRIPT = "script.mjs";
const TEST_SOURCE = "source.test.ts";
const FEATURE = "walk.feature.ts";
const PLAIN_FEATURE = "walk.feature";
const SHELL = "run.sh";
const CONFIGURATION = "config.json";
const ALLOWED_FILE = "docs/allowed.md";
const ANTHROPOMORPHIC = "anthropomorphic";
const RELATION_VERB = "relation-verb";
const THE_RUN = "the-run";
const BANNED_WORD = "banned-word";
const NEGATED_NOUN = "negated-noun";
const FIRST_PERSON = "first-person";
const EM_DASH = "em-dash";
const TERMINAL_PREPOSITION = "terminal-preposition";
const DASH_SAMPLE = "a—b";
const PERSONS = { entries: [], persons: ["Wren", "Lawrence"] };

const rulesOf = (violations: TProseViolation[]) => violations.map(({ rule }) => rule);
const linesOf = (violations: TProseViolation[]) => violations.map(({ line, rule }) => [line, rule]);
const matchesOf = (violations: TProseViolation[]) => violations.map(({ rule, match }) => [rule, match]);

describe("PROSE_RULES", () => {
	it("states the plain operation to write for each rule id", () => {
		expect(PROSE_RULES.map(({ id }) => id)).toEqual([...PROSE_RULE_IDS]);
		for (const rule of PROSE_RULES) expect(rule.instead.length, rule.id).toBeGreaterThan(0);
	});
});

describe("each rule", () => {
	it("reports a verb of a person's act whose subject is code", () => {
		expect(rulesOf(violationsIn(MARKDOWN, "The store knows the type."))).toEqual([ANTHROPOMORPHIC]);
		expect(rulesOf(violationsIn(SOURCE, "// The function decides which column opens."))).toEqual([ANTHROPOMORPHIC]);
		expect(rulesOf(violationsIn(MARKDOWN, "The model returns an answer."))).toEqual([ANTHROPOMORPHIC]);
	});

	it("reports a verb a prefix joins: `re-decide`, `half-answer`", () => {
		expect(matchesOf(violationsIn(MARKDOWN, "The graph doesn't re-decide its framing. Two primitives each half-answer a question."))).toEqual([
			[ANTHROPOMORPHIC, "re-decide"],
			[ANTHROPOMORPHIC, "half-answer"],
		]);
	});

	it("reports a relation stated as a place or a movement", () => {
		const violations = violationsIn(
			MARKDOWN,
			"The record lives in the store.\n\nThe log sits in the cache.\n\nThe key belongs to the site.\n\nThe ray meets the plane.\n\nThe write goes into the store.",
		);
		expect(linesOf(violations)).toEqual([1, 3, 5, 7, 9].map((line) => [line, RELATION_VERB]));
	});

	it("reports `lives`, `sits` and `belongs` whatever follows them, and `go` before a place", () => {
		const violations = violationsIn(MARKDOWN, "Where the record lives.\n\nWhere it sits.\n\nThe rules live only in core.\n\nMembers go under `items`.\n\nA value goes there.");
		expect(linesOf(violations)).toEqual([1, 3, 5, 7, 9].map((line) => [line, RELATION_VERB]));
	});

	it("reports `met` and `meeting on`", () => {
		expect(rulesOf(violationsIn(MARKDOWN, "A cycle ends at a record met again. Two runs start without meeting on a port."))).toEqual([RELATION_VERB, RELATION_VERB]);
	});

	it("reports a definite reference to a run, which names actuality", () => {
		expect(rulesOf(violationsIn(MARKDOWN, "Restart the run and read its log."))).toEqual([THE_RUN]);
		expect(matchesOf(violationsIn(MARKDOWN, "The steppers this run holds. The rail spans the whole run."))).toEqual([
			[THE_RUN, "this run"],
			[THE_RUN, "the whole run"],
		]);
	});

	it("reports each banned word", () => {
		const violations = violationsIn(
			MARKDOWN,
			"It is honest. Honestly it is. Being straight. The altitude. A fold. It folds. Folded. Folding. A seam. Seams. The blast radius. Bake it. It bakes. Baked. Baking. A load-bearing line. Earn it. It earns. Earned. Earning. Paying. A cost. Costs. Armed.",
		);
		expect(rulesOf(violations)).toEqual(Array(24).fill(BANNED_WORD));
	});

	it("reports `honesty`, `dishonest` and the forms of `pay for`", () => {
		expect(rulesOf(violationsIn(MARKDOWN, "The honesty of it. A dishonest step. The renderer pays it. It paid. A call doesn't pay for it."))).toEqual(Array(5).fill(BANNED_WORD));
	});

	it("reports an em-dash, a spaced en dash and an escaped em-dash in a comment", () => {
		expect(rulesOf(violationsIn(MARKDOWN, "The store — the graph — holds it. It reads `string` – a domain. Pages 1–3 hold it."))).toEqual([EM_DASH, EM_DASH, EM_DASH]);
		expect(rulesOf(violationsIn(SOURCE, "// It is blocked \\u2014 so it falls back."))).toEqual([EM_DASH]);
		expect(violationsIn(SOURCE, 'const dash = "a \\\\u2014 b";')).toEqual([]);
	});

	it("reports the first person", () => {
		expect(rulesOf(violationsIn(MARKDOWN, "We read it. Our page holds ours. It reads us. Let's read it. I read it. I'm reading."))).toEqual(Array(7).fill(FIRST_PERSON));
		expect(rulesOf(violationsIn(MARKDOWN, "My verdict holds. It is mine. It reads me. I read it myself. We read it ourselves."))).toEqual(Array(7).fill(FIRST_PERSON));
	});

	it("reports a negated noun", () => {
		const violations = violationsIn(MARKDOWN, "The page shows no records. Nothing changed. None of it. Nobody reads it. Neither holds it. It is nowhere.");
		expect(rulesOf(violations)).toEqual(Array(6).fill(NEGATED_NOUN));
	});

	it("reports `no` before any noun, a number, an underscore or a quote", () => {
		expect(rulesOf(violationsIn(MARKDOWN, 'It has no 2d context. It has no _links. It has no anchor/size. It names no "id".'))).toEqual(Array(4).fill(NEGATED_NOUN));
	});

	it("reports a sentence that ends on a preposition, in a comment, a prose string and Markdown", () => {
		const comment = "/** The graph area's composition root: the engine a persistence option names, the graph store actuality holds and the directory actuality keeps files in. */";
		expect(rulesOf(violationsIn(SOURCE, comment))).toEqual([TERMINAL_PREPOSITION]);
		expect(rulesOf(violationsIn(SOURCE, "// Makes one edge label and the indexes a read of a record's edges reads it by."))).toEqual([TERMINAL_PREPOSITION]);
		expect(rulesOf(violationsIn(SOURCE, "/** The text search configuration a search reads words with. */"))).toEqual([TERMINAL_PREPOSITION]);
		expect(rulesOf(violationsIn(SOURCE, 'throw new Error("It opens the registry the store reads each type\'s surface from.");'))).toEqual([TERMINAL_PREPOSITION]);
		expect(matchesOf(violationsIn(MARKDOWN, "The persistence option of a graph held in memory, which `PERSIST` defaults to."))).toEqual([[TERMINAL_PREPOSITION, "to"]]);
		const each = ["in", "with", "by", "to", "from", "of", "on", "at", "for", "into", "onto", "about", "through"].map((preposition) => `It reads ${preposition}.`).join(" ");
		expect(rulesOf(violationsIn(MARKDOWN, each))).toEqual(Array(13).fill(TERMINAL_PREPOSITION));
	});

	it("reports the line a violation starts on", () => {
		expect(linesOf(violationsIn(MARKDOWN, "Intro.\n\nThe store\nknows it. Restart the\nrun now."))).toEqual([
			[4, ANTHROPOMORPHIC],
			[4, THE_RUN],
		]);
	});
});

describe("allowed forms", () => {
	it("allows a verb whose subject in its clause is a person", () => {
		expect(violationsIn(MARKDOWN, "A person asks, answers and decides.")).toEqual([]);
		expect(violationsIn(MARKDOWN, "The operator decides what the reader knows.")).toEqual([]);
		expect(violationsIn(MARKDOWN, "The record is decided by the operator.")).toEqual([]);
		expect(violationsIn(MARKDOWN, "A reviewer asks how it holds. A graph fits how a cook thinks.")).toEqual([]);
		expect(rulesOf(violationsIn(MARKDOWN, "A person asks the model, and the model answers."))).toEqual([ANTHROPOMORPHIC]);
	});

	it("allows `who` as a person's subject, and `a reader who chose it` before its verb", () => {
		expect(violationsIn(MARKDOWN, "A person who decides holds it. A reader who chose an execution goes back to it. Someone who else lives there.")).toEqual([]);
		expect(rulesOf(violationsIn(MARKDOWN, "A caller had to state who it was and could forget."))).toEqual([ANTHROPOMORPHIC]);
	});

	it("doesn't take a possessive, an object, a modifier or a reduced relative clause's pronoun for the subject", () => {
		const violations = violationsIn(
			MARKDOWN,
			"The control the reader's address remembers.\n\nA root held by anyone else would decide it.\n\nA user selection lives in the root.\n\nEvery tool you are offered answers from it.\n\nIt is the reader's to decide.",
		);
		expect(linesOf(violations)).toEqual([
			[1, ANTHROPOMORPHIC],
			[3, ANTHROPOMORPHIC],
			[5, RELATION_VERB],
			[7, ANTHROPOMORPHIC],
		]);
	});

	it("takes the subject of a verb `and` joins from the start of its clause", () => {
		expect(rulesOf(violationsIn(MARKDOWN, "The model sees what the person is looking at and knows the rest."))).toEqual([ANTHROPOMORPHIC]);
		expect(violationsIn(MARKDOWN, "A person reads the page and decides.")).toEqual([]);
	});

	it("opens a clause at `as` after a comma, and reads it as a preposition elsewhere", () => {
		expect(rulesOf(violationsIn(MARKDOWN, "What the reader is on, as the machine decides it."))).toEqual([ANTHROPOMORPHIC]);
		expect(violationsIn(MARKDOWN, "A reader following a field as a tag learns that.")).toEqual([]);
	});

	it("reads a subject clause that ends before the verb as the subject", () => {
		expect(rulesOf(violationsIn(MARKDOWN, "The counts hold: where a reader is decides the scale."))).toEqual([ANTHROPOMORPHIC]);
	});

	it("reads `reader` as code after `of`, beside `writer` and before `that wants`", () => {
		const violations = violationsIn(
			MARKDOWN,
			"Readers of a schema go through the walker.\n\nEvery writer and reader goes through one parse.\n\nEvery reader that wants the type walks it.",
		);
		expect(linesOf(violations)).toEqual([
			[1, RELATION_VERB],
			[3, RELATION_VERB],
			[5, ANTHROPOMORPHIC],
		]);
	});

	it("allows `they` after a person, a credential's holder and a named fixture person directly before the verb", () => {
		expect(violationsIn(MARKDOWN, "A reader names a field. They may not know the rest.")).toEqual([]);
		expect(rulesOf(violationsIn(MARKDOWN, "Records hold it. They answer the query."))).toEqual([ANTHROPOMORPHIC]);
		expect(rulesOf(violationsIn(MARKDOWN, "Those answer a reader, and they don't answer another."))).toEqual([ANTHROPOMORPHIC, ANTHROPOMORPHIC]);
		expect(violationsIn(MARKDOWN, "The verifier requests a proof, and the holder answers with a token.")).toEqual([]);
		expect(matchesOf(violationsIn(MARKDOWN, "Asked whether the holder is over eighteen, the wallet answers yes."))).toEqual([
			[ANTHROPOMORPHIC, "Asked"],
			[ANTHROPOMORPHIC, "answers"],
		]);
		expect(violationsIn(MARKDOWN, "Wren answers the gate.", PERSONS)).toEqual([]);
		expect(rulesOf(violationsIn(MARKDOWN, "Wren's wallet answers the gate.", PERSONS))).toEqual([ANTHROPOMORPHIC]);
	});

	it("allows the first person of a fixture person a block names as its speaker", () => {
		expect(violationsIn(MARKDOWN, "Lawrence: I have known Bron since the reforms.", PERSONS)).toEqual([]);
		expect(rulesOf(violationsIn(MARKDOWN, "Lawrence: I have known Bron since the reforms."))).toEqual([FIRST_PERSON]);
	});

	it("allows 'an ask', the noun for a question a person puts to a model", () => {
		expect(violationsIn(MARKDOWN, "The page sends an ask to the model. The ask carries a question. A second ask follows it.")).toEqual([]);
	});

	it("reads a noun after a possessive and a modifier, or after a hyphenated modifier, where its phrase ends", () => {
		expect(violationsIn(MARKDOWN, "It holds the event stream's sync notice, and a window-cut notice.")).toEqual([]);
	});

	it("reads the noun `answer` as a response unless a person's possessive comes before it", () => {
		expect(rulesOf(violationsIn(MARKDOWN, "A reader weighing the answer reads it. It reads a streamed answer. It reads the zero-match answer."))).toEqual(
			Array(3).fill(ANTHROPOMORPHIC),
		);
		expect(violationsIn(MARKDOWN, "The page shows the reader's answer and the operator's own answer.")).toEqual([]);
	});

	it("reads a base form as a verb after `these`, after a plural and `that`, after a number, after a coordinated subject and after a causative", () => {
		const violations = violationsIn(
			MARKDOWN,
			"These ask the stepper.\n\nThe modules that decide hold it.\n\nThe two agree.\n\nThe app and the server agree.\n\nIt lets a view tell them apart.\n\nThe two ask for opposite framings.",
		);
		expect(linesOf(violations)).toEqual([1, 3, 5, 7, 9, 11].map((line) => [line, ANTHROPOMORPHIC]));
	});

	it("reads a participle between a quantifier and a noun as an adjective", () => {
		expect(violationsIn(MARKDOWN, "It reads all known vertex labels.")).toEqual([]);
	});

	it("allows a capitalized name within a sentence, but not a word in capitals or a title-case heading", () => {
		expect(violationsIn(MARKDOWN, "The page opens in the Ask mode. It is LAST KNOWN.")).toEqual([]);
		expect(rulesOf(violationsIn(MARKDOWN, "The page reads the bodies that have been ASKED for, in order."))).toEqual([ANTHROPOMORPHIC]);
		expect(rulesOf(violationsIn(MARKDOWN, "# Logic in Haibun: Claims, Rules, and Derived Answers"))).toEqual([ANTHROPOMORPHIC]);
		expect(rulesOf(violationsIn(MARKDOWN, "- **NQ2.** Answered in stage 4."))).toEqual([ANTHROPOMORPHIC]);
	});

	it("reads a promise as a noun unless it takes an infinitive or an object, or closes a `what` clause", () => {
		expect(violationsIn(SOURCE, "// Returns a promise that resolves.")).toEqual([]);
		expect(rulesOf(violationsIn(SOURCE, "// The step promises to return."))).toEqual([ANTHROPOMORPHIC]);
		expect(rulesOf(violationsIn(SOURCE, "// What a launcher promised its caller holds."))).toEqual([ANTHROPOMORPHIC]);
		expect(rulesOf(violationsIn(SOURCE, "// It draws inside the view, which is what following promises."))).toEqual([ANTHROPOMORPHIC]);
	});

	it("allows `thinking` as the name of a model's reasoning mode", () => {
		expect(violationsIn(MARKDOWN, "The call runs with thinking off. A profile turns thinking on. It sends a thinking level.")).toEqual([]);
		expect(rulesOf(violationsIn(MARKDOWN, "A model left thinking spends its limit."))).toEqual([ANTHROPOMORPHIC]);
	});

	it("allows `asked` after a question's noun and before a model's clause, and not before an agent that is code", () => {
		expect(violationsIn(MARKDOWN, "Asked to run the suite, the model calls the run tools. A question asked on the graph carries it.")).toEqual([]);
		expect(rulesOf(violationsIn(MARKDOWN, "A turn asked by a key makes each call."))).toEqual([ANTHROPOMORPHIC]);
	});

	it("allows a past form that is a Markdown sentence on its own", () => {
		expect(violationsIn(MARKDOWN, "Tier 3 is written in core. Decided.\n\n## Decided\n\nAnswered: the backoff is deleted.")).toEqual([]);
		expect(rulesOf(violationsIn(SOURCE, "// Decided."))).toEqual([ANTHROPOMORPHIC]);
	});

	it("allows an instruction to the reader, but not in a comment, a test title or an assertion's message", () => {
		expect(violationsIn(MARKDOWN, "Ask the operator first.\n\n- [x] Decide the stepper's name.")).toEqual([]);
		expect(rulesOf(violationsIn(SOURCE, "// Ask the operator first."))).toEqual([ANTHROPOMORPHIC]);
		expect(rulesOf(violationsIn(TEST_SOURCE, 'it("asking for less reads at less", () => {\n\texpect(1, "knowing the level holds").toBe(1);\n});'))).toEqual([
			ANTHROPOMORPHIC,
			ANTHROPOMORPHIC,
		]);
	});

	it("doesn't open an instruction at a closing bracket, after code, or after a plural label", () => {
		const violations = violationsIn(MARKDOWN, "Embeddings (768-dim) live in a table.\n\n1. **Events** (via `onEvent`) - to know when to show it.\n\n`Scenes` live in the view.");
		expect(linesOf(violations)).toEqual([1, 3, 5].map((line) => [line, line === 3 ? ANTHROPOMORPHIC : RELATION_VERB]));
		expect(rulesOf(violationsIn(SOURCE, 'const text = "Trust queries: answer a proof before a holder discloses.";'))).toEqual([ANTHROPOMORPHIC]);
		expect(violationsIn(SOURCE, 'const text = "Fork: ask it again as a new branch.";')).toEqual([]);
	});

	it("allows a run counted among several, the run document, record or steps, and a run a block supervises", () => {
		expect(violationsIn(MARKDOWN, "Each test starts a run, and a run writes its log.")).toEqual([]);
		expect(violationsIn(MARKDOWN, "The run document reads the run record and the run steps.")).toEqual([]);
		expect(violationsIn(MARKDOWN, "The supervisor holds the child, so it reports when the run ends.")).toEqual([]);
	});

	it("allows `no longer`, `no more than`, `no-op` and a closing `no more`", () => {
		expect(violationsIn(MARKDOWN, "The step no longer reads it. It takes no more than a second. The handler is a no-op. It lists it no more.")).toEqual([]);
		expect(rulesOf(violationsIn(MARKDOWN, "It grants it and no more."))).toEqual([NEGATED_NOUN]);
	});

	it("allows a sentence that ends on a word that isn't a preposition, a quoted example, code, an identifier and a phrasal verb's particle", () => {
		expect(violationsIn(MARKDOWN, "Returns the engine. It reads at private. It reads from the store, in order.")).toEqual([]);
		expect(violationsIn(MARKDOWN, 'The rule names "the directory actuality keeps files in." A key is `in`. It reads `from`. It reads src/to. It reads e.g.in.')).toEqual([]);
		expect(violationsIn(SOURCE, "const message = `It reads from ${source}.`;")).toEqual([]);
		expect(violationsIn(MARKDOWN, "A profile turns thinking on. The person signs in. The page opts the reader in.")).toEqual([]);
		expect(rulesOf(violationsIn(MARKDOWN, "The person signs the record the store writes in."))).toEqual([TERMINAL_PREPOSITION]);
	});

	it("allows `none` alone in a table cell, an element or a CSS value", () => {
		expect(violationsIn(MARKDOWN, "| 3 | Superseded | none |")).toEqual([]);
		expect(violationsIn(SOURCE, 'const empty = html`<span class="empty">none</span>`;')).toEqual([]);
		expect(rulesOf(violationsIn(MARKDOWN, "It reads none of it."))).toEqual([NEGATED_NOUN]);
	});

	it("allows I/O and a numbered part", () => {
		expect(violationsIn(MARKDOWN, "The stepper reads I/O.\n\n# Part I: the test layer")).toEqual([]);
	});

	it("doesn't read an identifier", () => {
		expect(violationsIn(MARKDOWN, "Names: answeredFor, llm-answer, DOMAIN_LLM_ANSWER, the-run, src/nothing.ts and $us.")).toEqual([]);
	});

	it("doesn't read code in backticks, an address or an letter address", () => {
		expect(violationsIn(MARKDOWN, "Run `the run knows` at https://example.com/nothing or write to nobody@example.com.")).toEqual([]);
	});

	it("doesn't read a CSS declaration or a quoted keyword, and reads a comment among the declarations", () => {
		expect(violationsIn(SOURCE, "const style = `.panel { display: none; }`;\nconst policy = \"default-src 'none'\";")).toEqual([]);
		expect(rulesOf(violationsIn(SOURCE, "const style = `.panel { /* The label sits at the bottom. */ display: none; }`;"))).toEqual([RELATION_VERB]);
	});

	it("reads a stylesheet only through its comments", () => {
		const violations = violationsIn(SOURCE, "const styles = css`\n.none { flex: none; }\n.decide button { cursor: pointer; }\n/* The controls sit at the bottom. */\n`;");
		expect(linesOf(violations)).toEqual([[4, RELATION_VERB]]);
	});

	it("reads a readable attribute of markup as its own sentence", () => {
		const violations = violationsIn(SOURCE, 'const tip = html`<input title="A round is one reply. A turn fails without answering." />`;');
		expect(matchesOf(violations)).toEqual([[ANTHROPOMORPHIC, "answering"]]);
	});

	it("skips a mention: a quoted span of one sentence, a quoted token, a quoted label and a cited test title", () => {
		expect(violationsIn(MARKDOWN, 'The rule names "the run", "honest" and "names no type". A panel reads "what I can do next".')).toEqual([]);
		expect(violationsIn(MARKDOWN, 'It records "known" tabs. A card carries a "go to" control. `a.test.ts` "answers each caller" holds it.')).toEqual([]);
		expect(rulesOf(violationsIn(MARKDOWN, "It says the run is done. It reports a run."))).toEqual([ANTHROPOMORPHIC, THE_RUN]);
	});

	it("doesn't read a word an arrow joins", () => {
		expect(violationsIn(MARKDOWN, "Grant → petition and say → ask were in place. Alice -> knows -> Bob.")).toEqual([]);
		expect(rulesOf(violationsIn(MARKDOWN, "←/→ asks the column."))).toEqual([ANTHROPOMORPHIC]);
	});

	it("allows `meet` with a criterion, `met` where its clause names one, `live` as an adjective and `go to` an address", () => {
		expect(violationsIn(MARKDOWN, "Every request meets a performance threshold. The condition is met. The stream is live on the page.")).toEqual([]);
		expect(violationsIn(SOURCE, "const message = `Did not go to ${url}`;")).toEqual([]);
	});

	it("doesn't read a step pattern, a literal type, a property key, a module specifier, a selector or a query", () => {
		const violations = violationsIn(
			SOURCE,
			'import "the run";\ntype TMode = "the run";\nconst steps = { knows: { gwta: "the run decides {what}", exact: "the run knows" } };\nconst keys = { "the run": 1 };\ndocument.querySelector("nothing here");\nnew RegExp("the run");\nengine.query("ON CONFLICT DO NOTHING");\nrpcAnswer({ error: "no such step" });\nactionOKWithProducts({ count: "no count" });',
		);
		expect(violations).toEqual([]);
	});

	it("doesn't read a value a test asserts, and reads the message of the assertion", () => {
		const violations = violationsIn(SOURCE, 'expect(read("the run knows")).toBe("nothing");\nexpect(value, "The store knows it.").toEqual("the run");');
		expect(linesOf(violations)).toEqual([[2, ANTHROPOMORPHIC]]);
	});

	it("doesn't read JSON, a record's content or a fixture person's question", () => {
		const violations = violationsIn(
			SOURCE,
			'const line = \'{"in":"set answer to ready"}\';\nconst letter = { subject: "We meet", body: "I will be there." };\nconst send = (id: string, body: string) => id + body;\nsend("1", "Let us meet.");\naskExchange("What did it say?");',
		);
		expect(violations).toEqual([]);
	});

	it("reads a test title, an error message and a description as prose", () => {
		const violations = violationsIn(
			SOURCE,
			'it("decides the order", () => {\n\tthrow new Error("The store knows it.");\n});\nconst step = { description: "The step remembers it." };\nclass Echo { description = "Steps that answer a ping."; }',
		);
		expect(linesOf(violations)).toEqual([
			[1, ANTHROPOMORPHIC],
			[2, ANTHROPOMORPHIC],
			[4, ANTHROPOMORPHIC],
			[5, ANTHROPOMORPHIC],
		]);
	});

	it("reads a test's strings as prose only where they are a title, a message, a description or feature text", () => {
		const violations = violationsIn(
			TEST_SOURCE,
			'const reply = "I need to ask host 9.";\nfunction within(what: string) { throw new Error(`${what}: late`); }\nwithin("the store knows it");\nit.each([1])("answering %i reports it", () => {});\nconst named = { description: "Steps that answer a ping." };\nactionNotOK(`reads at ${level ?? "no ceiling"}`);',
		);
		expect(linesOf(violations)).toEqual([
			[3, ANTHROPOMORPHIC],
			[4, ANTHROPOMORPHIC],
			[5, ANTHROPOMORPHIC],
			[6, NEGATED_NOUN],
		]);
	});

	it("doesn't read a test title its test passes as input", () => {
		expect(violationsIn(TEST_SOURCE, 'it("Given I test", () => {\n\texpect(dePolite("Given I test")).toBe("test");\n});')).toEqual([]);
	});

	it("reads a template nested in a substitution as part of its sentence", () => {
		const violations = violationsIn(SOURCE, 'const named = `step ${name}${passed ? ` answering as ${other}` : ""}`;');
		expect(matchesOf(violations)).toEqual([[ANTHROPOMORPHIC, "answering"]]);
	});

	it("doesn't read a licence notice a derived file carries", () => {
		const header =
			"/**\n * Copyright (c) Microsoft Corporation.\n *\n * Unless required by applicable law or agreed to in writing, software\n *\n * Derived from upstream. Changed: it knows the tab.\n */";
		expect(linesOf(violationsIn(SOURCE, header))).toEqual([[6, ANTHROPOMORPHIC]]);
	});

	it("doesn't read fenced code", () => {
		expect(violationsIn(MARKDOWN, "Text.\n\n```ts\n// the run knows nothing\n```\n\n~~~\nnothing\n~~~")).toEqual([]);
	});
});

describe("feature text", () => {
	it("reads a feature's sentences and headings, and leaves its steps and the invocations it declares", () => {
		const violations = violationsIn(
			FEATURE,
			`export const features = {
	Walk: [
		'set nothing to "x"',
		"Activity: Nothing queues",
		"waypoint Nothing waits with variable n is 0",
		"Nothing waits",
		"Nothing queues",
		"Nothing is checked.",
		"When I have nothing",
		"Feature: Nothing recurses",
	],
};`,
		);
		expect(linesOf(violations)).toEqual([
			[4, NEGATED_NOUN],
			[8, NEGATED_NOUN],
			[10, NEGATED_NOUN],
		]);
	});

	it("leaves an activity heading whose name a waypoint declares", () => {
		const content = "Activity: Knows about data\\nwaypoint Knows about data with variable d exists\\nensure Knows about data";
		expect(violationsIn(SOURCE, `const feature = { path: "/f.feature", content: "${content}" };`)).toEqual([]);
	});

	it("reads a line that opens with markup or a quoted sentence, and a step's quoted argument that holds a sentence", () => {
		const violations = violationsIn(
			FEATURE,
			`export const features = {
	Walk: [
		"**The store** knows it",
		'"Every address asks its visitors to sign in"',
		'ask model "local" prompt "Say what the test run reported. Name nothing else."',
	],
};`,
		);
		expect(linesOf(violations)).toEqual([
			[3, ANTHROPOMORPHIC],
			[4, ANTHROPOMORPHIC],
			[5, NEGATED_NOUN],
		]);
	});

	it("reads a builder's prose arguments as prose, its statements as steps, and its other arguments as a step's values", () => {
		const violations = violationsIn(
			FEATURE,
			`export const features = {
	Walk: [
		scenario({ scenario: "The store knows it" }),
		annotate({ role: "answers whether it holds", note: "It is no finding." }),
		set({ what: "x", value: '"The store knows it"', confidence: "known since then" }),
		not({ statement: "set nothing to 1" }),
	],
};
const clauseSuffix = (clause: string) => { throw new Error(\`clause \${clause} has no opening\`); };`,
		);
		expect(linesOf(violations)).toEqual([
			[3, ANTHROPOMORPHIC],
			[4, ANTHROPOMORPHIC],
			[4, NEGATED_NOUN],
			[9, NEGATED_NOUN],
		]);
	});

	it("reads every feature a conditional export holds", () => {
		expect(linesOf(violationsIn(FEATURE, 'export const features = ready ? { Walk: ["The store knows it."] } : {};'))).toEqual([[1, ANTHROPOMORPHIC]]);
	});

	it("reads a unit test's feature text a line at a time, through every declaration a runner names", () => {
		expect(linesOf(violationsIn(SOURCE, 'const content = "set nothing to 1\\nNothing is set.";\nawait passWithDefaults(content, []);'))).toEqual([[1, NEGATED_NOUN]]);
		const twice =
			'it("a", async () => {\n\tconst feature = { path: "/a", content: "set nothing to 1" };\n\tawait passWithDefaults([feature], []);\n});\nit("b", async () => {\n\tconst feature = { path: "/b", content: "set nobody to 2" };\n\tawait passWithDefaults([feature], []);\n});';
		expect(violationsIn(SOURCE, twice)).toEqual([]);
	});

	it("reads a plain feature file as feature text", () => {
		expect(linesOf(violationsIn(PLAIN_FEATURE, "We set up the variables.\nset x to 1\nFeature: First feature\nWhen I have a test"))).toEqual([[1, FIRST_PERSON]]);
	});
});

describe("other files", () => {
	it("reads a script's comments and strings", () => {
		expect(rulesOf(violationsIn(SCRIPT, '// Errors if the version has no suffix.\nconsole.log("Nothing to graduate.");'))).toEqual([NEGATED_NOUN, NEGATED_NOUN]);
	});

	it("reads a shell script's comments as Markdown and the text it echoes, and not its first line", () => {
		const violations = violationsIn(SHELL, '#!/bin/sh\n# With no filter the whole base runs.\n#\n# Ask the agent to run it.\necho "agent: no config.json in $BASE" >&2');
		expect(linesOf(violations)).toEqual([
			[2, NEGATED_NOUN],
			[5, NEGATED_NOUN],
		]);
	});

	it("reads a test group's configuration descriptions", () => {
		const violations = violationsIn(CONFIGURATION, '{\n\t"description": "An instance this run launches.",\n\t"name": "the run"\n}');
		expect(linesOf(violations)).toEqual([[2, THE_RUN]]);
	});
});

describe("proseOf", () => {
	it("reads comments through the compiler, so a comment marker inside a string isn't a comment", () => {
		expect(proseOf(SOURCE, '#!/usr/bin/env node\n/// <reference types="node" />\nconst u = "a // b";\n// A note.\nconst v = 1; /* A trailing note. */')).toEqual([
			{ line: 3, text: "a // b", kind: "string" },
			{ line: 4, text: "A note.", kind: "comment" },
			{ line: 5, text: "A trailing note.", kind: "comment" },
		]);
	});

	it("numbers each line of a JSDoc block and a template", () => {
		expect(proseOf(SOURCE, "/**\n * First line.\n * Second line.\n */\nconst t = `One line\nanother line`;")).toEqual([
			{ line: 2, text: "First line.", kind: "comment" },
			{ line: 3, text: "Second line.", kind: "comment" },
			{ line: 5, text: "One line", kind: "string" },
			{ line: 6, text: "another line", kind: "string" },
		]);
	});

	it("reads a template's substitution as a placeholder within its line", () => {
		const [segment] = proseOf(SOURCE, "const t = `No ${count} records`;");
		expect(segment?.text).toMatch(/^No \$\{…\} records$/);
		expect(rulesOf(violationsIn(SOURCE, "const t = `No ${count} records`;"))).toEqual([NEGATED_NOUN]);
	});

	it("reads a literal haibun quotes as a whole without its quotes", () => {
		expect(proseOf(SOURCE, "const text = '\"A note this run holds.\"';")).toEqual([{ line: 1, text: "A note this run holds.", kind: "string" }]);
	});

	it("reads a Markdown line outside fenced code", () => {
		expect(proseOf(MARKDOWN, "# Title\n\n```\ncode line\n```\nA closing line.")).toEqual([
			{ line: 1, text: "# Title", kind: "markdown" },
			{ line: 6, text: "A closing line.", kind: "markdown" },
		]);
	});
});

describe("allowance", () => {
	it("removes the violation an entry names by file, rule and the text that contains it", () => {
		const allow = (file: string, rule: TProseRuleId, text: string): TAllowance => ({ entries: [{ file, rule, text, reason: "The sample allows it." }], persons: [] });
		expect(linesOf(violationsIn(ALLOWED_FILE, "The store knows it.\n\nThe page knows it.", allow(ALLOWED_FILE, ANTHROPOMORPHIC, "The store knows")))).toEqual([
			[3, ANTHROPOMORPHIC],
		]);
		expect(violationsIn(ALLOWED_FILE, "The store knows it.", allow("docs/other.md", ANTHROPOMORPHIC, "The store knows"))).toHaveLength(1);
		expect(violationsIn(ALLOWED_FILE, "The store knows it.", allow(ALLOWED_FILE, THE_RUN, "The store knows"))).toHaveLength(1);
		expect(violationsIn(ALLOWED_FILE, "The store knows it.", allow(ALLOWED_FILE, ANTHROPOMORPHIC, "The store"))).toHaveLength(1);
	});

	it("checks an allowance for entries, each with a file, a rule, the text and a reason, and for persons, each a name", () => {
		const entry = { file: "a.md", rule: EM_DASH, text: "x", reason: "y" };
		expect(allowanceFrom({ entries: [entry], persons: ["Wren"] }, "allowed.json")).toEqual({ entries: [entry], persons: ["Wren"] });
		expect(() => allowanceFrom({ entries: [{ ...entry, rule: "other" }], persons: [] }, "allowed.json")).toThrow(/entry 0/);
		expect(() => allowanceFrom({ entries: [{ ...entry, text: "" }], persons: [] }, "allowed.json")).toThrow(/entry 0/);
		expect(() => allowanceFrom({ entries: [{ ...entry, extra: 1 }], persons: [] }, "allowed.json")).toThrow(/entry 0/);
		expect(() => allowanceFrom({ entries: [], persons: [""] }, "allowed.json")).toThrow(/persons/);
		expect(() => allowanceFrom({ entries: [], persons: [], extra: 1 }, "allowed.json")).toThrow(/extra/);
		expect(() => allowanceFrom([], "allowed.json")).toThrow(/entries/);
	});
});

describe("proseViolations", () => {
	const made: string[] = [];
	afterEach(() => {
		for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
	});
	/** A repository in a temporary directory, holding each file at its path. */
	const repository = (files: Record<string, string>): string => {
		const root = mkdtempSync(join(tmpdir(), "prose-rules-"));
		made.push(root);
		mkdirSync(join(root, ".git"));
		for (const [path, text] of Object.entries(files)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), text);
		}
		return root;
	};

	it("walks the prose files under a root and skips dependencies, build output, links and excluded paths", () => {
		const root = repository({
			"docs/a.md": DASH_SAMPLE,
			"src/b.ts": "//Nothing",
			"src/c.txt": DASH_SAMPLE,
			"scripts/d.sh": `# ${DASH_SAMPLE}`,
			"node_modules/d.md": DASH_SAMPLE,
			"build/e.md": DASH_SAMPLE,
			"capture/f.md": DASH_SAMPLE,
			"docs/excluded.md": DASH_SAMPLE,
		});
		symlinkSync(join(root, "docs/a.md"), join(root, "docs/link.md"));
		const files = proseViolations([root], { exclude: [/^docs\/excluded\.md$/] });
		expect(files.map(({ path, violations }) => [path, rulesOf(violations)])).toEqual([
			["docs/a.md", [EM_DASH]],
			["scripts/d.sh", [EM_DASH]],
			["src/b.ts", [NEGATED_NOUN]],
		]);
	});

	it("removes an allowed violation, and throws for an entry that doesn't match one", () => {
		const root = repository({ "docs/a.md": DASH_SAMPLE });
		const allowance = (text: string): TAllowance => ({ ...NO_ALLOWANCE, entries: [{ file: "docs/a.md", rule: EM_DASH, text, reason: "The sample shows an allowed dash." }] });
		expect(proseViolations([root], { allowance: allowance(DASH_SAMPLE) })).toEqual([]);
		expect(() => proseViolations([root], { allowance: allowance("c—d") })).toThrow(/doesn't match a violation/);
	});
});
