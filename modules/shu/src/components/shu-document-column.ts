/**
 * <shu-document-column> — Academic paper-style document view.
 * Renders test execution events as prose headings, technical details, and embedded artifacts.
 * Uses render-once + append strategy: initial backfill renders the full document,
 * SSE events append new rows incrementally. Embedded components are never destroyed.
 */
import { z } from "zod";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { ShuElement, TIME_SYNC_CLASS } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import { SseClient, inAction } from "../sse-client.js";
import type { ShuTimeline } from "./shu-timeline.js";
import { buildArtifactIndex, generateDocumentMarkdown } from "@haibun/core/lib/document-content.js";
import "./shu-artifact-frame.js";
import type { THaibunEvent, TArtifactEvent, THaibunLogLevel } from "@haibun/core/schema/protocol.js";
import { esc } from "../util.js";
import { getVertexUi } from "../rels-cache.js";

const DocumentColumnSchema = z.object({
	level: z.enum(["debug", "trace", "info", "warn", "error"]).default("info"),
});

const mdRenderer = new MarkdownIt({ html: true, linkify: true, typographer: true });

const SANITIZE_OPTS = {
	ADD_ATTR: ["style", "data-depth", "data-nested", "data-instigator", "data-show-symbol", "data-id", "data-time", "data-raw-time", "data-action", "data-has-artifacts", "data-ids"],
	ADD_TAGS: ["div"],
};

export class ShuDocumentColumn extends ShuElement<typeof DocumentColumnSchema> {
	private events: THaibunEvent[] = [];
	private seenEventIds = new Set<string>();
	private unsubscribe?: () => void;
	private startTime = 0;
	private endTime = 0;
	private renderedEventCount = 0;
	private appendTimer = 0;

	constructor() {
		super(DocumentColumnSchema, { level: "info" });
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		const client = SseClient.for("");
		try {
			const data = await inAction((scope) => client.rpc<{ events: Array<Record<string, unknown>> }>(scope, "MonitorStepper-getEvents", { filter: {} }));
			if (data.events) {
				for (const e of data.events) this.addEvent(e);
				this.renderFull();
			}
		} catch {
			// load failure isn't fatal — column keeps current rows; next refresh retries.
		}

		if (this.hasAttribute("data-snapshot-time")) return;

		this.unsubscribe = client.onEvent((event) => {
			this.addEvent(event as Record<string, unknown>);
			if (!this.appendTimer) {
				this.appendTimer = window.setTimeout(() => {
					this.appendTimer = 0;
					this.appendNew();
				}, 500);
			}
		});
	}

	protected override onTimeSync(): void {
		this.applyTimeCursor();
	}

	disconnectedCallback(): void {
		this.unsubscribe?.();
	}

	private addEvent(e: Record<string, unknown>): void {
		const eventKey = `${e.id}:${e.stage || e.kind}`;
		if (this.seenEventIds.has(eventKey)) return;
		this.seenEventIds.add(eventKey);
		const ev = e as THaibunEvent;
		this.events.push(ev);
		const ts = ev.timestamp;
		if (ts) {
			if (!this.startTime || ts < this.startTime) this.startTime = ts;
			if (ts > this.endTime) this.endTime = ts;
		}
	}

	/** Full render from all events — called once on initial backfill. */
	private renderFull(): void {
		if (!this.shadowRoot) return;
		const body = this.shadowRoot.querySelector(".document-body");
		if (!body) return;
		const html = this.generateHtml(this.events);
		body.innerHTML = html;
		this.postProcessElements(body);
		this.renderedEventCount = this.events.length;
		this.updateTimeline();
	}

	/** Append only new events since last render — never touches existing DOM. */
	private appendNew(): void {
		if (!this.shadowRoot) return;
		const body = this.shadowRoot.querySelector(".document-body");
		if (!body) return;
		if (this.renderedEventCount >= this.events.length) return;
		const newEvents = this.events.slice(this.renderedEventCount);
		const html = this.generateHtml(newEvents);
		if (!html.trim()) {
			this.renderedEventCount = this.events.length;
			return;
		}
		const fragment = document.createElement("div");
		fragment.innerHTML = html;
		this.postProcessElements(fragment);
		while (fragment.firstChild) body.appendChild(fragment.firstChild);
		this.renderedEventCount = this.events.length;
		this.updateTimeline();
		if (this.timeCursor === null) this.scrollTop = this.scrollHeight;
	}

	/** Generate sanitized HTML from a set of events. */
	private generateHtml(events: THaibunEvent[]): string {
		const { artifactsByStep } = buildArtifactIndex(events);
		const { md: rawMd } = generateDocumentMarkdown(events, artifactsByStep, this.state.level as THaibunLogLevel);
		const rawHtml = mdRenderer.render(rawMd);
		return DOMPurify.sanitize(rawHtml, SANITIZE_OPTS);
	}

	private updateTimeline(): void {
		const timeline = this.shadowRoot?.querySelector("shu-timeline") as ShuTimeline | null;
		if (timeline && this.startTime && this.endTime) {
			timeline.setBounds(this.startTime, this.endTime);
			if (this.timeCursor === null) timeline.seek(this.endTime - this.startTime);
		}
	}

	private applyTimeCursor(): void {
		const body = this.shadowRoot?.querySelector(".document-body");
		if (!body) return;
		const rows = Array.from(body.querySelectorAll(".doc-row")) as HTMLElement[];
		let currentRow: HTMLElement | null = null;
		for (const row of rows) {
			row.classList.remove(TIME_SYNC_CLASS.FUTURE, TIME_SYNC_CLASS.CURRENT);
			if (this.timeCursor === null) continue;
			const rawTime = parseFloat(row.getAttribute("data-raw-time") || "0");
			const absTime = this.startTime + rawTime;
			if (absTime > this.timeCursor) {
				row.classList.add(TIME_SYNC_CLASS.FUTURE);
			} else {
				currentRow = row;
			}
		}
		if (currentRow && this.timeCursor !== null) {
			currentRow.classList.add(TIME_SYNC_CLASS.CURRENT);
			const rowTop = (currentRow as HTMLElement).offsetTop;
			this.scrollTo({ top: rowTop - this.clientHeight / 2, behavior: "smooth" });
		}
	}

	/** Build a map of step ID → products from lifecycle end events, only for steps after show document. */
	private getProductsByStepId(events: THaibunEvent[]): Map<string, Record<string, unknown>> {
		// Find when "show document" was executed — only embed views from after that point
		let documentShowTime = 0;
		for (const e of events) {
			if (e.kind !== "lifecycle") continue;
			const products = (e as Record<string, unknown>).products as Record<string, unknown> | undefined;
			if (products?._component === "shu-document-column") {
				documentShowTime = e.timestamp;
				break;
			}
		}
		const map = new Map<string, Record<string, unknown>>();
		for (const e of events) {
			if (e.kind !== "lifecycle" || (e as Record<string, unknown>).stage !== "end") continue;
			if (documentShowTime && e.timestamp < documentShowTime) continue;
			const products = (e as Record<string, unknown>).products as Record<string, unknown> | undefined;
			if (!products || (!products._component && !products._type)) continue;
			const typeStr = products._type as string | undefined;
			if (typeStr) {
				const ui = getVertexUi(typeStr);
				if (ui?.pinnedOnly) continue;
			}
			// Don't embed the document view itself
			if (products._component === "shu-document-column") continue;
			const nid = e.id.replace(/^\[|\]$/g, "");
			map.set(nid, products);
		}
		return map;
	}

	private embedProductView(row: HTMLElement, products: Record<string, unknown>): void {
		const rawTime = parseFloat(row.getAttribute("data-raw-time") || "0");
		const snapshotTime = this.startTime + rawTime;
		const frame = document.createElement("shu-artifact-frame") as HTMLElement;
		frame.setAttribute("caption", String(products._summary ?? products._type ?? ""));
		const productView = document.createElement("shu-product-view") as HTMLElement & { openProducts: (p: Record<string, unknown>, t?: number) => void };
		if (this.showControls) productView.setAttribute("data-show-controls", "");
		productView.style.maxHeight = "400px";
		productView.style.overflow = "auto";
		frame.appendChild(productView);
		requestAnimationFrame(() => productView.openProducts(products, snapshotTime));
		row.after(frame);
	}

	/** Post-process a container's elements: add classes, click handlers, embed products. */
	private postProcessElements(container: Element): void {
		const els = (sel: string) => Array.from(container.querySelectorAll(sel)) as HTMLElement[];
		const productMap = this.getProductsByStepId(this.events);
		const addRowClick = (el: HTMLElement) => {
			el.addEventListener("click", () => {
				const rawTime = parseFloat(el.getAttribute("data-raw-time") || "0");
				const absTime = this.startTime + rawTime;
				this.timeCursor = absTime;
				const timeline = this.shadowRoot?.querySelector("shu-timeline") as ShuTimeline | null;
				if (timeline) timeline.seek(rawTime);
				this.dispatchEvent(new CustomEvent(SHU_EVENT.TIME_SYNC, { detail: { currentTime: absTime }, bubbles: true, composed: true }));
				this.applyTimeCursor();
			});
		};
		els(".header-block").forEach((el) => {
			el.classList.add("doc-row");
			addRowClick(el);
		});
		els(".prose-block").forEach((el) => {
			el.classList.add("doc-row");
			addRowClick(el);
		});
		els(".log-row").forEach((el) => {
			const depth = parseInt(el.getAttribute("data-depth") || "0");
			el.classList.add("doc-row");
			if (depth > 3) el.style.paddingLeft = `${(depth - 3) * 12}px`;
			if (el.getAttribute("data-nested") === "true") el.classList.add("nested");
			if (el.getAttribute("data-show-symbol") === "true") el.classList.add("show-connector");
			addRowClick(el);
		});
		els(".feature-artifacts").forEach((el) => {
			const ids = el.getAttribute("data-ids")?.split(",") || [];
			el.innerHTML = ids
				.map((id: string) => {
					const artifact = this.events.find((e) => e.id === id) as TArtifactEvent | undefined;
					return artifact ? this.renderArtifact(artifact) : "";
				})
				.join("");
		});
		els(".standalone-artifact").forEach((el) => {
			const id = el.getAttribute("data-id");
			const artifact = this.events.find((e) => e.id === id) as TArtifactEvent | undefined;
			if (artifact) el.innerHTML = this.renderArtifact(artifact);
		});
		els("[data-id]").forEach((el) => {
			const id = el.getAttribute("data-id");
			if (!id) return;
			const products = productMap.get(id);
			if (products) this.embedProductView(el, products);
		});
	}

	private renderArtifact(artifact: TArtifactEvent): string {
		const type = artifact.artifactType;
		const a = artifact as Record<string, unknown>;
		const artifactPath = a.url ?? (a.path ? `/artifacts/${String(a.path).replace(/^\.?\//, "")}` : undefined);
		if (type === "image" && artifactPath) {
			return `<shu-artifact-frame caption="${esc(String(a.path ?? a.url ?? "Screenshot"))}"><img src="${esc(String(artifactPath))}" loading="lazy" /></shu-artifact-frame>`;
		}
		if (type === "html" && artifactPath)
			return `<shu-artifact-frame caption="${esc(String(a.path ?? "HTML"))}"><iframe src="${esc(String(artifactPath))}" sandbox="allow-scripts allow-same-origin" style="width:100%;min-height:80vh;border:none;"></iframe></shu-artifact-frame>`;
		if (type === "json" && a.json) return `<shu-artifact-frame caption="JSON"><pre class="json-block">${esc(JSON.stringify(a.json, null, 2))}</pre></shu-artifact-frame>`;
		if (type === "file" && a.path) return `<shu-artifact-frame caption="${esc(String(a.path))}"><a href="${esc(String(a.path))}">${esc(String(a.path))}</a></shu-artifact-frame>`;
		return "";
	}

	override refresh(): void {
		const body = this.shadowRoot?.querySelector(".document-body");
		if (!body) return;
		// Product views are slotted inside shu-artifact-frame — querySelectorAll reaches light DOM children
		for (const v of Array.from(body.querySelectorAll("shu-artifact-frame shu-product-view")) as (HTMLElement & { refresh?: () => void })[]) {
			if (this.showControls) v.setAttribute("data-show-controls", "");
			else v.removeAttribute("data-show-controls");
			v.refresh?.();
		}
	}

	protected render(): void {
		if (!this.shadowRoot) return;
		this.shadowRoot.innerHTML = `${this.css(STYLES)}<div class="document-body"></div>`;
		if (this.events.length > 0) this.renderFull();
	}
}

const STYLES = `
:host { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: auto; font-family: "Source Serif 4", Georgia, serif; font-size: 15px; line-height: 1.7; color: #1a1a2e; }
.document-body { width: 80%; margin: 0 auto; padding: 2rem 1.5rem; min-width: 0; }
@media (max-width: 600px) { .document-body { width: 100%; } }
h1 { font-size: 1.75rem; font-weight: 700; margin: 1.5rem 0 1rem; padding-bottom: 0.5rem; border-bottom: 2px solid #e2e8f0; }
h2 { font-size: 1.35rem; font-weight: 600; margin: 1.25rem 0 0.75rem; color: #334155; }
h3 { font-size: 1.1rem; font-weight: 600; margin: 1rem 0 0.5rem; color: #475569; }
p { margin: 0.5em 0; }
a { color: #2563eb; text-decoration: none; }
a:hover { text-decoration: underline; }
.doc-row { padding: 3px 8px; border-radius: 3px; cursor: pointer; transition: background 0.15s; }
.doc-row:hover { background: #f1f5f9; }
.log-row { font-family: "Source Code Pro", ui-monospace, monospace; font-size: 11px; color: #64748b; line-height: 1.5; border-left: 2px solid transparent; padding: 4px 0; margin-left: 32px; }
.log-row.nested { border-left-color: #e2e8f0; margin-left: 48px; }
.log-row.show-connector { position: relative; }
.log-row.show-connector::before { content: ""; position: absolute; left: -1px; top: 0; width: 8px; height: 1px; background: #e2e8f0; }
.h-1 { height: 12px; }
.prose-block { font-size: 15px; }
.header-block { margin-top: 0.5rem; }
.artifact { margin: 8px 0 8px 32px; }
.json-block { font-family: "Source Code Pro", monospace; font-size: 11px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px 12px; overflow-x: auto; white-space: pre-wrap; max-height: 300px; overflow-y: auto; }
img { display: block; }
shu-artifact-frame { margin: 12px 0; }
`;
