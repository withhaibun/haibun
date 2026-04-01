/**
 * <shu-spinner> — reusable spinner with status text for async UI operations.
 * Pulses on each status update to show aliveness.
 *
 * Usage:
 *   const spinner = document.createElement("shu-spinner");
 *   spinner.status = "Loading model...";
 *   spinner.visible = true;
 */
export class ShuSpinner extends HTMLElement {
	private _status = "";
	private _visible = false;
	private _spinning = true;
	private _dot: HTMLElement | null = null;

	constructor() {
		super();
		this.attachShadow({ mode: "open" });
	}

	set status(text: string) {
		this._status = text;
		const el = this.shadowRoot?.querySelector(".spinner-status");
		if (el) el.textContent = text;
		this.pulse();
	}

	get status(): string {
		return this._status;
	}

	/** Flash the dot to signal activity. */
	pulse(): void {
		const dot =
			this._dot ??
			(this.shadowRoot?.querySelector(".spinner-dot") as HTMLElement | null);
		if (!dot) return;
		this._dot = dot;
		dot.classList.remove("pulse");
		// force reflow so re-adding the class restarts the animation
		void dot.offsetWidth;
		dot.classList.add("pulse");
	}

	set visible(show: boolean) {
		this._visible = show;
		if (this.shadowRoot) {
			const container = this.shadowRoot.querySelector(
				".spinner-container",
			) as HTMLElement | null;
			if (container) container.style.display = show ? "flex" : "none";
		}
	}

	get visible(): boolean {
		return this._visible;
	}

	set spinning(spin: boolean) {
		this._spinning = spin;
		const dot =
			this._dot ??
			(this.shadowRoot?.querySelector(".spinner-dot") as HTMLElement | null);
		if (dot) {
			this._dot = dot;
			dot.style.animation = spin ? "" : "none";
		}
	}

	get spinning(): boolean {
		return this._spinning;
	}

	connectedCallback(): void {
		if (this.hasAttribute("visible")) this._visible = true;
		if (this.hasAttribute("status"))
			this._status = this.getAttribute("status") || "";
		this.render();
	}

	private render(): void {
		if (!this.shadowRoot) return;
		this.shadowRoot.innerHTML = `
<style>
  :host { display: block; }
  .spinner-container { display: ${this._visible ? "flex" : "none"}; align-items: center; gap: 6px; padding: 2px 0; color: #666; font-style: italic; font-size: inherit; }
  .spinner-dot { width: 12px; height: 12px; border: 2px solid #ccc; border-top-color: #555; border-radius: 50%; animation: spin 0.8s linear infinite; flex-shrink: 0; }
  .spinner-dot.pulse { animation: spin 0.8s linear infinite, ping 0.4s ease-out; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes ping { 0% { box-shadow: 0 0 0 0 rgba(85,85,85,0.5); } 100% { box-shadow: 0 0 0 6px rgba(85,85,85,0); } }
  .spinner-status { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
<div class="spinner-container">
  <div class="spinner-dot"></div>
  <span class="spinner-status">${this._status}</span>
</div>`;
	}
}

// Registration moved to component-registry.ts
