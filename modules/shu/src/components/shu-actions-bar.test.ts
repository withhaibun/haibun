// @vitest-environment jsdom
/**
 * The actions bar reads the page's state wherever it is placed: the context a view states and a step a view chooses. It
 * is not told them by the app through its place in the page. It is a pane's view, so it opens its pane for a chosen
 * step, and its scope of the active record follows its pane. What its search describes goes to the page strip.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Access } from "@haibun/core/lib/resources.js";
import { buildConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import { provideLayout } from "../test/jsdom-layout.js";
import { ShuActionsBar } from "./shu-actions-bar.js";
import { SHU_ATTR, SHU_EVENT, SHU_TAG } from "../consts.js";
import { ShuColumnPane } from "./shu-column-pane.js";
// The app registers the ask pane, which the bar renders in Ask mode.
import "./shu-kihan-chat.js";
import { INITIAL_SUBJECT, SCOPE, currentSubjectState } from "../current-subject.js";
import { pageContext, pageStatus, pageTrail } from "../signals.js";
import { STOPPED_BY_THE_READER, conversationState, dispatchConversationEvent } from "../conversation.js";
import { commandList } from "../slash-command.js";
import { aType } from "../schemas.js";
import { carryARun, persistedTypeDefinition, setupShuTest } from "../test-setup.js";
import { CHAT_STEP, chatDispatch } from "./chat-pane.test-fake.js";

provideLayout();

/** The run the bar reads: it offers the step an ask runs, so a chosen Ask mode renders, declares one type to search, and
 *  doesn't declare an extension for the bar. */
const AN_ASK_AND_A_TYPE = chatDispatch(
	(step) => {
		throw new Error(`unexpected ${step}`);
	},
	{ steps: [CHAT_STEP.ask], concerns: buildConcernCatalog(mapDefinitionsToDomains([persistedTypeDefinition("Email", { declared: true })])) },
);

type TBar = HTMLElement & { updateComplete: Promise<unknown>; state: { mode: string }; setState: (partial: { mode: string }) => void };
type TPane = InstanceType<typeof ShuColumnPane>;

/** A column's collapse reaches its view through an observer of the pane, which reports after the change. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mountBar(): Promise<TBar> {
	const bar = new ShuActionsBar() as unknown as TBar;
	document.body.appendChild(bar);
	await bar.updateComplete;
	return bar;
}

/** The bar as the view of a docked pane, closed to its strip, as the page holds it. */
async function mountDockedBar(): Promise<{ pane: TPane; bar: TBar }> {
	const pane = new ShuColumnPane();
	pane.setAttribute("label", "Actions");
	pane.dataset.columnKey = SHU_TAG.ACTIONS_BAR;
	pane.setDocked(true);
	document.body.appendChild(pane);
	const bar = new ShuActionsBar() as unknown as TBar;
	pane.appendChild(bar);
	await pane.updateComplete;
	await bar.updateComplete;
	return { pane, bar };
}

describe("the actions bar reads the page's state", () => {
	let teardown: () => void;
	beforeEach(() => {
		teardown = setupShuTest({ dispatch: AN_ASK_AND_A_TYPE }).teardown;
		// The page is a record of the run, so what the bar reports doesn't go to a server.
		carryARun();
		document.body.innerHTML = "";
		pageContext.set(null);
		pageTrail.set("All");
		currentSubjectState.set(INITIAL_SUBJECT);
	});
	// A pane updates while it is in the page, and a pane doesn't update after it leaves the page: every case ends with the panes it
	// mounted removed, so they don't render while the test environment closes.
	afterEach(() => {
		document.body.innerHTML = "";
		teardown();
	});

	/** Types `text` in an input line and presses Enter in it, as the reader does. */
	const pressEnterWith = (line: HTMLInputElement | HTMLTextAreaElement, text: string): void => {
		line.value = text;
		line.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true, cancelable: true }));
	};
	const openBar = async (): Promise<TBar> => {
		const { pane, bar } = await mountDockedBar();
		pane.open();
		await settle();
		await bar.updateComplete;
		return bar;
	};
	const searchLine = (bar: TBar) => bar.shadowRoot?.querySelector<HTMLInputElement>(".text-search") as HTMLInputElement;

	it("selects the mode a slash command names, and the mode control follows", async () => {
		const bar = await openBar();
		pressEnterWith(searchLine(bar), "/ask");
		await settle();
		await bar.updateComplete;
		expect(bar.state.mode).toBe("ask");
		expect(bar.shadowRoot?.querySelector<HTMLSelectElement>(".mode-select")?.value, "the mode control shows the mode").toBe("ask");
	});

	it("enters the rest of a command's line in the input line of the mode it names", async () => {
		const bar = await openBar();
		bar.setState({ mode: "ask" });
		await settle();
		await bar.updateComplete;
		const ask = bar.shadowRoot?.querySelector(SHU_TAG.KIHAN_CHAT) as HTMLElement & { updateComplete: Promise<unknown> };
		await ask.updateComplete;
		pressEnterWith(ask.shadowRoot?.querySelector(".chat-input") as HTMLTextAreaElement, "/search the dough");
		await settle();
		await bar.updateComplete;
		expect(bar.state.mode).toBe("search");
		expect(searchLine(bar).value, "the search line holds the rest of the line").toBe("the dough");
	});

	it("stops the running turn with /stop, as the ask pane's Stop control does", async () => {
		const bar = await openBar();
		dispatchConversationEvent({ type: "ask", prompt: "what is this?", patterns: [], delegated: [] });
		pressEnterWith(searchLine(bar), "/stop");
		expect(conversationState.get().asked?.stoppedBy).toBe(STOPPED_BY_THE_READER);
	});

	it("refuses an unknown command on the page strip, listing the commands, and leaves a double slash's line with one slash", async () => {
		const bar = await openBar();
		pressEnterWith(searchLine(bar), "/nope");
		expect(pageStatus.get()).toBe(`/nope isn't a command. The commands are ${commandList()}.`);
		pressEnterWith(searchLine(bar), "//etc");
		expect(searchLine(bar).value).toBe("/etc");
		expect(bar.state.mode, "the mode stays").toBe("search");
	});

	it("describes to the page strip the context a view stated before the bar connected, and settles its type once the types are read", async () => {
		pageContext.set({ patterns: [aType("Email")], accessLevel: Access.private, label: "Email" });
		await mountBar();
		expect(pageTrail.get(), "the search names the stated type").toContain("Email");
	});

	it("opens its pane for a step a view chooses, from wherever the view is in the page", async () => {
		const { pane, bar } = await mountDockedBar();
		expect(pane.isCollapsed, "the docked pane stands at its strip").toBe(true);
		const elsewhere = document.createElement("div");
		document.body.appendChild(elsewhere);
		elsewhere.dispatchEvent(new CustomEvent(SHU_EVENT.STEP_CHOOSE, { detail: { method: "GraphStepper-graphQuery" }, bubbles: true, composed: true }));
		await bar.updateComplete;
		expect(bar.state.mode, "the bar is in step mode").toBe("step");
		expect(pane.isCollapsed, "and its pane is open").toBe(false);
	});

	it("shows the search's filters where its pane's settings control does, above the transcript, and the search line without them", async () => {
		const { pane, bar } = await mountDockedBar();
		pane.open();
		await settle();
		await bar.updateComplete;
		expect(bar.shadowRoot?.querySelector(".text-search"), "the text to search for stands in the line").not.toBeNull();
		expect(bar.shadowRoot?.querySelector(".search-settings"), "and its filters wait on the pane's control").toBeNull();
		bar.setAttribute(SHU_ATTR.SHOW_CONTROLS, "");
		await bar.updateComplete;
		const regions = Array.from(bar.shadowRoot?.querySelector(".actions-bar")?.children ?? []).map((c) => c.className.split(" ")[0] || c.tagName.toLowerCase());
		expect(regions, "the filters stand above the transcript, and the search line below it").toEqual(["filter-bar", SHU_TAG.ACTIVITY_HISTORY, "filter-bar"]);
		expect(bar.shadowRoot?.querySelector(".add-filter"), "the control that adds a condition").not.toBeNull();
	});

	it("holds the transcript inside the ask, with the settings its pane's control states, so the settings stand above it", async () => {
		const { pane, bar } = await mountDockedBar();
		pane.open();
		bar.setState({ mode: "ask" });
		await settle();
		await bar.updateComplete;
		const ask = bar.shadowRoot?.querySelector(SHU_TAG.KIHAN_CHAT) as HTMLElement | null;
		expect(ask, "the ask is the body of the bar").not.toBeNull();
		expect(ask?.querySelector(SHU_TAG.ACTIVITY_HISTORY), "and holds the transcript").not.toBeNull();
		expect(ask?.hasAttribute(SHU_ATTR.SHOW_CONTROLS), "whose settings are hidden until the pane's control shows them").toBe(false);
		bar.setAttribute(SHU_ATTR.SHOW_CONTROLS, "");
		await bar.updateComplete;
		expect(ask?.hasAttribute(SHU_ATTR.SHOW_CONTROLS)).toBe(true);
	});

	it("opens its scope of the active record with its pane, closes it with its pane, and closes it when the bar goes", async () => {
		const { pane, bar } = await mountDockedBar();
		await settle();
		expect(currentSubjectState.get().open).not.toContain(SCOPE.actionsBar);
		pane.open();
		await settle();
		await bar.updateComplete;
		expect(currentSubjectState.get().open).toContain(SCOPE.actionsBar);
		pane.close();
		await settle();
		await bar.updateComplete;
		expect(currentSubjectState.get().open, "a pane closed to its strip closes the scope").not.toContain(SCOPE.actionsBar);
		pane.open();
		await settle();
		await bar.updateComplete;
		bar.remove();
		expect(currentSubjectState.get().open, "a bar removed from the page leaves its scope closed").not.toContain(SCOPE.actionsBar);
	});
});
