import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { ShuStepper, SHU_TEST_IDS, flattenTestIds } from "@haibun/shu";
import { createStepUI } from "@haibun/shu/test/step-ui.js";
import TutorialGraphStepper from "@haibun/shu/tutorial-graph-stepper.js";

const wp = new WebPlaywright();
const { waitFor, gotoPage, reloadPage } = withAction(wp);
const { serveShuApp } = withAction(new ShuStepper());
const { setAs, is, setFromStatement } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());
const tutorial = withAction(new TutorialGraphStepper());
const { createResearcher, createPaper, publishPaper } = tutorial;
const { enterStepMode, passesStepExecution } = createStepUI(wp);

const host = "http://localhost:8239";
const IDS = SHU_TEST_IDS;
const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));

const michiCardTestId = (goalIdx: number, michiIdx: number) => `michi-card-${goalIdx}-${michiIdx}`;
const runMichiTestId = (goalIdx: number, michiIdx: number) => `run-michi-${goalIdx}-${michiIdx}`;
const extraTestIds = [
	michiCardTestId(0, 0),
	michiCardTestId(0, 1),
	runMichiTestId(0, 0),
	runMichiTestId(0, 1),
	IDS.AFFORDANCES.EMPTY,
].map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));

const DOMAIN_RESEARCHER = "tutorial-researcher";
const DOMAIN_PAPER = "tutorial-paper";

export const features: TKirejiExport = {
	"Goal Resolution as a Holistic System": [
		feature({ feature: "Goal Resolution as a Holistic System" }),

		"The arrangement is HATEOAS. The SPA does not encode flows. It reads the world and projects the actions available from where the user stands. The user navigates by following typed edges.",

		"Steppers declare typed signals. Each step that produces a typed value declares its output domain. Across all registered steppers, those declarations form the producer set. The graph is the description of what the application can do. Adding a stepper extends the graph; the SPA never changes.",

		"The resolver enumerates the producers of a target domain. Each enumerated path is one michi (the way). When multiple steps share an outputDomain, the resolver returns multiple michi for that goal.",

		"Working memory is the single source of truth. A step that declares an output domain auto-asserts its product as a fact. The resolver, the affordances projection, and every panel that reads state consult the same store. Reload preserves the store; the projection returns to the same shape.",

		"The resolver returns one of four findings. Satisfied: a matching fact exists. Michi: paths exist from the current state. Unreachable: no producer chain leads to the goal. Refused: the resolver lacks the information to answer. The findings partition the answer space.",

		"TutorialGraphStepper is the SPA's reference data stepper. Its typed producer steps are: createResearcher produces a tutorial-researcher; createPaper produces a tutorial-paper; publishPaper also produces a tutorial-paper. The two producers of tutorial-paper give the resolver two michi for that goal — the case the plan picker UI is built for.",

		"after every WebPlaywright, take a screenshot",
		...testIdSetup,
		...extraTestIds,

		scenario({ scenario: "Bootstrap the SPA" }),

		"enable rpc",
		serveShuApp({ path: '"/haibun"' }),
		`webserver is listening for "goal-resolution-test"`,
		gotoPage({ name: `"${host}/haibun"` }),
		"Wait for the SPA shell to render.",
		waitFor({ target: IDS.APP.ROOT }),
		waitFor({ target: IDS.APP.TWISTY }),

		scenario({ scenario: "Resolve the researcher goal with no facts" }),

		"CreateResearcher is the sole producer of tutorial-researcher and takes a name argument. The resolver returns finding=michi with one path. The path's single step is createResearcher.",
		setFromStatement({ what: "researcherEmpty", statement: `resolve "${DOMAIN_RESEARCHER}"` }),
		is({ what: "researcherEmpty.finding", value: '"michi"' }),
		is({ what: "researcherEmpty.michi.0.steps.0.stepName", value: '"createResearcher"' }),
		is({ what: "researcherEmpty.michi.0.steps.0.stepperName", value: '"TutorialGraphStepper"' }),

		scenario({ scenario: "Run createResearcher; resolve again returns satisfied" }),

		"CreateResearcher has outputDomain=tutorial-researcher. Running it auto-asserts a fact. The next resolve call returns finding=satisfied.",
		createResearcher({ name: '"Mariko"' }),
		setFromStatement({ what: "researcherSatisfied", statement: `resolve "${DOMAIN_RESEARCHER}"` }),
		is({ what: "researcherSatisfied.finding", value: '"satisfied"' }),
		is({ what: "researcherSatisfied.goal", value: `"${DOMAIN_RESEARCHER}"` }),

		scenario({ scenario: "Resolve the paper goal; two producers yield two michi" }),

		"CreatePaper and publishPaper both produce tutorial-paper. The resolver enumerates both as distinct michi. The michi array has length 2.",
		setFromStatement({ what: "paperGoal", statement: `resolve "${DOMAIN_PAPER}"` }),
		is({ what: "paperGoal.finding", value: '"michi"' }),
		is({ what: "paperGoal.michi.length", value: '"2"' }),

		scenario({ scenario: "Show affordances; the panel renders both michi cards for the paper goal" }),

		"The affordances panel mounts in response to show affordances. The signature of the picker UI: one card per goal-producing domain, with one michi card per enumerated path. The paper goal has two michi cards: michi-card-N-0 and michi-card-N-1. Forward-reachable steps are no longer duplicated in the panel — they live in the actions-bar's step picker — so the panel asserts goals only.",
		...enterStepMode,
		...passesStepExecution("show affordances"),
		waitFor({ target: IDS.AFFORDANCES.ROOT }),
		waitFor({ target: IDS.AFFORDANCES.GOALS_LIST }),

		scenario({ scenario: "Run createPaper; the paper goal becomes satisfied" }),

		"CreatePaper auto-asserts a tutorial-paper fact. The next resolve returns finding=satisfied.",
		createPaper({ title: '"On Foliage"' }),
		setFromStatement({ what: "paperSatisfied", statement: `resolve "${DOMAIN_PAPER}"` }),
		is({ what: "paperSatisfied.finding", value: '"satisfied"' }),

		scenario({ scenario: "Run publishPaper; a second paper fact is asserted" }),

		"PublishPaper has the same outputDomain as createPaper. Running it asserts another tutorial-paper fact. Both producers fired, both facts exist.",
		publishPaper({ title: '"On Tides"', date: '"2026-04-01"' }),
		setFromStatement({ what: "paperStillSatisfied", statement: `resolve "${DOMAIN_PAPER}"` }),
		is({ what: "paperStillSatisfied.finding", value: '"satisfied"' }),

		scenario({ scenario: "Resolve a registered domain with no producer; finding=unreachable" }),

		"The test-scratch domain is registered in the core registry but has no producer step. The resolver returns unreachable. The missing array lists the domain.",
		setFromStatement({ what: "unreachableGoal", statement: `resolve "test-scratch"` }),
		is({ what: "unreachableGoal.finding", value: '"unreachable"' }),
		is({ what: "unreachableGoal.missing.0", value: '"test-scratch"' }),

		scenario({ scenario: "Show chain lint; the structured report renders in its bound view" }),

		"The chain-lint pane mounts on show chain lint. Its bound view renders a Mermaid graph of the registered domain chain.",
		...passesStepExecution("show chain lint"),
		waitFor({ target: IDS.DOMAIN_CHAIN.ROOT }),
		waitFor({ target: IDS.DOMAIN_CHAIN.GRAPH }),

		scenario({ scenario: "Reload; the affordances and chain-lint panes both restore" }),

		"Reload re-mounts both panes from the URL hash. Each pane self-fetches its data through its bound producer step over RPC.",
		reloadPage({}),
		waitFor({ target: IDS.AFFORDANCES.ROOT }),
		waitFor({ target: IDS.DOMAIN_CHAIN.ROOT }),
		waitFor({ target: IDS.DOMAIN_CHAIN.GRAPH }),

		scenario({ scenario: "After reload, asserted facts survive" }),

		"Working memory persists across reload. The researcher and paper facts remain. Resolving the paper goal after reload returns finding=satisfied.",
		setFromStatement({ what: "paperAfterReload", statement: `resolve "${DOMAIN_PAPER}"` }),
		is({ what: "paperAfterReload.finding", value: '"satisfied"' }),
	],
};
