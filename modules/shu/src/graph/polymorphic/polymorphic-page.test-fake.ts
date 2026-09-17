import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { GRAPH_SCENE_EVENT } from "./polymorphic-graph-types.js";
import { SHARED_SIGNALS_KEY } from "../../signals.js";
import type { TSubjectState } from "../../current-subject.js";

/**
 * A real page with the polymorphic graph view mounted on it, drawn by a headless browser through a software
 * rasterizer. Every browser test of the scene needs the same page: the bundle served, the view mounted at a known
 * size, a model fed the way the app feeds one, the layout waited to rest, and a node's projection read once it has
 * stopped moving. Held here once, so a test states only what it does to the scene and what it expects of it.
 */

const BUNDLE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "build", "assets", "shu-polymorphic-graph-view.js");

/** The view's box on the page: fixed, so a test that resizes it knows what it started from. */
export const BOX = { width: 1000, height: 700 };

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><script src="/bundle.js"></script></head>
<body style="margin:0">
	<div id="box" style="position:fixed;left:0;top:0;width:${BOX.width}px;height:${BOX.height}px;">
		<shu-polymorphic-graph-view style="display:block;width:100%;height:100%"></shu-polymorphic-graph-view>
	</div>
</body></html>`;

export type TQuadFed = { subject: string; namedGraph: string; predicate: string; object: string; timestamp: number };
/** One property quad per named node, as a snapshot holds them, so every node is built the way the app builds one. */
export const quadsNamed = (ids: readonly string[]): TQuadFed[] => ids.map((id) => ({ subject: id, namedGraph: "Email", predicate: "name", object: id, timestamp: 0 }));

export type TCamera = { fov: number | null; x: number; y: number; z: number; target: { x: number; y: number; z: number } };
/** The scene as a test drives it: the moves a reader can make, and what it reports of itself. */
export type TSceneApi = {
	setConfig(patch: Record<string, unknown>): void;
	setSelectedSubject(id: string | null): void;
	fitGraph(): void;
	panBy(amount: number, unit: "pixels" | "percent", dir: "left" | "right" | "up" | "down"): void;
	zoomBy(amount: number, unit: "pixels" | "percent", dir: "in" | "out"): void;
	inspect(): { camera: TCamera | null };
};
type TInspected = {
	nodes: number;
	engineMode: string;
	tween: unknown;
	repaintPending: boolean;
	followPending: boolean;
	highlighted: number;
	camera: TCamera | null;
	render: { ticks: number; paused: boolean };
};

const VIEW = `document.querySelector("shu-polymorphic-graph-view")`;

export type TMountedPage = {
	page: Page;
	/** Page errors other than the one the raw bundle reports for having no app around it. */
	errors(): string[];
	/** Feed a model as the view does, and wait for every node of it to be laid out and the engine to rest. */
	feed(quads: TQuadFed[]): Promise<void>;
	/** Wait for the layout and the camera to rest: nothing running, nothing owed, and following has checked the view. */
	settle(): Promise<void>;
	/** Select a node the way the app relays a selection, and wait for its glow. */
	select(id: string): Promise<void>;
	/** Run against the scene itself. The function is serialised into the page, so it sees no closure: what it needs
	 *  travels as `arg`. */
	scene<T, A = undefined>(fn: (scene: TSceneApi, arg: A) => T, arg?: A): Promise<T>;
	inspect(): Promise<TInspected>;
	/** Where a node draws once the camera has stopped moving it: read until two reads agree to a pixel, and the canvas
	 *  draws at the size it shows at, since the renderer takes a new size a frame before the canvas's own box does, and
	 *  a read between the two maps the node onto a box that is no longer there. */
	projection(id: string): Promise<{ x: number; y: number }>;
	/** The camera's distance to what it looks at: the zoom, as the reader set it. */
	distance(): Promise<number>;
	/** Click the real pointer at a pixel, and return the id of the node the scene opened, or null when it opened none.
	 *  The scene opens a node in the click's own task, so the id is set when the click dispatch returns. */
	click(at: { x: number; y: number }): Promise<string | null>;
	/** The active-record machine's state in the page, as the bundle holds it. */
	subjectState(): Promise<TSubjectState>;
	/** A pixel inside the view where no node is picked, for a click on empty space. */
	emptyPixel(): Promise<{ x: number; y: number }>;
	box(): Promise<{ x: number; y: number; w: number; h: number }>;
	close(): Promise<void>;
};

export async function mountPolymorphicPage(): Promise<TMountedPage> {
	const bundle = readFileSync(BUNDLE_PATH, "utf-8"); // throws if not built: run `npm run bundle:polymorphic` first
	const server: Server = createServer((req, res) => {
		if (req.url === "/") res.writeHead(200, { "Content-Type": "text/html" }).end(PAGE);
		else if (req.url === "/bundle.js") res.writeHead(200, { "Content-Type": "application/javascript" }).end(bundle);
		else res.writeHead(404).end();
	});
	await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
	const browser: Browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
	const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
	const pageErrors: string[] = [];
	page.on("pageerror", (e) => pageErrors.push(e.message));
	await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
	await page.waitForFunction(
		() => {
			const fe = document.querySelector("shu-polymorphic-graph-view");
			const scene = fe?.querySelector("a-scene") as (HTMLElement & { camera?: unknown }) | null;
			const canvas = fe?.querySelector("canvas") as HTMLCanvasElement | null;
			return Boolean(scene?.camera && canvas && canvas.width > 0);
		},
		undefined,
		{ timeout: 30_000 },
	);

	const inspect = async (): Promise<TInspected> => (await page.evaluate(`${VIEW}.inspect()`)) as TInspected;
	const settle = async (): Promise<void> => {
		await page.waitForFunction(
			() => {
				const i = (
					document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { engineMode: string; tween: unknown; repaintPending: boolean; followPending: boolean } }
				).inspect();
				return i.engineMode === "frozen" && i.tween === null && !i.repaintPending && !i.followPending;
			},
			undefined,
			{ timeout: 45_000 },
		);
	};

	return {
		page,
		errors: () => pageErrors.filter((m) => !m.includes("no EventStream installed")),
		async feed(quads) {
			await page.evaluate((fed) => {
				const el = document.querySelector("shu-polymorphic-graph-view") as unknown as { scene: { setModel(model: unknown): void } };
				el.scene.setModel({ quads: fed, visibleQuads: fed, clusters: [], knownClusters: new Map(), hiddenGraphs: [], hiddenPredicates: [], perTypeLimit: 1000, timeCursor: null });
			}, quads);
			const count = new Set(quads.map((q) => q.subject)).size;
			await page.waitForFunction((n) => (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { nodes: number } }).inspect().nodes === n, count, {
				timeout: 45_000,
			});
			await settle();
		},
		settle,
		async select(id) {
			await page.evaluate(
				(nid) => (document.querySelector("shu-polymorphic-graph-view") as unknown as { scene: { setSelectedSubject(s: string): void } }).scene.setSelectedSubject(nid),
				id,
			);
			await page.waitForFunction(
				() => (document.querySelector("shu-polymorphic-graph-view") as unknown as { inspect(): { highlighted: number } }).inspect().highlighted === 1,
				undefined,
				{ timeout: 10_000 },
			);
		},
		scene<T, A = undefined>(fn: (scene: TSceneApi, arg: A) => T, arg?: A): Promise<T> {
			return page.evaluate(`(${fn.toString()})(${VIEW}.scene, ${JSON.stringify(arg ?? null)})`) as Promise<T>;
		},
		inspect,
		async projection(id) {
			await settle();
			let previous: { x: number; y: number } | null = null;
			for (let i = 0; i < 60; i++) {
				const read = (await page.evaluate((nid) => {
					const view = document.querySelector("shu-polymorphic-graph-view") as unknown as { projectNodeToScreen(n: string): { x: number; y: number } | null };
					const canvas = document.querySelector("shu-polymorphic-graph-view canvas") as HTMLCanvasElement | null;
					const shown = canvas?.getBoundingClientRect();
					const dpr = window.devicePixelRatio || 1;
					const sized = !!canvas && !!shown && Math.abs(canvas.width / dpr - shown.width) < 1 && Math.abs(canvas.height / dpr - shown.height) < 1;
					return { at: view.projectNodeToScreen(nid), sized };
				}, id)) as { at: { x: number; y: number } | null; sized: boolean };
				const at = read.sized ? read.at : null;
				if (at && previous && Math.abs(at.x - previous.x) < 1 && Math.abs(at.y - previous.y) < 1) return at;
				previous = at;
				await page.waitForTimeout(40);
			}
			if (!previous) throw new Error(`node ${id} never projected onto the canvas`);
			return previous;
		},
		async distance() {
			const c = (await inspect()).camera;
			if (!c) throw new Error("the scene has no camera to measure");
			return Math.hypot(c.x - c.target.x, c.y - c.target.y, c.z - c.target.z);
		},
		async click(at) {
			await page.evaluate((evt) => {
				const w = window as unknown as { __opened: string | null };
				w.__opened = null;
				document.addEventListener(evt, (e) => (w.__opened = (e as CustomEvent<{ subject: string }>).detail.subject), { once: true });
			}, GRAPH_SCENE_EVENT.NODE_CLICK);
			await page.mouse.click(at.x, at.y);
			return page.evaluate(() => (window as unknown as { __opened: string | null }).__opened);
		},
		subjectState: () =>
			page.evaluate(
				(key) => (globalThis as unknown as Record<string, Map<string, { signal: { get(): TSubjectState } }>>)[key].get("currentSubject")?.signal.get() as TSubjectState,
				SHARED_SIGNALS_KEY,
			),
		async emptyPixel() {
			const found = await page.evaluate(() => {
				const view = document.querySelector("shu-polymorphic-graph-view") as unknown as { pickAt(x: number, y: number): string | null } & HTMLElement;
				const box = view.getBoundingClientRect();
				for (let y = box.bottom - 12; y > box.top; y -= 24) {
					for (let x = box.left + 12; x < box.right; x += 24) {
						if (view.pickAt(x, y) === null && document.elementFromPoint(x, y)?.closest("shu-polymorphic-graph-view")) return { x, y };
					}
				}
				return null;
			});
			if (!found) throw new Error("the view has no empty pixel to click");
			return found;
		},
		box: () =>
			page.evaluate(() => {
				const r = (document.querySelector("#box") as HTMLElement).getBoundingClientRect();
				return { x: r.x, y: r.y, w: r.width, h: r.height };
			}),
		async close() {
			await browser.close();
			await new Promise<void>((res) => server.close(() => res()));
		},
	};
}
