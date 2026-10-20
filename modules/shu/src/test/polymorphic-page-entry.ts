/**
 * The entry of the page a polymorphic integration test serves (CA3D11). It starts the page as the app's entry does, with a
 * hydration, the reader's authority, an event stream and a conduit whose read of actuality's steps returns a fixed step
 * list, reads those steps, and then loads the view's bundle, so the view draws on a page that holds actuality's catalog.
 * Each call the page makes of its site is kept, in order, for a test that reads which calls the page made.
 */
import { declaringSteps, setupShuTest, stepsShown } from "./setup.js";
import { GRAPH_READ_STEPS, catalogOf, domainsOf } from "./catalog-fixture.js";
import { getAvailableSteps } from "../page/controllers/registry-controller.js";
import { DISPATCHED_KEY, POLYMORPHIC_ROUTE } from "./polymorphic-routes.js";

/** The types the test's quads name (`quadsNamed`), each titled by its name. */
const SPEC = { types: ["Email"], rels: { Email: { name: "name" } } };

const shown = stepsShown(GRAPH_READ_STEPS, domainsOf(SPEC), catalogOf(SPEC));
const declared = declaringSteps(() => shown);
const dispatched: string[] = [];
Object.assign(globalThis, { [DISPATCHED_KEY]: dispatched });
setupShuTest({
	dispatch: (method, params, link) => {
		dispatched.push(method);
		return declared(method, params, link);
	},
});
await getAvailableSteps();
const bundle = document.createElement("script");
bundle.src = POLYMORPHIC_ROUTE.bundle;
document.head.append(bundle);
