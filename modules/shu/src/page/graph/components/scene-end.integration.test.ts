/**
 * Real-browser scene start and end. A scene removed from the page ends, and its own frames stop with it, so they don't read
 * what the end released. A frame in progress as the scene ends finishes, and the scene doesn't draw after it: the scene's timers and frames are
 * cancelled, its gate stops A-Frame's loop, and its renderer's context is released. A scene that ends before it loads
 * doesn't draw a frame: the scene doesn't show A-Frame's loading screen, which draws on a loop of its own. A model set
 * as a scene is made is fed once the library laid out its first data, so the library's engine doesn't tick before it holds
 * a layout.
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import { modelIn, mountPolymorphicPage, quadsNamed, type TMountedPage, type TQuadFed, type TViewElement } from "../../../test/polymorphic-page.js";

/** Animation frames the page runs after a scene's end, over which the ended scene mustn't draw. */
const FRAMES_AFTER_END = 60;

let mounted: TMountedPage;

beforeAll(async () => {
	mounted = await mountPolymorphicPage();
	await mounted.feed(quadsNamed(Array.from({ length: 24 }, (_, i) => `n-${i}`)));
}, 90_000);

afterAll(() => mounted?.close());

test("a scene that ends mid-frame finishes that frame and doesn't draw after it", { timeout: 60_000 }, async () => {
	await mounted.atRest();
	const drawn = await mounted.page.evaluate(
		(frames) =>
			new Promise<{ atEnd: number; after: number }>((done) => {
				const view = document.querySelector("shu-polymorphic-graph-view") as HTMLElement & { scene: { setSelectedSubject(id: string): void } };
				const scene = view.querySelector("a-scene") as HTMLElement & { tick(time: number, delta: number): void; renderer: { info: { render: { frame: number } } } };
				const tick = scene.tick.bind(scene);
				const frameOf = () => scene.renderer.info.render.frame;
				// The scene ends inside A-Frame's frame: its components tick and its renderer draws after the end.
				scene.tick = (time, delta) => {
					scene.tick = tick;
					const atEnd = frameOf();
					view.remove();
					tick(time, delta);
					let left = frames;
					const wait = () => (--left > 0 ? requestAnimationFrame(wait) : done({ atEnd, after: frameOf() }));
					requestAnimationFrame(wait);
				};
				view.scene.setSelectedSubject("n-3");
			}),
		FRAMES_AFTER_END,
	);
	expect(drawn.after - drawn.atEnd, `frames the ended scene drew over ${FRAMES_AFTER_END} frames, the one in progress included`).toBeLessThanOrEqual(1);
	expect(mounted.errors(), "page errors").toEqual([]);
});

test("a scene that ends before it loads doesn't draw a frame", { timeout: 60_000 }, async () => {
	const drawn = await mounted.page.evaluate(
		(frames) =>
			new Promise<number>((done) => {
				const box = document.querySelector("#box") as HTMLElement;
				const view = document.createElement("shu-polymorphic-graph-view");
				view.setAttribute("style", "display:block;width:100%;height:100%");
				box.appendChild(view);
				const scene = () => view.querySelector("a-scene") as (HTMLElement & { renderer?: { info: { render: { frame: number } } } }) | null;
				// The view builds its scene after its first update; it ends as soon as the scene exists.
				const endOnceBuilt = () => {
					if (!scene()) return requestAnimationFrame(endOnceBuilt);
					view.remove();
					let left = frames;
					const wait = () => (--left > 0 ? requestAnimationFrame(wait) : done(scene()?.renderer?.info.render.frame ?? 0));
					requestAnimationFrame(wait);
				};
				requestAnimationFrame(endOnceBuilt);
			}),
		FRAMES_AFTER_END,
	);
	expect(drawn, "frames drawn by a scene that ended before it loaded").toBe(0);
	expect(mounted.errors(), "page errors").toEqual([]);
});

test("a model set as a scene is made is drawn once the library laid out its first data", { timeout: 60_000 }, async () => {
	const fed = quadsNamed(["early-1", "early-2", "early-3"]);
	const madeAndFed = (quads: TQuadFed[], model: typeof modelIn) => {
		const box = document.querySelector("#box") as HTMLElement;
		box.replaceChildren();
		const view: TViewElement = document.createElement("shu-polymorphic-graph-view");
		view.setAttribute("style", "display:block;width:100%;height:100%");
		box.appendChild(view);
		// The model is set on the first frame the view holds its scene element, before the scene loads.
		const feedOnceMade = () => {
			if (!view.scene) return requestAnimationFrame(feedOnceMade);
			view.scene.setModel(model(quads));
		};
		feedOnceMade();
	};
	await mounted.page.evaluate(`(${madeAndFed})(${JSON.stringify(fed)}, ${modelIn})`);
	await mounted.draws(fed.length);
	await mounted.atRest();
	expect(mounted.errors(), "page errors").toEqual([]);
});
