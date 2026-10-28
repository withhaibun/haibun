import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { SHU_EVENT } from "../domains/elements.js";
import { SHU_TEST_IDS } from "../domains/test-ids.js";
import { SHARED_CELLS_KEY } from "../page/adapters/shared-cell.js";
import type { TSubjectState } from "../page/machines/current-subject.js";
import type { TPaneOpen } from "../page/derivations/pane-kinds.js";
import type { GraphSceneConfig, GraphSceneModel, ShuGraphScene } from "../page/graph/components/scene.js";
import { READ_STATE } from "../page/graph/domains/views.js";
import { DISPATCHED_KEY, POLYMORPHIC_ROUTE } from "./polymorphic-routes.js";
import { LABEL_FONT, LABEL_FONT_FALLBACKS } from "../domains/serving.js";
import { labelFontResponse } from "../pipelines/served-page.js";
import { bundleFile } from "../adapters/bundle-file.js";
import { errorDetail } from "@haibun/core/lib/domains/util.js";
import { builtEntry, openTestPage } from "./test-page.js";

/**
 * A real page with the polymorphic graph view mounted on it, drawn by a headless browser through a software rasterizer.
 * Every browser test of the scene needs the same page: the bundle served, the view mounted at a known size, a model fed
 * the way the app feeds one, and the scene read as a reader reads it. A test waits for what the view states: the count its
 * reading names, and the reading no longer busy. It reads where a node draws through the library's own camera, and acts
 * with the pointer, so what it asserts is what a reader sees and does.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = join(HERE, "..", "..", "build", "assets", "shu-polymorphic-graph-view.js");
const ENTRY_PATH = join(HERE, "polymorphic-page-entry.ts");

/** The page's entry, built once per test file: it starts the page and then loads the view's bundle. */
let entry: Promise<string> | undefined;
const pageEntry = (): Promise<string> => {
	entry ??= builtEntry(ENTRY_PATH);
	return entry;
};

type TBox = { width: number; height: number };

/** The view's box on the page: fixed, so a test that resizes it has a known starting size. */
export const BOX: TBox = { width: 1000, height: 700 };

/** The scope an embedded graph on the page keeps its settings under. */
const EMBEDDED_SCOPE = "embedded";

/** The page, its view the page's main graph, or a graph a host embeds to draw its own data (`data-external`). */
const pageWith = (external: boolean, box: TBox): string => `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="${POLYMORPHIC_ROUTE.entry}"></script></head>
<body style="margin:0">
	<div id="box" style="position:fixed;left:0;top:0;width:${box.width}px;height:${box.height}px;">
		<shu-polymorphic-graph-view ${external ? `data-external data-persist-scope="${EMBEDDED_SCOPE}"` : ""} style="display:block;width:100%;height:100%"></shu-polymorphic-graph-view>
	</div>
</body></html>`;

export type TQuadFed = { subject: string; namedGraph: string; predicate: string; object: string; timestamp: number };
/** One property quad per named node, as a snapshot holds them, so every node is built the way the app builds one. */
export const quadsNamed = (ids: readonly string[]): TQuadFed[] => ids.map((id) => ({ subject: id, namedGraph: "Email", predicate: "name", object: id, timestamp: 0 }));

/** The scene as a test drives it: what its host calls on it. */
export type TSceneApi = Pick<ShuGraphScene, "setSelectedSubject" | "fitGraph"> & { setConfig(patch: Partial<GraphSceneConfig>): void };
/** A view on the page, as a test reaches its scene, which the view makes after its first update. */
export type TViewElement = HTMLElement & { scene?: ShuGraphScene };
/** In the page: the scene of the view `view` names, or a failure naming the view that hasn't made one. */
const sceneIn = (view: string): ShuGraphScene => {
	const scene = (document.querySelector(view) as TViewElement | null)?.scene;
	if (scene === undefined) throw new Error(`${view} hasn't made its scene`);
	return scene;
};
/** In the page: a model as a host sets it, the quads it draws with the clusters and filters a feed carries. */
export const modelIn = (quads: readonly TQuadFed[]): GraphSceneModel =>
	({
		quads,
		visibleQuads: quads,
		clusters: [],
		knownClusters: new Map(),
		hiddenGraphs: [],
		hiddenPredicates: [],
		perTypeLimit: 1000,
		timeCursor: null,
	}) as unknown as GraphSceneModel;

/** A pixel on the page. */
export type TPixel = { x: number; y: number };
/** An entry of the graph's reading: the node it names, and whether the reading states it active or dimmed. */
export type TReadEntry = { id: string; active: boolean; dimmed: boolean };

/** Selectors and names the page-side readers take, passed in since a function evaluated in the page sees only its argument. */
const IN_PAGE = { view: "shu-polymorphic-graph-view", reading: `[data-testid="${SHU_TEST_IDS.POLYMORPHIC_VIEW.A11Y}"]`, dimmed: `, ${READ_STATE.dimmed})` };
type TInPage = typeof IN_PAGE;

/** In the page: where each named node draws, through the library's camera and the library's own projection, once the
 *  scene is at rest, two frames in a row draw each at the same pixel, and the canvas draws at its shown size, the scene's
 *  own. A resize reaches the scene a frame after the page's layout, and the camera returns to a followed node once the
 *  frame takes its size, so two frames can be equal before either. The scene's rest, which counts the resize and the
 *  camera still pending, and the canvas at the scene's size mark the settled view. The renderer takes a new size a frame
 *  before the canvas's own box does, and a read between the two maps the node onto a box that is no longer there. False
 *  until then, so a wait polled each frame returns the pixels. */
const steadyIn = ({ ids, at }: { ids: readonly string[]; at: TInPage }): Record<string, TPixel> | false => {
	type TNode = { id: string; x: number; y: number; z: number };
	type TVector = { x: number; y: number; project(camera: unknown): TVector };
	const view = document.querySelector(at.view);
	const scene = view?.querySelector("a-scene") as (Element & { camera?: { updateMatrixWorld(force: boolean): void } }) | null;
	const engine = view?.querySelector("[forcegraph]") as (Element & { components: { forcegraph: { forceGraph: { graphData(): { nodes: TNode[] } } } } }) | null;
	const canvas = view?.querySelector("canvas");
	const THREE = (globalThis as unknown as { AFRAME: { THREE: { Vector3: new (x: number, y: number, z: number) => TVector } } }).AFRAME.THREE;
	const probe = window as unknown as { lastDrawn?: string };
	if (!scene?.camera || !engine || !canvas) return false;
	if (document.querySelector(`${at.view} ${at.reading}`)?.getAttribute("aria-busy") !== "false") return false;
	const shown = canvas.getBoundingClientRect();
	const hosted = scene.getBoundingClientRect();
	const dpr = window.devicePixelRatio;
	if (Math.abs(canvas.width / dpr - shown.width) >= 1 || Math.abs(canvas.height / dpr - shown.height) >= 1) return false;
	// The canvas has taken the scene's size, so a resize of the view has reached the frame as well as the camera.
	if (Math.abs(shown.width - hosted.width) >= 1 || Math.abs(shown.height - hosted.height) >= 1) return false;
	scene.camera.updateMatrixWorld(true);
	const drawn: Record<string, TPixel> = {};
	for (const n of engine.components.forcegraph.forceGraph.graphData().nodes) {
		if (!ids.includes(n.id)) continue;
		const ndc = new THREE.Vector3(n.x, n.y, n.z).project(scene.camera);
		drawn[n.id] = { x: shown.left + ((ndc.x + 1) / 2) * shown.width, y: shown.top + ((1 - ndc.y) / 2) * shown.height };
	}
	const read = Object.keys(drawn).length < ids.length ? undefined : JSON.stringify(Object.values(drawn).map((p) => [Math.round(p.x), Math.round(p.y)]));
	const same = read !== undefined && read === probe.lastDrawn;
	probe.lastDrawn = read;
	return same ? drawn : false;
};

/** In the page: the entries of the graph's reading, each with the states it reads. */
const readingIn = (at: TInPage): TReadEntry[] =>
	[...document.querySelectorAll<HTMLElement>(`${at.view} ${at.reading} ol > li > [data-node-id]`)].map((entry) => ({
		id: entry.dataset.nodeId ?? "",
		active: entry.getAttribute("aria-current") === "true",
		dimmed: entry.textContent?.includes(at.dimmed) ?? false,
	}));

export type TMountedPage = {
	page: Page;
	/** The page's errors. */
	errors(): string[];
	/** Feed a model as the view's host does, and wait for the reading to name every node of it and the scene to rest. */
	feed(quads: readonly TQuadFed[]): Promise<void>;
	/** Wait until the reading names `count` nodes. */
	draws(count: number): Promise<void>;
	/** Wait until what the graph shows stops changing: the reading isn't busy. */
	atRest(): Promise<void>;
	/** The entries of the graph's reading. */
	reading(): Promise<TReadEntry[]>;
	/** How many frames the renderer has drawn since the page loaded. */
	framesDrawn(): Promise<number>;
	/** Wait `frames` animation frames, and return how many frames the renderer drew over them. */
	framesOver(frames: number): Promise<number>;
	/** Select a node the way the app relays a selection, and wait for the reading to state it active. */
	select(id: string): Promise<void>;
	/** Run against the scene itself. The function is serialised into the page, so it doesn't see a closure: what it needs
	 *  travels as `arg`. */
	scene<T, A = undefined>(fn: (scene: TSceneApi, arg: A) => T, arg?: A): Promise<T>;
	/** Where a node draws once the scene has rested and two frames draw it at the same pixel. */
	projection(id: string): Promise<TPixel>;
	/** The zoom at a node: how many pixels one world unit at the node spans on screen. A pan doesn't change it; a zoom does. */
	zoomAt(id: string): Promise<number>;
	/** Drag the pointer from `from` by `dx` pixels across, as a reader pans. */
	drag(from: TPixel, dx: number): Promise<void>;
	/** Turn the wheel at the middle of the view by `deltaY`, as a reader zooms: a value below zero brings the camera closer. */
	wheel(deltaY: number): Promise<void>;
	/** Click the real pointer at a pixel, and return the id of the node the scene opened, or null when it didn't open one.
	 *  The scene opens a node in the click's own task, so the id is set when the click dispatch returns. */
	click(at: TPixel): Promise<string | null>;
	/** The active-record machine's state in the page, as the bundle holds it. */
	subjectState(): Promise<TSubjectState>;
	/** A pixel inside the view, clear of every node the scene draws, for a press on empty space. `side` names where it lies. */
	emptyPixel(side: "left" | "right"): Promise<TPixel>;
	/** The calls the page made of its site, in order. */
	dispatched(): Promise<string[]>;
	box(): Promise<{ x: number; y: number; w: number; h: number }>;
	close(): Promise<void>;
};

/** How long the page has to mount its scene: its entry started, the bundle run and the first frame sized. */
const PAGE_OPEN_TIMEOUT_MS = 30_000;
/** How long a feed of a few hundred nodes has to lay out, and a scene to rest after a change, under a software rasterizer. */
const LAYOUT_TIMEOUT_MS = 45_000;
/** How far a pixel for a press on empty space keeps from every node it could pick. */
const CLEAR_OF_NODES_PX = 48;

/** The page as a test opens it: the page's entry started, the view mounted in a box of `box`, at `deviceScaleFactor`. */
export type TOpenedPage = { page: Page; errors(): string[]; close(): Promise<void> };

/** Opens the page with the view mounted, and waits for its scene to hold a camera and a sized canvas. */
export async function openPolymorphicPage(opts: { external: boolean; box: TBox; deviceScaleFactor: number }): Promise<TOpenedPage> {
	const html = pageWith(opts.external, opts.box);
	const bundle = readFileSync(BUNDLE_PATH, "utf-8"); // throws if not built: run `npm run bundle:polymorphic` first
	const started = await pageEntry();
	const opened = await openTestPage(
		(url, res) => {
			if (url === "/") res.writeHead(200, { "Content-Type": "text/html" }).end(html);
			else if (url === POLYMORPHIC_ROUTE.entry) res.writeHead(200, { "Content-Type": "application/javascript" }).end(started);
			else if (url === POLYMORPHIC_ROUTE.bundle) res.writeHead(200, { "Content-Type": "application/javascript" }).end(bundle);
			else if (url === LABEL_FONT) res.writeHead(200, { "Content-Type": "font/woff" }).end(Buffer.from(bundleFile().labelFont()));
			else if (url.startsWith(`${LABEL_FONT_FALLBACKS}/`)) {
				const response = labelFontResponse(bundleFile(), url.slice(LABEL_FONT_FALLBACKS.length + 1));
				if (response === undefined) return false;
				if ("json" in response) res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(response.json));
				else res.writeHead(200, { "Content-Type": "font/woff" }).end(Buffer.from(response.font));
			} else return false;
			return true;
		},
		{ viewport: { width: 1400, height: 900 }, deviceScaleFactor: opts.deviceScaleFactor, args: ["--enable-unsafe-swiftshader"] },
	);
	const { url, page, pageErrors, failures, close } = opened;
	try {
		await page.goto(url);
		await page.waitForFunction(
			() => {
				const fe = document.querySelector("shu-polymorphic-graph-view");
				const scene = fe?.querySelector("a-scene") as (HTMLElement & { camera?: unknown }) | null;
				const canvas = fe?.querySelector("canvas") as HTMLCanvasElement | null;
				return Boolean(scene?.camera && canvas && canvas.width > 0);
			},
			undefined,
			{ timeout: PAGE_OPEN_TIMEOUT_MS },
		);
	} catch (cause) {
		await close();
		throw new Error(
			`the polymorphic page at ${url} didn't mount a scene with a camera and a sized canvas within ${PAGE_OPEN_TIMEOUT_MS} ms (${errorDetail(cause)}). ${failures()} ` +
				"Fix the first error listed; where the lists are empty or hold only the stub's expected 404s, the page was short of CPU, so run the file alone to confirm.",
			{ cause },
		);
	}
	return { page, errors: () => pageErrors, close };
}

export async function mountPolymorphicPage({ external = false, box = BOX }: { external?: boolean; box?: TBox } = {}): Promise<TMountedPage> {
	const { page, errors, close } = await openPolymorphicPage({ external, box, deviceScaleFactor: 1 });

	const atRest = async (): Promise<void> => {
		await page.waitForFunction((at) => document.querySelector(`${at.view} ${at.reading}`)?.getAttribute("aria-busy") === "false", IN_PAGE, { timeout: LAYOUT_TIMEOUT_MS });
	};
	const draws = async (count: number): Promise<void> => {
		await page.waitForFunction(
			({ at, n }) => new RegExp(`\\b${n} nodes\\b`).test(document.querySelector(`${at.view} ${at.reading} [role="status"]`)?.textContent ?? ""),
			{ at: IN_PAGE, n: count },
			{ timeout: LAYOUT_TIMEOUT_MS },
		);
	};
	const reading = (): Promise<TReadEntry[]> => page.evaluate(readingIn, IN_PAGE);
	const framesDrawn = async (): Promise<number> => (await page.evaluate(`document.querySelector("a-scene").renderer.info.render.frame`)) as number;
	/** Where the named nodes draw, once two frames in a row draw each at the same pixel. */
	const steady = async (ids: readonly string[]): Promise<Record<string, TPixel>> => {
		await atRest();
		const held = await page.waitForFunction(steadyIn, { ids, at: IN_PAGE }, { polling: "raf", timeout: LAYOUT_TIMEOUT_MS });
		return (await held.jsonValue()) as Record<string, TPixel>;
	};
	const projection = async (id: string): Promise<TPixel> => {
		const drawn = (await steady([id]))[id];
		if (drawn === undefined) throw new Error(`node ${id} isn't among the nodes the library draws`);
		return drawn;
	};
	const click = async (at: TPixel): Promise<string | null> => {
		await page.evaluate((evt) => {
			const w = window as unknown as { opened: string | null };
			w.opened = null;
			document.addEventListener(
				evt,
				(e) => {
					const { pane } = (e as CustomEvent<TPaneOpen>).detail;
					w.opened = pane.paneType === "entity" ? pane.id : null;
				},
				{ once: true },
			);
		}, SHU_EVENT.PANE_OPEN);
		await page.mouse.click(at.x, at.y);
		return page.evaluate(() => (window as unknown as { opened: string | null }).opened);
	};
	const boxOf = () =>
		page.evaluate(() => {
			const r = (document.querySelector("#box") as HTMLElement).getBoundingClientRect();
			return { x: r.x, y: r.y, w: r.width, h: r.height };
		});

	return {
		page,
		errors,
		atRest,
		draws,
		reading,
		framesDrawn,
		async framesOver(frames) {
			const before = await framesDrawn();
			await page.evaluate(
				(n) =>
					new Promise<void>((done) => {
						let left = n;
						const wait = (): void => {
							if (--left > 0) requestAnimationFrame(wait);
							else done();
						};
						requestAnimationFrame(wait);
					}),
				frames,
			);
			return (await framesDrawn()) - before;
		},
		async feed(quads) {
			await page.evaluate(`(${sceneIn})(${JSON.stringify(IN_PAGE.view)}).setModel((${modelIn})(${JSON.stringify(quads)}))`);
			await draws(new Set(quads.map((q) => q.subject)).size);
			await atRest();
		},
		async select(id) {
			await page.evaluate(`(${sceneIn})(${JSON.stringify(IN_PAGE.view)}).setSelectedSubject(${JSON.stringify(id)})`);
			await page.waitForFunction(
				({ nid, at }) => document.querySelector(`${at.view} ${at.reading} [data-node-id="${nid}"]`)?.getAttribute("aria-current") === "true",
				{ nid: id, at: IN_PAGE },
				{ timeout: 10_000 },
			);
		},
		scene<T, A = undefined>(fn: (scene: TSceneApi, arg: A) => T, arg?: A): Promise<T> {
			return page.evaluate(`(${fn})((${sceneIn})(${JSON.stringify(IN_PAGE.view)}), ${JSON.stringify(arg ?? null)})`) as Promise<T>;
		},
		projection,
		async zoomAt(id) {
			const at = await projection(id);
			const zoom = await page.evaluate(
				({ nid, view }) => {
					type TVector = { x: number; y: number; project(camera: unknown): TVector };
					const host = document.querySelector(view);
					const scene = host?.querySelector("a-scene") as (Element & { camera: unknown }) | null;
					const engine = host?.querySelector("[forcegraph]") as Element & {
						components: { forcegraph: { forceGraph: { graphData(): { nodes: Array<{ id: string; x: number; y: number; z: number }> } } } };
					};
					const canvas = host?.querySelector("canvas");
					const n = engine.components.forcegraph.forceGraph.graphData().nodes.find((node) => node.id === nid);
					if (!scene || !canvas || n === undefined) return null;
					const THREE = (globalThis as unknown as { AFRAME: { THREE: { Vector3: new (x: number, y: number, z: number) => TVector } } }).AFRAME.THREE;
					const a = new THREE.Vector3(n.x, n.y, n.z).project(scene.camera);
					const b = new THREE.Vector3(n.x + 1, n.y, n.z).project(scene.camera);
					const shown = canvas.getBoundingClientRect();
					return Math.hypot(((b.x - a.x) / 2) * shown.width, ((b.y - a.y) / 2) * shown.height);
				},
				{ nid: id, view: IN_PAGE.view },
			);
			if (zoom === null) throw new Error(`node ${id} drew at (${at.x}, ${at.y}) but the library holds it without a camera or a canvas`);
			return zoom;
		},
		async drag(from, dx) {
			await page.mouse.move(from.x, from.y);
			await page.mouse.down();
			await page.mouse.move(from.x + dx, from.y, { steps: 12 });
			await page.mouse.up();
		},
		async wheel(deltaY) {
			const box = await boxOf();
			await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
			await page.mouse.wheel(0, deltaY);
		},
		click,
		subjectState: () =>
			page.evaluate((key) => {
				const signals = (globalThis as unknown as Record<string, Map<string, { signal: { get(): TSubjectState } }>>)[key];
				if (!signals) throw new Error(`the page doesn't hold shared signals at ${key}`);
				return signals.get("currentSubject")?.signal.get() as TSubjectState;
			}, SHARED_CELLS_KEY),
		async emptyPixel(side) {
			const drawn = Object.values(await steady((await reading()).map((entry) => entry.id)));
			const found = await page.evaluate(
				({ nodes, clearPx, side, view }) => {
					const box = (document.querySelector("#box") as HTMLElement).getBoundingClientRect();
					const columns = Array.from({ length: Math.floor(box.width / 24) }, (_, i) => box.left + 12 + i * 24);
					for (const x of side === "right" ? columns.reverse() : columns)
						for (let y = box.bottom - 12; y > box.top + box.height / 2; y -= 24) {
							const under = document.elementFromPoint(x, y);
							if (under?.tagName === "CANVAS" && under.closest(view) && nodes.every((p) => Math.hypot(p.x - x, p.y - y) > clearPx)) return { x, y };
						}
					return null;
				},
				{ nodes: drawn, clearPx: CLEAR_OF_NODES_PX, side, view: IN_PAGE.view },
			);
			if (found === null) throw new Error(`the view lacks a pixel on its ${side} clear of its ${drawn.length} nodes by ${CLEAR_OF_NODES_PX}px`);
			return found;
		},
		dispatched: () => page.evaluate((key) => (globalThis as unknown as Record<string, string[]>)[key] ?? [], DISPATCHED_KEY),
		box: boxOf,
		close,
	};
}
