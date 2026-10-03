/**
 * Test results as records, in the W3C Evaluation and Report Language (EARL 1.0, https://www.w3.org/TR/EARL10-Schema/).
 *
 * An assertion states that an assertor tested a subject against a test case, and links the result: its outcome, where in
 * the subject it applies, and what the assertor states about it. Each is a record of its own, as EARL defines each as a
 * class, so a test case or a subject that several assertions name is one record they share. An assertion links to the
 * step that made it, so what a step found is read the same way as what a step produced.
 */
import { z } from "zod";
import { Access, LinkRelations, PersistedVertexSchema, SEQ_PATH_LABEL, writeEdge, writeReferenceEdge, type TDiscourseStore, type TDomainDefinition } from "@haibun/core/lib/resources.js";

/** The types the EARL classes are recorded as. */
export const EARL_LABEL = { assertion: "Assertion", assertor: "Assertor", testSubject: "TestSubject", testCase: "TestCase", testResult: "TestResult" } as const;

/** The outcomes EARL defines (earl:OutcomeValue). */
export const EARL_OUTCOME = { passed: "passed", failed: "failed", cantTell: "cantTell", inapplicable: "inapplicable", untested: "untested" } as const;

/** How a test was carried out (earl:TestMode). */
export const EARL_MODE = { automatic: "automatic", manual: "manual", semiAuto: "semiAuto", undisclosed: "undisclosed", unknownMode: "unknownMode" } as const;

/** An assertion's edges, each EARL's property of the same name, and the step that made it. */
export const EARL_ASSERTION_EDGE = { assertedBy: "assertedBy", subject: "subject", test: "test", result: "result", wasGeneratedBy: "wasGeneratedBy" } as const;

const AssertorSchema = PersistedVertexSchema.extend({ id: z.string(), name: z.string(), generatedAtTime: z.string() });
const TestSubjectSchema = PersistedVertexSchema.extend({ id: z.string(), url: z.string().optional(), generatedAtTime: z.string() });
const TestCaseSchema = PersistedVertexSchema.extend({
	id: z.string(),
	name: z.string(),
	description: z.string().optional(),
	/** Where the test case's guidance is read. */
	url: z.string().optional(),
	/** The criteria the test case checks, as its assertor names them. */
	tags: z.array(z.string()).optional(),
	generatedAtTime: z.string(),
});
const TestResultSchema = PersistedVertexSchema.extend({
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

export type TAssertor = z.infer<typeof AssertorSchema>;
export type TTestSubject = z.infer<typeof TestSubjectSchema>;
export type TTestCase = z.infer<typeof TestCaseSchema>;
export type TTestResult = z.infer<typeof TestResultSchema>;

export const earlDomainDefinitions: TDomainDefinition[] = [
	{
		selectors: ["earl-assertor"],
		schema: AssertorSchema,
		description: "A tool or person that tests something and states the results, such as an accessibility checker at a version.",
		topology: {
			persistedAs: EARL_LABEL.assertor,
			type: "earl:Assertor",
			subClassOf: "prov:Agent",
			id: "id",
			accessLevel: Access.public,
			properties: { id: LinkRelations.IDENTIFIER.rel, name: LinkRelations.NAME.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel },
			displayLabel: "name",
		},
	},
	{
		selectors: ["earl-test-subject"],
		schema: TestSubjectSchema,
		description: "What was tested, such as a web page by its address.",
		topology: {
			persistedAs: EARL_LABEL.testSubject,
			type: "earl:TestSubject",
			id: "id",
			properties: { id: LinkRelations.IDENTIFIER.rel, url: LinkRelations.URL.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel },
			displayLabel: "id",
		},
	},
	{
		selectors: ["earl-test-case"],
		schema: TestCaseSchema,
		description: "A test a subject is checked against, such as an accessibility rule, with the criteria it checks and where its guidance is read.",
		topology: {
			persistedAs: EARL_LABEL.testCase,
			type: "earl:TestCase",
			id: "id",
			accessLevel: Access.public,
			properties: {
				id: LinkRelations.IDENTIFIER.rel,
				name: LinkRelations.NAME.rel,
				description: { rel: LinkRelations.CONTENT.rel, iri: "dcterms:description" },
				url: LinkRelations.URL.rel,
				tags: LinkRelations.TAG.rel,
				generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel,
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
			type: "earl:TestResult",
			id: "id",
			properties: {
				id: LinkRelations.IDENTIFIER.rel,
				// Grouped-as, so "the failed results" and "the serious results" are filters the type offers.
				outcome: { rel: LinkRelations.CONTEXT.rel, iri: "earl:outcome" },
				info: { rel: LinkRelations.CONTENT.rel, iri: "earl:info" },
				pointers: { rel: LinkRelations.TAG.rel, iri: "earl:pointer" },
				impact: LinkRelations.CONTEXT.rel,
				generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel,
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
			type: "earl:Assertion",
			id: "id",
			properties: { id: LinkRelations.IDENTIFIER.rel, mode: { rel: LinkRelations.CONTEXT.rel, iri: "earl:mode" }, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel },
			edges: {
				[EARL_ASSERTION_EDGE.assertedBy]: { rel: LinkRelations.ATTRIBUTED_TO.rel, iri: "earl:assertedBy", range: EARL_LABEL.assertor, roleNoun: "Assertor" },
				[EARL_ASSERTION_EDGE.subject]: { rel: LinkRelations.TARGET.rel, iri: "earl:subject", range: EARL_LABEL.testSubject },
				[EARL_ASSERTION_EDGE.test]: { rel: LinkRelations.CONTEXT.rel, iri: "earl:test", range: EARL_LABEL.testCase },
				[EARL_ASSERTION_EDGE.result]: { rel: LinkRelations.CONTEXT.rel, iri: "earl:result", range: EARL_LABEL.testResult },
				[EARL_ASSERTION_EDGE.wasGeneratedBy]: { rel: LinkRelations.WAS_GENERATED_BY.rel, range: SEQ_PATH_LABEL },
			},
			// Titled by the test case it states a result of.
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

/** Record what an assertor states of a subject: each result as an assertion the step made, linked to the assertor, the
 *  subject, the test case and the result. Returns the assertions' ids. */
export async function writeEarlAssertions(store: TDiscourseStore, { assertor, subject, mode, step, results }: TEarlAssertions): Promise<string[]> {
	const generatedAtTime = new Date().toISOString();
	await Promise.all([store.upsertIndividual(EARL_LABEL.assertor, { ...assertor, generatedAtTime }), store.upsertIndividual(EARL_LABEL.testSubject, { ...subject, generatedAtTime })]);
	return await Promise.all(
		results.map(async ({ test, result }) => {
			const id = `${step} ${test.id}`;
			const resultId = `${id} result`;
			await Promise.all([
				store.upsertIndividual(EARL_LABEL.testCase, { ...test, generatedAtTime }),
				store.upsertIndividual(EARL_LABEL.testResult, { ...result, id: resultId, generatedAtTime }),
				store.upsertIndividual(EARL_LABEL.assertion, { id, mode, generatedAtTime }),
			]);
			const edge = (key: string, label: string, to: string) => writeEdge(store, EARL_LABEL.assertion, id, key, label, to);
			await Promise.all([
				edge(EARL_ASSERTION_EDGE.assertedBy, EARL_LABEL.assertor, assertor.id),
				edge(EARL_ASSERTION_EDGE.subject, EARL_LABEL.testSubject, subject.id),
				edge(EARL_ASSERTION_EDGE.test, EARL_LABEL.testCase, test.id),
				edge(EARL_ASSERTION_EDGE.result, EARL_LABEL.testResult, resultId),
				writeReferenceEdge(store, EARL_LABEL.assertion, id, EARL_ASSERTION_EDGE.wasGeneratedBy, SEQ_PATH_LABEL, step),
			]);
			return id;
		}),
	);
}
