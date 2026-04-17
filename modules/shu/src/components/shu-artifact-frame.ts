/**
 * <shu-artifact-frame> — Displays an artifact with caption bar and fullscreen toggle.
 * Uses a slot for content — wrap any artifact (img, iframe, pre, shu-product-view) inside.
 * Attributes: caption (display text).
 */
const STYLES = `
:host { display: block; margin: 16px 0 16px 32px; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }
:host(.fullscreen) { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 100; margin: 0; border-radius: 0; background: #fff; display: flex; flex-direction: column; }
.caption { display: flex; align-items: center; justify-content: space-between; font-family: "Source Code Pro", monospace; font-size: 11px; color: #64748b; padding: 4px 12px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
.fullscreen-btn { background: none; border: none; cursor: pointer; font-size: 14px; color: #94a3b8; padding: 0 4px; }
.fullscreen-btn:hover { color: #1a6b3c; }
.content { overflow: auto; }
:host(.fullscreen) .content { flex: 1; min-height: 0; }
::slotted(img) { display: block; max-width: 100%; }
:host(.fullscreen) ::slotted(img) { object-fit: contain; height: 100%; }
::slotted(iframe) { width: 100%; min-height: 200px; border: none; }
::slotted(pre) { margin: 0; padding: 8px 12px; overflow-x: auto; }
`;

export class ShuArtifactFrame extends HTMLElement {
	private shadow: ShadowRoot;

	constructor() {
		super();
		this.shadow = this.attachShadow({ mode: "open" });
	}

	connectedCallback(): void {
		const caption = this.getAttribute("caption") ?? "";
		this.shadow.innerHTML = `<style>${STYLES}</style>
			<div class="caption"><span>${caption}</span><button class="fullscreen-btn">\u2922</button></div>
			<div class="content"><slot></slot></div>`;
		this.shadow.querySelector(".fullscreen-btn")?.addEventListener("click", () => {
			this.classList.toggle("fullscreen");
			const btn = this.shadow.querySelector(".fullscreen-btn");
			if (btn) btn.textContent = this.classList.contains("fullscreen") ? "\u2923" : "\u2922";
		});
	}
}

if (!customElements.get("shu-artifact-frame")) customElements.define("shu-artifact-frame", ShuArtifactFrame);
