/**
 * Test results as records, in the W3C Evaluation and Report Language (EARL 1.0, https://www.w3.org/TR/EARL10-Schema/).
 *
 * An assertion states that an assertor tested a subject against a test case, and links the result: its outcome, where in
 * the subject it applies, and what the assertor states about it. Each is a record of its own, as EARL defines each as a
 * class, so a test case or a subject that several assertions name is one record they share. An assertion links to the
 * step that made it, so what a step found is read the same way as what a step produced. Each type records a check actuality made,
 * so actuality writes an assertion while any step is in progress, and a step's contract doesn't list it.
 */
import {
	DCTERMS_DESCRIPTION,
	EARL_ASSERTED_BY,
	EARL_ASSERTION,
	EARL_ASSERTOR,
	EARL_INFO,
	EARL_MODE_PROPERTY,
	EARL_OUTCOME_PROPERTY,
	EARL_POINTER,
	EARL_RESULT,
	EARL_SUBJECT,
	EARL_TEST,
	EARL_TEST_CASE,
	EARL_TEST_RESULT,
	EARL_TEST_SUBJECT,
	PROV_AGENT,
} from "./vocabularies.js";
import { VERDICT } from "./protocol.js";
import { z } from "zod";
import { Access, LinkRelations, PersistedVertexSchema, SEQ_PATH_LABEL, type TDomainDefinition } from "./resources.js";

/** The types the EARL classes are recorded as. */
export const EARL_LABEL = { assertion: "Assertion", assertor: "Assertor", testSubject: "TestSubject", testCase: "TestCase", testResult: "TestResult" } as const;

/** The outcomes EARL defines (earl:OutcomeValue). */
export const EARL_OUTCOME = { passed: "passed", failed: "failed", cantTell: "cantTell", inapplicable: "inapplicable", untested: "untested" } as const;

/** The EARL outcome of each verdict of a claim, and the verdict each outcome states. */
export const OUTCOME_OF_VERDICT = { [VERDICT.proved]: EARL_OUTCOME.passed, [VERDICT.refuted]: EARL_OUTCOME.failed, [VERDICT.unknown]: EARL_OUTCOME.cantTell } as const;
export const VERDICT_OF_OUTCOME = { [EARL_OUTCOME.passed]: VERDICT.proved, [EARL_OUTCOME.failed]: VERDICT.refuted, [EARL_OUTCOME.cantTell]: VERDICT.unknown } as const;

/** How a test was carried out (earl:TestMode). */
export const EARL_MODE = { automatic: "automatic", manual: "manual", semiAuto: "semiAuto", undisclosed: "undisclosed", unknownMode: "unknownMode" } as const;

/** An assertion's edges, each EARL's property of the same name, and the step that made it. */
export const EARL_ASSERTION_EDGE = { assertedBy: "assertedBy", subject: "subject", test: "test", result: "result", wasGeneratedBy: "wasGeneratedBy" } as const;

const AssertorSchema = PersistedVertexSchema.extend({ id: z.string(), name: z.string(), generatedAtTime: z.string() });
const TestSubjectSchema = PersistedVertexSchema.extend({ id: z.string(), url: z.string().optional(), generatedAtTime: z.string() });
export const TestCaseSchema = PersistedVertexSchema.extend({
	id: z.string(),
	name: z.string(),
	description: z.string().optional(),
	/** Where the test case's guidance is read. */
	url: z.string().optional(),
	/** The criteria the test case checks, as its assertor names them. */
	tags: z.array(z.string()).optional(),
	generatedAtTime: z.string(),
});
export const TestResultSchema = PersistedVertexSchema.extend({
	id: z.string(),
	outcome: z.enum(EARL_OUTCOME),
	/** What the assertor states about the result. */
	info: z.string().optional(),
	/** Where in the subject the result applies, as the assertor locates it. */
	pointers: z.array(z.string()).optional(),
	/** How severe the assertor rates the result, in its own terms. */
	impact: z.string().optional(),
	generatedAtTime: z.string(),
});
const AssertionSchema = PersistedVertexSchema.extend({ id: z.string(), mode: z.enum(EARL_MODE), generatedAtTime: z.string() });

type TAssertor = z.infer<typeof AssertorSchema>;
type TTestSubject = z.infer<typeof TestSubjectSchema>;
export type TTestCase = z.infer<typeof TestCaseSchema>;
type TTestResult = z.infer<typeof TestResultSchema>;

export const earlDomainDefinitions: TDomainDefinition[] = [
	{
		selectors: ["earl-assertor"],
		schema: AssertorSchema,
		description: "A tool or person that tests something and states the results, such as an accessibility checker at a version.",
		topology: {
			persistedAs: EARL_LABEL.assertor,
			observesActuality: true,
			type: EARL_ASSERTOR,
			subClassOf: PROV_AGENT,
			id: "id",
			accessLevel: Access.public,
			properties: { id: LinkRelations.IDENTIFIER.rel, name: LinkRelations.NAME.rel },
			displayLabel: "name",
		},
	},
	{
		selectors: ["earl-test-subject"],
		schema: TestSubjectSchema,
		description: "What was tested, such as a web page by its address.",
		topology: {
			persistedAs: EARL_LABEL.testSubject,
			observesActuality: true,
			accessLevel: Access.private,
			type: EARL_TEST_SUBJECT,
			id: "id",
			properties: { id: LinkRelations.IDENTIFIER.rel, url: LinkRelations.URL.rel },
			displayLabel: "id",
		},
	},
	{
		selectors: ["earl-test-case"],
		schema: TestCaseSchema,
		description: "A test a subject is checked against, such as an accessibility rule, with the criteria it checks and where its guidance is read.",
		topology: {
			persistedAs: EARL_LABEL.testCase,
			observesActuality: true,
			type: EARL_TEST_CASE,
			id: "id",
			accessLevel: Access.public,
			properties: {
				id: LinkRelations.IDENTIFIER.rel,
				name: LinkRelations.NAME.rel,
				description: { rel: LinkRelations.CONTENT.rel, iri: DCTERMS_DESCRIPTION },
				url: LinkRelations.URL.rel,
				tags: LinkRelations.TAG.rel,
			},
			displayLabel: "name",
		},
	},
	{
		selectors: ["earl-test-result"],
		schema: TestResultSchema,
		description: "The result of a test: its outcome, where in the subject it applies, and what the assertor states about it.",
		topology: {
			persistedAs: EARL_LABEL.testResult,
			observesActuality: true,
			accessLevel: Access.private,
			type: EARL_TEST_RESULT,
			id: "id",
			properties: {
				id: LinkRelations.IDENTIFIER.rel,
				// Grouped-as, so "the failed results" and "the serious results" are filters the type offers.
				outcome: { rel: LinkRelations.CONTEXT.rel, iri: EARL_OUTCOME_PROPERTY },
				info: { rel: LinkRelations.CONTENT.rel, iri: EARL_INFO },
				pointers: { rel: LinkRelations.TAG.rel, iri: EARL_POINTER },
				impact: LinkRelations.CONTEXT.rel,
			},
			displayLabel: "outcome",
			sortColumns: { outcome: "TEXT", impact: "TEXT" },
		},
	},
	{
		selectors: ["earl-assertion"],
		schema: AssertionSchema,
		description: "A statement that an assertor tested a subject against a test case, with the result, made by a step.",
		topology: {
			persistedAs: EARL_LABEL.assertion,
			observesActuality: true,
			accessLevel: Access.private,
			type: EARL_ASSERTION,
			id: "id",
			properties: { id: LinkRelations.IDENTIFIER.rel, mode: { rel: LinkRelations.CONTEXT.rel, iri: EARL_MODE_PROPERTY } },
			edges: {
				[EARL_ASSERTION_EDGE.assertedBy]: { rel: LinkRelations.ATTRIBUTED_TO.rel, iri: EARL_ASSERTED_BY, range: EARL_LABEL.assertor, roleNoun: "Assertor" },
				[EARL_ASSERTION_EDGE.subject]: { rel: LinkRelations.TARGET.rel, iri: EARL_SUBJECT, range: EARL_LABEL.testSubject },
				[EARL_ASSERTION_EDGE.test]: { rel: LinkRelations.CONTEXT.rel, iri: EARL_TEST, range: EARL_LABEL.testCase },
				[EARL_ASSERTION_EDGE.result]: { rel: LinkRelations.CONTEXT.rel, iri: EARL_RESULT, range: EARL_LABEL.testResult, owns: true },
				[EARL_ASSERTION_EDGE.wasGeneratedBy]: { rel: LinkRelations.WAS_GENERATED_BY.rel, range: SEQ_PATH_LABEL, reference: true },
			},
			// Titled by the test case whose result it states.
			displayLabel: EARL_ASSERTION_EDGE.test,
		},
	},
];

/** The results one assertor states of one subject, each against a test case. */
export type TEarlAssertions = {
	assertor: Omit<TAssertor, "generatedAtTime">;
	subject: Omit<TTestSubject, "generatedAtTime">;
	mode: (typeof EARL_MODE)[keyof typeof EARL_MODE];
	/** The record of the step that made the assertions, which names each of them. */
	step: string;
	results: { test: Omit<TTestCase, "generatedAtTime">; result: Omit<TTestResult, "id" | "generatedAtTime"> }[];
};
