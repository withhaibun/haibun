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
bundle.type = "module";
bundle.src = POLYMORPHIC_ROUTE.bundle;
const loaded = new Promise<void>((resolve, reject) => {
	bundle.addEventListener("load", () => resolve());
	bundle.addEventListener("error", () => reject(new Error("the view's bundle didn't load")));
});
document.head.append(bundle);
await loaded;
// The view attaches after the bundle has run, as the app attaches a view it has loaded, so the element is upgraded
// once the bundle has recorded its own URL and can resolve the label font beside it.
const box = document.getElementById("box") as HTMLElement;
const view = document.createElement("shu-polymorphic-graph-view");
if (box.hasAttribute("data-external")) {
	view.setAttribute("data-external", "");
	view.setAttribute("data-persist-scope", box.getAttribute("data-persist-scope") ?? "");
}
view.style.cssText = "display:block;width:100%;height:100%";
box.append(view);
