/**
 * The Writing rules a pattern detects, and the violations they find in the prose of source files (prose-sources.ts). A word
 * in backticks, in an address or in an identifier isn't prose.
 */
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { listedFiles } from "../adapters/listed-files.js";
import { isProseFile, proseBlocks, type TProseBlock, type TProseKind } from "./prose-sources.js";

export type { TProseKind } from "./prose-sources.js";
export const PROSE_RULE_IDS = ["anthropomorphic", "relation-verb", "the-run", "banned-word", "em-dash", "first-person", "negated-noun", "terminal-preposition"] as const;
export type TProseRuleId = (typeof PROSE_RULE_IDS)[number];
/** A line of prose, with the number of the source line where it starts. */
export type TProseSegment = { line: number; text: string; kind: TProseKind };
/** A violation a file holds on purpose: the file by its path from the repository root, the rule, text of the segment that contains the match, and why. */
export type TAllowed = { file: string; rule: TProseRuleId; text: string; reason: string };
/** What a consumer allows: the violations its files hold on purpose, and the names of the fixture persons its prose names as subjects. */
export type TAllowance = { entries: readonly TAllowed[]; persons: readonly string[] };
export type TProseViolation = { line: number; rule: TProseRuleId; kind: TProseKind; match: string; text: string };
/** The violations in one file, by its path from its repository root. */
export type TProseFile = { repository: string; path: string; violations: TProseViolation[] };
/** A word of a block, as its lower case form with a straight apostrophe and without a possessive ending. */
export type TWord = { start: number; end: number; lower: string; possessive: boolean };
/**
 * A block of prose as the rules read it: its text, its text with code, addresses and markup masked, its words, where each
 * sentence ends, where an instruction may open, the quoted spans within one sentence, and the fixture persons it may name.
 */
export type TReadBlock = {
	kind: TProseKind;
	instructs: boolean;
	text: string;
	masked: string;
	words: TWord[];
	breaks: number[];
	openings: number[];
	quotes: [number, number][];
	persons: ReadonlySet<string>;
};
/** A pattern's match in a block. */
export type TFound = { block: TReadBlock; start: number; end: number; word: string };
export type TProseRule = { id: TProseRuleId; pattern: RegExp; instead: string; allows?: (found: TFound) => boolean };

type TVerbTense = "base" | "third" | "past" | "ing";
type TVerbForm = { base: string; tense: TVerbTense };
type TScan = { violations: TProseViolation[]; used: Set<TAllowed> };
/** A span the rules don't read, and how it is masked when part of it stays readable. */
type TUnreadSpan = { pattern: RegExp; mask?: (found: string) => string };

export const NO_ALLOWANCE: TAllowance = { entries: [], persons: [] };
const GIT_DIRECTORY = ".git";

/** What an unread character becomes: it isn't a word character or whitespace, so a phrase doesn't match across it. */
const MASK = "\uFFFC";
/** What the edge of a masked span becomes where the text inside it reads as its own sentence. */
const SPAN_BREAK = "|";
const UNMASKED = /[^\n]/g;
const maskAll = (found: string): string => found.replace(UNMASKED, MASK);
/** Attributes of markup whose value a person reads: a tooltip, a label, an image's text and a field's hint. */
const READABLE_ATTRIBUTE = /(\b(?:title|aria-label|alt|placeholder)\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;
const CSS_DECLARATIONS_OR_COMMENT = /\/\*([\s\S]*?)\*\/|[^\n]/g;

/** Markup masked but for the values of its readable attributes, each read as its own sentence. */
function maskTag(tag: string): string {
	let masked = "";
	let at = 0;
	for (const found of tag.matchAll(READABLE_ATTRIBUTE)) {
		const value = found[2] ?? found[3] ?? "";
		const opens = found.index + (found[1]?.length ?? 0);
		masked += `${maskAll(tag.slice(at, opens))}${SPAN_BREAK}${value}${SPAN_BREAK}`;
		at = opens + value.length + 2;
	}
	return `${masked}${maskAll(tag.slice(at))}`;
}

/** A CSS rule's declarations masked, and the comments among them read as their own sentences. */
function maskDeclarations(rule: string): string {
	return rule.replace(CSS_DECLARATIONS_OR_COMMENT, (part, comment: string | undefined) => (comment === undefined ? MASK : `${SPAN_BREAK}*${comment}*${SPAN_BREAK}`));
}

/**
 * The spans the rules don't read, in the order they are masked: a test's title cited after its file, code in backticks, an
 * address, an email address, a link's target, markup, a substitution, a CSS rule's declarations, a single-quoted keyword
 * ('none'), a double-quoted single token ("known"), a double-quoted label after an article or a possessive (a "go to"), and
 * the words an arrow joins (say → ask). A substitution is masked before the CSS rule that holds it.
 */
const UNREAD_SPANS: readonly TUnreadSpan[] = [
	{ pattern: /(?<=`[^`\s]+\.test\.ts`\s+)"[^"\n]+"/g },
	{ pattern: /(`+)[\s\S]*?\1/g },
	{ pattern: /\b[a-z][a-z\d+.-]*:\/\/[^\s<>"'`)\]]+/gi },
	{ pattern: /\bwww\.[^\s<>"'`)\]]+/gi },
	{ pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
	{ pattern: /\]\([^)\s]*\)/g },
	{ pattern: /<\/?[a-z][^<>]*>/gi, mask: maskTag },
	{ pattern: /\$\{[^}]*\}/g },
	{ pattern: /\{\s*(?:\/\*[\s\S]*?\*\/\s*)*(?:--)?[a-z][a-z-]*\s*:[^{}]*\}/gi, mask: maskDeclarations },
	{ pattern: /'[^'\s]+'/g },
	{ pattern: /"[^"\s]+"|“[^”\s]+”/g },
	{ pattern: /(?<=\b(?:an?|the|[\p{L}\p{N}_]+['’]s)\s+)(?:"[^"\n]{1,80}"|“[^”\n]{1,80}”)/giu },
	{ pattern: /[\p{L}\p{N}_]+(?=\s*(?:→|->|⇒)\s*[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_]\s*(?:→|->|⇒)\s*)[\p{L}\p{N}_]+/gu },
];
const WORD = /[\p{L}\p{N}_]+(?:['’]\p{L}+)*/gu;
const WORD_CHARACTER = /^[\p{L}\p{N}_]$/u;
const POSSESSIVE = /'s$/;
const CURLY_APOSTROPHE = /’/g;
/** Characters that join two words into one identifier: kebab-case, dotted, path, scheme, assignment and email names. */
const IDENTIFIER_JOINS = new Set(["-", ".", "/", ":", "=", "@"]);
/** Characters that make the word after them an identifier: `$name`, `#Type`, `@tag`, `%I`, `\n`. */
const IDENTIFIER_SIGILS = new Set(["$", "#", "@", "%", "\\"]);
const SENTENCE_BREAK = /[.!?](?=[\s"'’”)\]*_]|$)|[;:](?=\s|$)|[()[\]{}|—–→•]|\n\s*\n/g;
/** Where an instruction may open: a sentence's end, a task-list box, an opening bracket, a table cell, a list mark or a blank line. A closing bracket doesn't open one. */
const INSTRUCTION_OPENING = /[.!?](?=[\s"'’”)\]*_]|$)|[;:](?=\s|$)|\[[ xX~]\]|[([|•→]|\n\s*\n/g;
/** A quoted span within one sentence and one table cell: the prose mentions what it quotes. */
const QUOTED_SPAN = /"[^"|.!?]{1,200}[.!?,]?"|“[^”|.!?]{1,200}[.!?,]?”/g;
const WHITESPACE = /^\s+$/;
const WHITESPACE_RUN = /\s+/g;
const PERSON_AGENT = /^\s+by\s+(?:(?:the|a|an|its|their|each|every|this|that|one|any)\s+)?([\p{L}'’]+)/iu;
const INFINITIVE = /^\s+to\s+(\p{L}+)/iu;
/** What follows a verb that takes an object: an article, a pronoun or a possessive. */
const OBJECT_AFTER = /^\s+(?:a|an|the|its|it|them|their|his|her|this|that|every|each|[\p{L}\p{N}_]+['’]s)\b/iu;
/** A criterion a value satisfies, after `meet` and an optional article and modifier: `meets a performance threshold`. */
const CRITERION_AFTER =
	/^\s+(?:(?:a|an|the|its|their|each|every|this|that|any|all)\s+)?(?:[\p{L}-]+\s+)?(?:threshold|requirement|condition|criterion|criteria|constraint|limit|bound|deadline|target|expectation|standard|filter|need)s?\b/iu;
/** A criterion a clause can state is `met`: `the condition is met`, `reports the goal as already met`. */
const CRITERION_NOUN =
	/^(?:threshold|requirement|condition|precondition|postcondition|criterion|criteria|constraint|limit|bound|deadline|target|expectation|standard|filter|need|goal|request|obligation)s?$/;
/** A plural label at the start of a line, before the colon that opens what it names, whose number a base form matches: `Trust queries: answer …`. */
const PLURAL_LABEL = /(?:^|\n)\s*\p{Lu}[\p{L}\p{N}' -]{0,40}(?<!s)s:\s*$/u;
/** A speaker named at the start of a block, whose words follow: `Lawrence: I have known …`. */
const ATTRIBUTION = /^\s*(\p{L}+):\s/u;
/** A heading in Markdown. */
const MARKDOWN_HEADING = /^#{1,6}\s/;
/** `a`, `an` or a possessive and a hyphenated modifier, before a noun: `a window-cut notice`. */
const HYPHENATED_MODIFIER_BEFORE = /(?:\b(?:a|an)|[\p{L}\p{N}_]+['’]s)\s+[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)+\s+$/iu;
/** Any determiner and a hyphenated modifier, before a noun: `the zero-match answer`. */
const HYPHENATED_AFTER_DETERMINER = /(?:\b(?:a|an|the|its|their|this|that|each|every|one)|[\p{L}\p{N}_]+['’]s)\s+[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)+\s+$/iu;
/** Punctuation, a joining sign or the end, after the last word of a noun phrase. */
const CLOSES_PHRASE_AFTER = /^\s*(?:[.,;:!?)\]+&]|$)/;
const AFTER_COMMA = /,\s*$/;
/** `more` that ends its clause after `no`: `lists it no more.` */
const NO_MORE_CLOSING = /^\s+more\s*(?:[,.;:)]|$)/i;
/** `to` alone between a person's possessive and the verb: `the reader's to decide`. */
const TO_BETWEEN = /^\s+to\s+$/;
/** A block that names the record of a test run or the supervision of one, where `the run` names that run rather than actuality. */
const SUPERVISED_RUN = /\b(?:test\s+runs?|supervis\w*|SUPERVISOR\w*)\b/i;
const VERB_PREFIX = /^(?:re|half|mid)-/i;
const PLURAL_ENDING = /s$/;
const ADVERB_ENDING = /ly$/;
const CAPITALIZED = /^\p{Lu}/u;
const LETTERS = /\p{L}/gu;
const PARTICIPLE_ENDING = /(?:ed|en|wn|ght)$/;

type TVerbForms = { base: string; third: string; past: readonly string[]; ing: string };
/** The verbs only a person performs, each by its forms. */
const ANTHROPOMORPHIC_VERBS: readonly TVerbForms[] = [
	{ base: "answer", third: "answers", past: ["answered"], ing: "answering" },
	{ base: "ask", third: "asks", past: ["asked"], ing: "asking" },
	{ base: "say", third: "says", past: ["said"], ing: "saying" },
	{ base: "tell", third: "tells", past: ["told"], ing: "telling" },
	{ base: "know", third: "knows", past: ["knew", "known"], ing: "knowing" },
	{ base: "want", third: "wants", past: ["wanted"], ing: "wanting" },
	{ base: "think", third: "thinks", past: ["thought"], ing: "thinking" },
	{ base: "believe", third: "believes", past: ["believed"], ing: "believing" },
	{ base: "decide", third: "decides", past: ["decided"], ing: "deciding" },
	{ base: "hear", third: "hears", past: ["heard"], ing: "hearing" },
	{ base: "notice", third: "notices", past: ["noticed"], ing: "noticing" },
	{ base: "remember", third: "remembers", past: ["remembered"], ing: "remembering" },
	{ base: "forget", third: "forgets", past: ["forgot", "forgotten"], ing: "forgetting" },
	{ base: "learn", third: "learns", past: ["learned", "learnt"], ing: "learning" },
	{ base: "understand", third: "understands", past: ["understood"], ing: "understanding" },
	{ base: "agree", third: "agrees", past: ["agreed"], ing: "agreeing" },
	{ base: "promise", third: "promises", past: ["promised"], ing: "promising" },
];
const VERB_FORMS = new Map<string, TVerbForm>(
	ANTHROPOMORPHIC_VERBS.flatMap(({ base, third, past, ing }): [string, TVerbForm][] => [
		[base, { base, tense: "base" }],
		[third, { base, tense: "third" }],
		...past.map((form): [string, TVerbForm] => [form, { base, tense: "past" }]),
		[ing, { base, tense: "ing" }],
	]),
);
/** The noun `answer` names a person's reply, and a model's output is a response. */
const ANSWER = "answer";
/** The verb `promise` takes an infinitive or an object, and the noun is a JavaScript Promise. */
const PROMISE = "promise";
const ASK = "ask";
/** `thinking` also names a model's reasoning mode: `thinking off`, `a thinking level`. */
const THINKING = "thinking";
const THINKING_SETTINGS = new Set(["on", "off", "level", "levels", "limit", "mode", "model", "budget", "signal", "tokens"]);
const THINKING_SWITCHES = new Set([
	"turn",
	"turns",
	"turning",
	"switch",
	"switches",
	"enable",
	"enables",
	"disable",
	"disables",
	"discourage",
	"discourages",
	"with",
	"without",
	"of",
	"opts",
]);
/** Nouns that name a person's question, so a participle `asked` after them is the person's act: `a question asked on the graph`. */
const ASKED_THROUGH = new Set(["question", "questions", "ask", "asks", "turn", "turns", "prompt", "prompts"]);
/** The parties a participle that opens a sentence (`Asked to run the suite, the model …`) leaves a person to ask. */
const ASKED_PARTIES = /^\s*(?:(?:the|a|an|its|each)\s+)?(?:model|models|agent|agents)\b/i;
/** Verbs whose noun form follows a modifier (`a second ask`); others are verbs there (`the two agree`). */
const NOUN_CAPABLE = new Set(["ask", "answer", "notice", "promise", "say", "forget"]);
/** Nouns that name a person, each with its plural ending in s. */
const PERSON_NOUNS = ["person", "reader", "user", "operator", "owner", "author", "human", "asker", "reviewer", "cook", "resident"];
/** Words that name a person without a pronoun's antecedent: the nouns, their plurals, and `someone`. */
const PERSON_NOUN_WORDS = new Set([...PERSON_NOUNS, ...PERSON_NOUNS.map((noun) => `${noun}s`), ...["people", "someone", "anyone", "everyone", "somebody", "anybody", "everybody"]]);
/** Pronouns that stand for a person. */
const PERSON_PRONOUNS = ["i", "we", "you", "he", "she", "who", "whom"];
/** Subjects that are people, so the verbs above are theirs to perform. */
const PERSON_WORDS = new Set([...PERSON_NOUN_WORDS, ...PERSON_PRONOUNS]);
/** `they` is a person directly before the verb, where a person noun precedes it. */
const THEY = "they";
/** A capability's holder is a person directly before the verb, and elsewhere is a party the clause names. */
const DIRECT_PERSONS = new Set(["holder", "holders"]);
/** `authors` after a noun is the verb: `a model authors it`. */
const AUTHORS = "authors";
/** Nouns that name code reading or writing a format where `of`, `in` or a writer comes with them, or where a relative `that reads` or `that wants` follows them. */
const CODE_READERS = new Set(["reader", "readers"]);
const WRITERS = new Set(["writer", "writers"]);
const CODE_READER_AFTER = /^\s+(?:of|in)\b/i;
const CODE_READER_RELATIVE = /^\s+that\s+(?:wants|reads)\b/i;
/** `who` and `whom` before these words is an object: `state who it was`, `who an act belongs to`. */
const NOUN_PHRASE_OPENERS = new Set(["the", "a", "an", "it", "this", "that", "its", "their", "he", "she", "they", "we", "you", "i"]);
const RELATIVE_PERSONS = new Set(["who", "whom"]);
/** After these words a verb's form is a noun or an adjective: `an ask`, `the known types`. */
const NOUN_DETERMINERS = new Set(["a", "an", "the", "these", "those", "its", "their", "his", "her", "your", "my", "our", "another", "every", "whose", "no"]);
/** Plural determiners, which a singular noun doesn't follow, so a base form after them is a verb: `these ask the stepper`. */
const PLURAL_DETERMINERS = new Set(["these", "those"]);
/** These words determine a noun or stand as a subject: `this ask` is a noun, and `this asks` has a subject. */
const SUBJECT_DETERMINERS = new Set(["this", "that", "each", "one", "some", "any", "either"]);
/** Subject determiners that follow a plural subject as a relative pronoun or an adverb: `the modules that decide`. */
const AFTER_PLURAL = new Set(["that", "either"]);
/** Words that end in s without naming more than one. */
const SINGULAR_S = new Set([
	"is",
	"was",
	"has",
	"does",
	"this",
	"its",
	"his",
	"as",
	"us",
	"yes",
	"thus",
	"plus",
	"always",
	"perhaps",
	"unless",
	"whereas",
	"across",
	"less",
	"status",
]);
/** Pronouns an infinitive's `to` doesn't take: `promises to them` is a noun and a preposition. */
const OBJECT_PRONOUNS = new Set(["it", "them", "him", "her", "us", "me", "you"]);
const NUMBER_WORDS = new Set(["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "both"]);
/** Quantifiers before which a past participle followed by a noun is an adjective: `all known vertex labels`. */
const QUANTIFIERS = new Set(["all", "any", "some", "both", "every", "each", "other"]);
/** Verbs that make the clause after their object a verb's: `lets a view tell`, `makes the view ask`. */
const CAUSATIVES = new Set(["let", "lets", "letting", "make", "makes", "made", "making", "help", "helps", "helped", "have", "has", "had"]);
const PREPOSITIONS = new Set([
	"of",
	"in",
	"on",
	"at",
	"to",
	"for",
	"from",
	"with",
	"by",
	"about",
	"into",
	"through",
	"over",
	"under",
	"after",
	"before",
	"between",
	"without",
	"within",
	"across",
	"as",
	"onto",
	"via",
	"per",
	"against",
	"among",
	"around",
	"during",
	"toward",
	"towards",
	"upon",
]);
/** A person's word after these is an object, not the subject: `decided by the operator`, `the turn of a reader`. */
const OBJECT_PREPOSITIONS = new Set(["by", "of", "through"]);
/** Auxiliaries and adverbs that may come between a subject and its verb: `they may not see`. */
const LINKING_WORDS = new Set([
	"may",
	"might",
	"must",
	"can",
	"could",
	"will",
	"would",
	"shall",
	"should",
	"do",
	"does",
	"did",
	"don't",
	"doesn't",
	"didn't",
	"won't",
	"wouldn't",
	"can't",
	"cannot",
	"couldn't",
	"shouldn't",
	"is",
	"are",
	"was",
	"were",
	"be",
	"been",
	"has",
	"have",
	"had",
	"not",
	"never",
	"already",
	"also",
	"still",
	"then",
	"now",
	"first",
	"only",
	"just",
	"always",
	"often",
	"need",
	"needs",
	"to",
	"once",
	"again",
	"rather",
	"else",
	"ever",
]);
const COPULAS = new Set(["is", "are", "was", "were"]);
/** Verbs after which `live` is an adjective: `the stream is live on the page`. */
const STATE_VERBS = new Set([
	...COPULAS,
	"be",
	"been",
	"being",
	"stays",
	"stay",
	"stayed",
	"remains",
	"remain",
	"remained",
	"keeps",
	"keep",
	"kept",
	"goes",
	"go",
	"went",
	"become",
	"becomes",
	"became",
]);
/** Words that open a clause with its own subject. */
const CLAUSE_OPENERS = new Set(["that", "which", "whether", "because", "since", "although", "though", "unless", "while", "whereas", "when", "where", "if", "so"]);
/** `as` opens a clause after a comma or at a sentence's start (`, as the machine decides it`), and is a preposition elsewhere. */
const AS = "as";
const WHAT = "what";
/** The opener of a clause that can stand as a subject: `where a reader is decides the scale`. */
const WHERE = "where";
/** Openers of a relative clause, which a verb joined by `and` follows out of: `sees the page that the person reads and knows`. */
const OBJECT_CLAUSES = new Set(["which", "that"]);
/** The relative pronoun whose antecedent may be a person: `a user that decides`. */
const THAT = "that";
/** Words that join two clauses, or two verbs of one subject where a verb follows. */
const CONJUNCTIONS = new Set(["and", "or", "but", "then", "yet", "nor"]);
const JOINING = new Set(["and", "or", "but"]);
/** The first words of a clause, which hold the subject of a verb that `and` joins to an earlier verb. */
const JOINED_SUBJECT_WORDS = 3;
/** Words that may come before an instruction's verb: `Never ask`, `Then go to`. */
const IMPERATIVE_LEADS = new Set(["please", "then", "first", "always", "never", "just", "only", "now", "so", "and", "or", "but", "also", "do", "don't", "not", "to"]);
/** A relation verb's base form, which begins an instruction: `Go to the settings`. */
const RELATION_BASE_FORM = /^(?:go|live|sit|belong|meet)\b/i;
const LIVE = "live";
const MEET_FORM = /^meets?$/i;
const MET = "met";
const GO_TO_FORM = /^(?:go|goes|went|gone)\s+to$/i;
/** Words before a capital `I` that make it a roman numeral: `Part I`. */
const NUMBERED_PARTS = new Set(["part", "chapter", "section", "appendix", "volume", "phase", "stage", "tier", "level", "class", "type", "article", "annex", "schedule"]);
const ROMAN_ONE = "I";
const NONE = "none";
const NO = "no";
const ESCAPE = "\\";
/** A preposition before a sentence's full stop, as in `the directory actuality keeps files in.` */
/** Verbs whose `on` or `in` is a particle, up to three words after the verb: `turns thinking on`, `opts the reader in`. */
const PHRASAL_VERB = /^(?:turn|switch|log|sign|opt)(?:s|es|ed|ing|ged|ging|ted|ting)?$/;
const PARTICLES = new Set(["on", "in"]);
const PARTICLE_REACH = 3;
const TERMINAL_PREPOSITION = /\b(?:in|with|by|to|from|of|on|at|for|into|onto|about|through)(?=\.(?:[\s"'’”)\]*_]|$))/gi;

function isWordCharacter(character: string): boolean {
	return WORD_CHARACTER.test(character);
}

/** True where the span isn't part of an identifier: a camelCase, snake_case, kebab-case, dotted, path or sigil name. */
function isWholeWord(text: string, start: number, end: number): boolean {
	const before = text.charAt(start - 1);
	const joinedBefore =
		isWordCharacter(text.charAt(start)) && (isWordCharacter(before) || IDENTIFIER_SIGILS.has(before) || (IDENTIFIER_JOINS.has(before) && isWordCharacter(text.charAt(start - 2))));
	const joinedAfter =
		isWordCharacter(text.charAt(end - 1)) && (isWordCharacter(text.charAt(end)) || (IDENTIFIER_JOINS.has(text.charAt(end)) && isWordCharacter(text.charAt(end + 1))));
	return !joinedBefore && !joinedAfter;
}

function readBlock({ kind, lines, instructs }: TProseBlock, persons: ReadonlySet<string>): TReadBlock {
	const text = lines.map(({ text }) => text).join("\n");
	const masked = UNREAD_SPANS.reduce((current, { pattern, mask }) => current.replace(pattern, mask ?? maskAll), text);
	const words = [...masked.matchAll(WORD)]
		.filter((found) => isWholeWord(masked, found.index, found.index + found[0].length))
		.map((found) => {
			const lower = found[0].toLowerCase().replace(CURLY_APOSTROPHE, "'");
			return { start: found.index, end: found.index + found[0].length, lower: lower.replace(POSSESSIVE, ""), possessive: POSSESSIVE.test(lower) };
		});
	const ends = (pattern: RegExp) => [...masked.matchAll(pattern)].map((found) => found.index + found[0].length);
	const quotes = [...masked.matchAll(QUOTED_SPAN)].map((found): [number, number] => [found.index, found.index + found[0].length]);
	return { kind, instructs, text, masked, words, breaks: ends(SENTENCE_BREAK), openings: ends(INSTRUCTION_OPENING), quotes, persons };
}

/** The last of `ends` at or before `at`, or the block's start. */
function lastEnd(ends: readonly number[], at: number): number {
	return ends.reduce((start, end) => (end <= at && end > start ? end : start), 0);
}

function sentenceStart(block: TReadBlock, at: number): number {
	return lastEnd(block.breaks, at);
}

function wordsBetween(block: TReadBlock, from: number, to: number): TWord[] {
	return block.words.filter((word) => word.start >= from && word.end <= to);
}

/** The words of the sentence before `at`, in order. */
function sentenceWords(block: TReadBlock, at: number): TWord[] {
	return wordsBetween(block, sentenceStart(block, at), at);
}

/** The words from `at` to the end of its sentence. */
function wordsToSentenceEnd(block: TReadBlock, at: number): TWord[] {
	const end = block.breaks.find((position) => position > at) ?? block.masked.length;
	return block.words.filter((word) => word.start >= at && word.start < end);
}

/** True where a match is the only word of its sentence: a table cell, an element's text, a CSS value or a one-word sentence. */
function aloneInSentence({ block, start, end }: TFound): boolean {
	return sentenceWords(block, start).length === 0 && wordsToSentenceEnd(block, end).length === 0;
}

/** Where the clause that holds `at` starts, and the word that opened it. A conjunction followed by a verb joins two verbs of one subject. */
function clauseOf(block: TReadBlock, at: number): { start: number; opener?: TWord } {
	const sentence = sentenceStart(block, at);
	let clause: { start: number; opener?: TWord } = { start: sentence };
	block.words.forEach((word, index) => {
		if (word.start < sentence || word.end > at) return;
		const next = block.words[index + 1];
		const joinsVerbs = next !== undefined && VERB_FORMS.has(next.lower);
		const opensAs = word.lower === AS && (word.start === sentence || block.masked.slice(sentence, word.start).trimEnd().endsWith(","));
		if (CLAUSE_OPENERS.has(word.lower) || opensAs || (CONJUNCTIONS.has(word.lower) && !joinsVerbs)) clause = { start: word.end, opener: word };
	});
	return clause;
}

/** The last word of the sentence that ends before `at`. */
function lastWordBefore(block: TReadBlock, at: number): TWord | undefined {
	return sentenceWords(block, at).at(-1);
}

/** The word right before `at`, where only whitespace separates them. */
function wordBefore(block: TReadBlock, at: number): TWord | undefined {
	const before = lastWordBefore(block, at);
	return before !== undefined && WHITESPACE.test(block.masked.slice(before.end, at)) ? before : undefined;
}

/** The word right after `at`, where only whitespace separates them. */
function wordAfter(block: TReadBlock, at: number): TWord | undefined {
	const after = block.words.find((word) => word.start >= at);
	return after !== undefined && WHITESPACE.test(block.masked.slice(at, after.start)) ? after : undefined;
}

/** True where a word lies in a quoted span the verb at `verbStart` lies outside, so the quote mentions it. */
function quotedApart(block: TReadBlock, word: TWord, verbStart: number): boolean {
	return block.quotes.some(([from, to]) => from < word.start && word.end < to && (verbStart < from || verbStart > to));
}

function isLinking(word: TWord): boolean {
	return LINKING_WORDS.has(word.lower) || ADVERB_ENDING.test(word.lower);
}

/** The word a verb's subject is where only auxiliaries and adverbs come between them: `they` in `they may not see`. */
function subjectBefore(block: TReadBlock, at: number): TWord | undefined {
	let word = wordBefore(block, at);
	while (word !== undefined && isLinking(word)) word = wordBefore(block, word.start);
	return word;
}

/** A noun that names more than one: it ends in s and isn't a verb form, a possessive or a word such as `is`. */
function isPluralNoun(word: TWord | undefined): boolean {
	return word !== undefined && !word.possessive && PLURAL_ENDING.test(word.lower) && !word.lower.endsWith("ss") && !SINGULAR_S.has(word.lower) && !VERB_FORMS.has(word.lower);
}

/** A person noun in the sentence before `at`, or in the sentence before that one, that isn't the object of a person's act: `answer a reader`. */
function personNounBefore(block: TReadBlock, at: number): boolean {
	const start = sentenceStart(block, at);
	const previous = start === 0 ? 0 : sentenceStart(block, start - 1);
	const words = wordsBetween(block, previous, at);
	return words.some((word, index) => {
		const determiner = words[index - 1];
		const verb = determiner !== undefined && NOUN_DETERMINERS.has(determiner.lower) ? words[index - 2] : determiner;
		return PERSON_NOUN_WORDS.has(word.lower) && !(verb !== undefined && VERB_FORMS.has(verb.lower));
	});
}

/** A subject that is a person only directly before the verb: a capability's holder, a named fixture person, or `they` after a person. */
function directPerson(block: TReadBlock, at: number): boolean {
	const subject = subjectBefore(block, at);
	if (subject === undefined || subject.possessive) return false;
	return DIRECT_PERSONS.has(subject.lower) || block.persons.has(subject.lower) || (subject.lower === THEY && personNounBefore(block, subject.start));
}

/** A pronoun that opens a reduced relative clause: `you` in `every tool you are offered answers`. */
function inReducedRelative(block: TReadBlock, words: readonly TWord[], index: number): boolean {
	const word = words[index];
	const before = words[index - 1];
	const copula = words[index + 1];
	const participle = words[index + 2];
	if (word === undefined || before === undefined || copula === undefined || participle === undefined || !PERSON_PRONOUNS.includes(word.lower)) return false;
	const nounBefore = !NOUN_DETERMINERS.has(before.lower) && !CLAUSE_OPENERS.has(before.lower) && !CONJUNCTIONS.has(before.lower) && !PREPOSITIONS.has(before.lower);
	return nounBefore && WHITESPACE.test(block.masked.slice(before.end, word.start)) && COPULAS.has(copula.lower) && PARTICIPLE_ENDING.test(participle.lower);
}

/**
 * A word of the clause before the verb that is the verb's person subject. A person's word isn't one where it is a possessive
 * (but for `the reader's to decide`), an object after `by`, `of` or `through`, `who` before a noun phrase, a modifier of the
 * noun before the verb (`a user selection lives`), a pronoun opening a reduced relative clause, the verb `authors`, or a
 * reader of a format.
 */
function countsAsPerson(block: TReadBlock, words: readonly TWord[], index: number, verbStart: number): boolean {
	const word = words[index];
	if (word === undefined || !PERSON_WORDS.has(word.lower) || quotedApart(block, word, verbStart)) return false;
	const before = words[index - 1];
	const next = words[index + 1];
	if (word.possessive) return TO_BETWEEN.test(block.masked.slice(word.end, verbStart));
	if (before !== undefined && OBJECT_PREPOSITIONS.has(before.lower)) return false;
	if (RELATIVE_PERSONS.has(word.lower) && next !== undefined && NOUN_PHRASE_OPENERS.has(next.lower)) return false;
	const modifies =
		next !== undefined && index + 2 === words.length && !isLinking(next) && !VERB_FORMS.has(next.lower) && !CLAUSE_OPENERS.has(next.lower) && !CONJUNCTIONS.has(next.lower);
	if (modifies || inReducedRelative(block, words, index)) return false;
	if (word.lower === AUTHORS && before !== undefined && !NOUN_DETERMINERS.has(before.lower) && !SUBJECT_DETERMINERS.has(before.lower)) return false;
	const after = block.masked.slice(word.end);
	const besideWriter = sentenceWords(block, verbStart).some((other) => WRITERS.has(other.lower));
	const readsFormat = CODE_READERS.has(word.lower) && (CODE_READER_AFTER.test(after) || CODE_READER_RELATIVE.test(after) || besideWriter);
	return !readsFormat;
}

/** True where a person word of the clause is the verb's subject: any of them, or one of the first where a finite verb is joined by `and` to an earlier verb. */
function personAmong(block: TReadBlock, words: readonly TWord[], verbStart: number, joined: boolean): boolean {
	return words.some((_, index) => (!joined || index < JOINED_SUBJECT_WORDS) && countsAsPerson(block, words, index, verbStart));
}

/** True where a person is the subject of the clause, before the match or as the antecedent of a relative pronoun. */
function personSubject({ block, start }: TFound, tense?: TVerbTense): boolean {
	if (directPerson(block, start)) return true;
	const before = wordBefore(block, start);
	const joined = before !== undefined && JOINING.has(before.lower) && tense !== "base";
	let clause = clauseOf(block, joined ? before.start : start);
	if (joined && clause.opener !== undefined && OBJECT_CLAUSES.has(clause.opener.lower)) clause = clauseOf(block, clause.opener.start);
	const { start: clauseStart, opener } = clause;
	const clauseEnded = opener?.lower === WHERE && before !== undefined && COPULAS.has(before.lower) && (tense === "third" || tense === "base");
	if (clauseEnded) return false;
	if (personAmong(block, wordsBetween(block, clauseStart, start), start, joined)) return true;
	const antecedent = opener?.lower === THAT ? lastWordBefore(block, opener.start) : undefined;
	return antecedent !== undefined && PERSON_WORDS.has(antecedent.lower) && !(CODE_READERS.has(antecedent.lower) && CODE_READER_RELATIVE.test(block.masked.slice(antecedent.end)));
}

/** A passive verb whose agent is a person: `decided by the operator`. */
function personAgent({ block, end }: TFound): boolean {
	const agent = PERSON_AGENT.exec(block.masked.slice(end))?.[1];
	return agent !== undefined && PERSON_WORDS.has(agent.toLowerCase().replace(CURLY_APOSTROPHE, "'").replace(POSSESSIVE, ""));
}

/** True where a span holds a word joined into an identifier, such as `hyphen-joined` or `dotted.name`. */
function holdsIdentifier(block: TReadBlock, from: number, to: number): boolean {
	return [...block.masked.slice(from, to).matchAll(WORD)].some((found) => !isWholeWord(block.masked, from + found.index, from + found.index + found[0].length));
}

/**
 * An instruction to the reader: the verb opens its sentence, after leads such as `Never`. A block that describes code doesn't
 * hold one, and a sentence whose subject is code or a string's label (`Trust queries: answer …`) isn't one.
 */
function instruction({ block, start }: TFound): boolean {
	if (!block.instructs) return false;
	const opening = lastEnd(block.openings, start);
	if (block.masked.slice(opening, start).includes(MASK) || holdsIdentifier(block, opening, start)) return false;
	if (!wordsBetween(block, opening, start).every((word) => IMPERATIVE_LEADS.has(word.lower))) return false;
	return !(block.kind === "string" && PLURAL_LABEL.test(block.masked.slice(0, opening)));
}

/** True where a noun phrase ends after `end`: punctuation, a preposition or a conjunction follows. */
function closesNounPhrase(block: TReadBlock, end: number): boolean {
	if (CLOSES_PHRASE_AFTER.test(block.masked.slice(end))) return true;
	const next = wordAfter(block, end);
	return next !== undefined && (PREPOSITIONS.has(next.lower) || CONJUNCTIONS.has(next.lower));
}

/** True where an object or a preposition follows `end`. */
function takesObject(block: TReadBlock, end: number): boolean {
	const next = wordAfter(block, end);
	return OBJECT_AFTER.test(block.masked.slice(end)) || (next !== undefined && PREPOSITIONS.has(next.lower));
}

/**
 * The form follows a determiner, so it is a noun or an adjective: `an ask`, `the store's notice`. A base form also follows a
 * determiner and one modifier (`a second ask`, `the stream's sync notice,`, `a window-cut notice.`), where the modifier isn't a
 * plural subject (`the models decide`), a verb, a number or a coordinated subject (`the two agree`), and the determiner
 * doesn't follow a causative (`lets a view tell`). A base form after `these` or `those` is a verb, and after `that` or
 * `either` it is a verb where a plural precedes them (`the modules that decide`). A past participle between a quantifier and
 * a noun is an adjective (`all known vertex labels`).
 */
function nounUse({ block, start, end }: TFound, form: TVerbForm): boolean {
	const before = wordBefore(block, start);
	if (before === undefined) return form.tense === "base" && HYPHENATED_MODIFIER_BEFORE.test(block.masked.slice(0, start)) && closesNounPhrase(block, end);
	if (form.tense === "base" && PLURAL_DETERMINERS.has(before.lower)) return false;
	if (before.possessive || NOUN_DETERMINERS.has(before.lower)) return true;
	if (form.tense === "past" && QUANTIFIERS.has(before.lower)) {
		const next = wordAfter(block, end);
		return next !== undefined && !PREPOSITIONS.has(next.lower) && !CONJUNCTIONS.has(next.lower);
	}
	if (form.tense !== "base" && form.tense !== "ing") return false;
	if (SUBJECT_DETERMINERS.has(before.lower)) {
		if (AFTER_PLURAL.has(before.lower) && isPluralNoun(lastWordBefore(block, before.start))) return false;
		return form.tense === "base" || !OBJECT_AFTER.test(block.masked.slice(end));
	}
	if (form.tense !== "base" || before.lower === "to" || PLURAL_ENDING.test(before.lower) || VERB_FORMS.has(before.lower) || before.lower.includes("'")) return false;
	const determiner = wordBefore(block, before.start);
	if (determiner === undefined) return false;
	if (determiner.possessive) return closesNounPhrase(block, end);
	if (!NOUN_DETERMINERS.has(determiner.lower)) return false;
	const preceding = wordBefore(block, determiner.start);
	if (preceding !== undefined && CAUSATIVES.has(preceding.lower)) return false;
	const coordinated = preceding !== undefined && JOINING.has(preceding.lower);
	if (NUMBER_WORDS.has(before.lower) || coordinated) return NOUN_CAPABLE.has(form.base) && !takesObject(block, end);
	return true;
}

/** True for a person's possessive: `the reader's`, `Wren's`. */
function personPossessive(block: TReadBlock, word: TWord | undefined): boolean {
	return word !== undefined && word.possessive && (PERSON_WORDS.has(word.lower) || block.persons.has(word.lower));
}

/**
 * Whether the noun `answer` is allowed, or undefined where the form is a verb. The noun after a person's possessive is
 * allowed (`the reader's answer`, `the reader's own answer`). The noun after a determiner, with or without a modifier (`an
 * answer`, `a streamed answer`, `the zero-match answer`), names a model's or a site's output, which is a response.
 */
function answerNoun(found: TFound, form: TVerbForm): boolean | undefined {
	const { block, start } = found;
	const before = wordBefore(block, start);
	if (before === undefined) return HYPHENATED_AFTER_DETERMINER.test(block.masked.slice(0, start)) ? false : undefined;
	if (before.possessive) return personPossessive(block, before);
	const determined =
		(NOUN_DETERMINERS.has(before.lower) && !(form.tense === "base" && PLURAL_DETERMINERS.has(before.lower))) || (SUBJECT_DETERMINERS.has(before.lower) && form.tense === "base");
	if (determined) return false;
	return form.tense === "base" && nounUse(found, form) ? personPossessive(block, wordBefore(block, before.start)) : undefined;
}

/** `promise` is the verb where an infinitive or an object follows it, or where it closes a `what` clause; otherwise it is a Promise. */
function promisedAsVerb(found: TFound): boolean {
	const { block, start, end } = found;
	return takesInfinitive(found) || OBJECT_AFTER.test(block.masked.slice(end)) || sentenceWords(block, start).some((word) => word.lower === WHAT);
}

function takesInfinitive({ block, end }: TFound): boolean {
	const next = INFINITIVE.exec(block.masked.slice(end))?.[1]?.toLowerCase();
	return next !== undefined && !NOUN_DETERMINERS.has(next) && !SUBJECT_DETERMINERS.has(next) && !OBJECT_PRONOUNS.has(next);
}

/** True for a word in capitals within prose: emphasis, unless a word beside it is in capitals too (`LAST KNOWN`). */
function shouted({ block, start, word }: TFound): boolean {
	const isCapitals = (text: string) => (text.match(LETTERS)?.length ?? 0) > 1 && text === text.toUpperCase();
	if (!isCapitals(word)) return false;
	const index = block.words.findIndex((candidate) => candidate.start === start);
	return [block.words[index - 1], block.words[index + 1]].every((beside) => beside === undefined || !isCapitals(block.masked.slice(beside.start, beside.end)));
}

/** A Markdown heading in title case, where a capital doesn't mark a name. */
function titleCaseHeading(block: TReadBlock): boolean {
	if (block.kind !== "markdown" || !MARKDOWN_HEADING.test(block.masked)) return false;
	const long = block.words.filter((word) => word.end - word.start >= 4);
	return long.filter((word) => CAPITALIZED.test(block.masked.charAt(word.start))).length * 2 > long.length;
}

/** A capitalized form within its sentence is a name, such as a mode a page offers: `the Ask mode`. */
function isName(found: TFound): boolean {
	return CAPITALIZED.test(found.word) && sentenceWords(found.block, found.start).length > 0 && !titleCaseHeading(found.block) && !shouted(found);
}

/** `thinking` names a model's reasoning mode where a setting follows it or a switch comes before it: `turns thinking off`. */
function thinkingSetting({ block, start, end, word }: TFound): boolean {
	if (word.toLowerCase() !== THINKING) return false;
	const next = wordAfter(block, end);
	const before = wordBefore(block, start);
	return (next !== undefined && THINKING_SETTINGS.has(next.lower)) || (before !== undefined && THINKING_SWITCHES.has(before.lower));
}

/**
 * `asked` is a person's act after a question's noun (`a question asked on the graph`), unless an agent that isn't a person
 * follows (`a turn asked by a key`), or where it opens a sentence whose subject is a model.
 */
function askedOfModel(found: TFound, form: TVerbForm): boolean {
	const { block, start, end } = found;
	if (form.base !== ASK || form.tense !== "past") return false;
	const before = wordBefore(block, start);
	if (before !== undefined && ASKED_THROUGH.has(before.lower)) return !PERSON_AGENT.test(block.masked.slice(end)) || personAgent(found);
	if (sentenceWords(block, start).length > 0) return false;
	const sentenceEnd = block.breaks.find((position) => position > end) ?? block.masked.length;
	const comma = block.masked.indexOf(",", end);
	return comma !== -1 && comma < sentenceEnd && ASKED_PARTIES.test(block.masked.slice(comma + 1));
}

function verbForm(word: string): TVerbForm {
	const form = VERB_FORMS.get(word.toLowerCase().replace(VERB_PREFIX, ""));
	if (form === undefined) throw new Error(`"${word}" matched the anthropomorphic pattern without a form in its list`);
	return form;
}

function anthropomorphicAllows(found: TFound): boolean {
	const form = verbForm(found.word);
	if (isName(found) || (found.block.kind === "markdown" && form.tense === "past" && aloneInSentence(found))) return true;
	if (form.base === ANSWER) {
		const allowedNoun = answerNoun(found, form);
		if (allowedNoun !== undefined) return allowedNoun;
	} else if (nounUse(found, form)) return true;
	if ((form.base === PROMISE && !promisedAsVerb(found)) || thinkingSetting(found) || askedOfModel(found, form)) return true;
	return personSubject(found, form.tense) || personAgent(found) || ((form.tense === "base" || form.tense === "ing") && instruction(found));
}

/** True where the match lies in a quoted span of one sentence, which mentions the words rather than using them. */
function insideQuote({ block, start, end }: TFound): boolean {
	return block.quotes.some(([from, to]) => from < start && end < to);
}

/** An escaped em-dash in a string is code that writes one, since the string's own text holds the character it escapes. */
function escapedInString({ block, word }: TFound): boolean {
	return block.kind === "string" && word.startsWith(ESCAPE);
}

/** A relation verb's other senses: `live` as an adjective (after a state verb, or after a comma, where it doesn't have a subject), meeting a criterion, and going to an address. */
function relationAllows(found: TFound): boolean {
	const { block, start, end, word } = found;
	const lower = word.toLowerCase();
	const before = wordBefore(block, start);
	if (lower.split(WHITESPACE_RUN)[0] === LIVE && ((before !== undefined && STATE_VERBS.has(before.lower)) || AFTER_COMMA.test(block.masked.slice(0, start)))) return true;
	if (MEET_FORM.test(lower) && CRITERION_AFTER.test(block.masked.slice(end))) return true;
	if (lower === MET && wordsBetween(block, clauseOf(block, start).start, start).some((other) => CRITERION_NOUN.test(other.lower))) return true;
	if (GO_TO_FORM.test(word.replace(WHITESPACE_RUN, " ")) && block.masked.slice(end).trimStart().startsWith(MASK)) return true;
	return personSubject(found) || (RELATION_BASE_FORM.test(word) && instruction(found));
}

/** True where a quote holds the match, or where `on` or `in` is the particle of a phrasal verb: `turns thinking on.` */
function prepositionAllows(found: TFound): boolean {
	if (insideQuote(found)) return true;
	const before = sentenceWords(found.block, found.start).slice(-PARTICLE_REACH);
	return PARTICLES.has(found.word.toLowerCase()) && before.some((word) => PHRASAL_VERB.test(word.lower));
}

/** `I` as a roman numeral, after the word it numbers: `Part I`. */
function romanNumeral({ block, start, word }: TFound): boolean {
	const before = wordBefore(block, start);
	return word === ROMAN_ONE && before !== undefined && NUMBERED_PARTS.has(before.lower);
}

/** A block that opens with a fixture person's name and a colon holds that person's words. */
function attributed({ block }: TFound): boolean {
	const speaker = ATTRIBUTION.exec(block.masked)?.[1];
	return speaker !== undefined && block.persons.has(speaker.toLowerCase());
}

/** `no more` that ends its clause means `no longer` (`lists it no more.`), but not after `and` (`grants it and no more`). */
function noMoreEndsClause({ block, start, end }: TFound): boolean {
	const before = wordBefore(block, start);
	return NO_MORE_CLOSING.test(block.masked.slice(end)) && !(before !== undefined && JOINING.has(before.lower));
}

function negationAllows(found: TFound): boolean {
	const lower = found.word.toLowerCase();
	if (insideQuote(found)) return true;
	if (lower === NONE) return aloneInSentence(found);
	return lower === NO && noMoreEndsClause(found);
}

export const PROSE_RULES: readonly TProseRule[] = [
	{
		id: "anthropomorphic",
		pattern: new RegExp(`\\b(?:(?:re|half|mid)-)?(?:${[...VERB_FORMS.keys()].join("|")})\\b`, "gi"),
		instead: "Write the operation the code performs: returns, responds, sends, requests, reads, writes, holds, rejects, selects, determines, computes, emits or renders.",
		allows: anthropomorphicAllows,
	},
	{
		id: "relation-verb",
		pattern:
			/\b(?:lives|lived|sits|sat|belongs|belonged|(?:live|living|sit|sitting)\s+(?:(?:only|entirely|now|right|once)\s+)?(?:in|on|at|inside|within|under|beside|alongside|outside|behind|above|below|between|atop|next\s+to|here|there|with|among|over|before|after)|(?:belong|belonging)\s+(?:(?:only|entirely|now|right|once)\s+)?(?:to|in|on|at|with|here|there|among)|meets?|met|meeting\s+(?:on|at|in|with)|(?:go|goes|went|gone)\s+(?:(?:only|straight|directly|back|out|first|then|also|all)\s+)?(?:to|into|through|in|under|beside|via|inside|within|onto|there|where)|going\s+(?:into|through))\b/gi,
		instead: "Name the relation with a technical verb: implements, calls, reads, replaces, depends on or contains.",
		allows: relationAllows,
	},
	{
		id: "the-run",
		pattern: /\b(?:the|this)\s+(?:(?:whole|full|entire|live|current)\s+)?run\b(?!\s+(?:document|record|individual|steps|tools)\b)/gi,
		instead: 'Write "actuality" for the live system and its results.',
		allows: (found) => insideQuote(found) || SUPERVISED_RUN.test(found.block.text),
	},
	{
		id: "banned-word",
		pattern:
			/\b(?:honest|honestly|honesty|dishonest|dishonestly|dishonesty|being\s+straight|altitude|fold|folds|folded|folding|seams?|blast\s+radius|bake|bakes|baked|baking|load-bearing|earn|earns|earned|earning|pay\s+for|pays|paid|paying|costs?|armed)\b/gi,
		instead: "Write the plain technical term for the operation or the quantity.",
		allows: insideQuote,
	},
	{
		id: "em-dash",
		pattern: /—|&mdash;|&#8212;|&#x2014;|\\u2014|\\u\{2014\}|(?<=\s)–(?=\s)/g,
		instead: "Write a separate sentence, or use a colon or a comma.",
		allows: escapedInString,
	},
	{
		id: "first-person",
		pattern: /\b(?:[Ww]e|[Oo]urs?|[Oo]urselves|[Uu]s|[Ll]et['’]s|I|[Mm]y|[Mm]ine|[Mm]e|[Mm]yself)\b/g,
		instead: "Name the subject: the code, the module, the person or the reader.",
		allows: (found) => insideQuote(found) || romanNumeral(found) || attributed(found),
	},
	{
		id: "negated-noun",
		pattern: /\b(?:no(?=\s+(?!longer\b|more\s+than\b)[\p{L}\p{N}_"'“‘([\uFFFC])|nothing|none|nobody|neither|nowhere)\b/giu,
		instead: 'Negate the verb, as in "doesn\'t name a type".',
		allows: negationAllows,
	},
	{
		id: "terminal-preposition",
		pattern: TERMINAL_PREPOSITION,
		instead: 'Name the thing directly and end the sentence on its noun, as in "the engine for the PERSIST option".',
		allows: prepositionAllows,
	},
];

/** The prose of a file a rule reads, a segment per line, in source order. */
export function proseOf(path: string, text: string): TProseSegment[] {
	return proseBlocks(path, text)
		.flatMap(({ kind, lines }) => lines.filter(({ text }) => text !== "").map(({ line, text }) => ({ line, text, kind })))
		.sort((a, b) => a.line - b.line);
}

/** An allowed entry's text that contains the match, which starts at `column` of the segment. */
function covers(segment: string, allowedText: string, column: number, length: number): boolean {
	for (let at = segment.indexOf(allowedText); at !== -1; at = segment.indexOf(allowedText, at + 1)) {
		if (at <= column && column + length <= at + allowedText.length) return true;
	}
	return false;
}

function scan(path: string, text: string, allowance: TAllowance): TScan {
	const allowedHere = allowance.entries.filter((entry) => entry.file === path);
	const persons = new Set(allowance.persons.map((person) => person.toLowerCase()));
	const used = new Set<TAllowed>();
	const found: { violation: TProseViolation; column: number }[] = [];
	for (const prose of proseBlocks(path, text)) {
		const block = readBlock(prose, persons);
		const { kind, lines } = prose;
		const lineStarts: number[] = [];
		let offset = 0;
		for (const { text } of lines) {
			lineStarts.push(offset);
			offset += text.length + 1;
		}
		for (const rule of PROSE_RULES) {
			for (const match of block.masked.matchAll(rule.pattern)) {
				const start = match.index;
				const end = start + match[0].length;
				if (!isWholeWord(block.masked, start, end) || rule.allows?.({ block, start, end, word: match[0] })) continue;
				const index = lineStarts.findLastIndex((lineStart) => lineStart <= start);
				const segment = lines[index];
				const lineStart = lineStarts[index];
				if (segment === undefined || lineStart === undefined) throw new Error(`${path}: a match at ${start} lies outside the lines of its block`);
				const column = start - lineStart;
				const entry = allowedHere.find(
					(candidate) => candidate.rule === rule.id && covers(segment.text, candidate.text, column, Math.min(end - start, segment.text.length - column)),
				);
				if (entry !== undefined) {
					used.add(entry);
					continue;
				}
				found.push({ violation: { line: segment.line, rule: rule.id, kind, match: block.text.slice(start, end).replace(WHITESPACE_RUN, " "), text: segment.text }, column });
			}
		}
	}
	const violations = found.sort((a, b) => a.violation.line - b.violation.line || a.column - b.column).map(({ violation }) => violation);
	return { violations, used };
}

/** The violations in a file's prose, apart from those the allowance names for the file. `path` is the file's path from the repository root. */
export function violationsIn(path: string, text: string, allowance: TAllowance = NO_ALLOWANCE): TProseViolation[] {
	return scan(path, text, allowance).violations;
}

const ALLOWED_KEYS = ["file", "rule", "text", "reason"];
const ALLOWANCE_KEYS = ["entries", "persons"];

function isAllowed(entry: unknown): entry is TAllowed {
	if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
	const fields: Record<string, unknown> = { ...entry };
	const { file, rule, text, reason } = fields;
	return (
		Object.keys(fields).every((key) => ALLOWED_KEYS.includes(key)) &&
		typeof file === "string" &&
		file !== "" &&
		PROSE_RULE_IDS.some((id) => id === rule) &&
		typeof text === "string" &&
		text !== "" &&
		typeof reason === "string" &&
		reason.trim() !== ""
	);
}

/** The allowance a parsed JSON value states: `entries`, each checked for a file, a rule, the text and a reason, and `persons`, each a name. */
export function allowanceFrom(value: unknown, source: string): TAllowance {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${source} isn't an object holding "entries" and "persons"`);
	const fields: Record<string, unknown> = { ...value };
	const { entries, persons } = fields;
	const unknownKeys = Object.keys(fields).filter((key) => !ALLOWANCE_KEYS.includes(key));
	if (unknownKeys.length > 0) throw new Error(`${source} holds ${unknownKeys.join(", ")}, which isn't one of ${ALLOWANCE_KEYS.join(", ")}`);
	if (!Array.isArray(entries)) throw new Error(`${source} "entries" isn't an array of allowed entries`);
	if (!Array.isArray(persons) || !persons.every((person): person is string => typeof person === "string" && person !== ""))
		throw new Error(`${source} "persons" isn't an array of names`);
	return {
		entries: entries.map((entry: unknown, index) => {
			if (!isAllowed(entry)) throw new Error(`${source} entry ${index} isn't { file, rule, text, reason } with text, a reason, and a rule of ${PROSE_RULE_IDS.join(", ")}`);
			return entry;
		}),
		persons,
	};
}

/** The nearest directory at or above `dir` that holds `.git`. An allowed entry names its file by the path from there. */
function repositoryOf(dir: string): string {
	for (let at = dir; ; at = dirname(at)) {
		if (existsSync(join(at, GIT_DIRECTORY))) return at;
		if (dirname(at) === at) throw new Error(`${dir} isn't in a git repository, and an allowed entry names its file by the path from the repository root`);
	}
}

/** The prose files under `dir` of the repository at `repository`, each by its absolute path, as the repository's listing holds them.
 *  A symbolic link isn't read, since its target is another path's file. */
export function filesUnder(repository: string, dir: string): string[] {
	return listedFiles(repository, [relative(repository, dir)])
		.map((file) => join(repository, file))
		.filter((file) => isProseFile(basename(file)) && lstatSync(file).isFile());
}

/**
 * The violations in the prose files under each root, by file. `exclude` matches a file's path from its repository root. An
 * allowed entry throws where it names a file this call reads and doesn't match a violation in it, since its text changed or
 * the violation is gone.
 */
export function proseViolations(roots: readonly string[], options: { exclude?: readonly RegExp[]; allowance?: TAllowance }): TProseFile[] {
	const exclude = options.exclude ?? [];
	const allowance = options.allowance ?? NO_ALLOWANCE;
	const files = new Map<string, { repository: string; path: string }>();
	for (const root of roots.map((given) => resolve(given))) {
		const isDirectory = statSync(root).isDirectory();
		const repository = repositoryOf(isDirectory ? root : dirname(root));
		for (const file of isDirectory ? filesUnder(repository, root) : [root]) {
			const path = relative(repository, file).split(sep).join("/");
			if (!exclude.some((pattern) => path.search(pattern) !== -1)) files.set(file, { repository, path });
		}
	}
	const used = new Set<TAllowed>();
	const read = new Set<string>();
	const reports = [...files.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.flatMap(([file, { repository, path }]) => {
			read.add(path);
			const { violations, used: usedHere } = scan(path, readFileSync(file, "utf8"), allowance);
			for (const entry of usedHere) used.add(entry);
			return violations.length > 0 ? [{ repository, path, violations }] : [];
		});
	const stale = allowance.entries.filter((entry) => read.has(entry.file) && !used.has(entry));
	if (stale.length > 0) {
		const listed = stale.map((entry) => `${entry.file} ${entry.rule} "${entry.text}"`).join("; ");
		throw new Error(`An allowed entry doesn't match a violation, so its text has changed or the violation is gone: ${listed}`);
	}
	return reports;
}
