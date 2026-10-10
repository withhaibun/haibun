/** Mounts the site's graph presenter as a light-DOM child of the view that embeds it. */
import type { TGraphPresenter, TPresenterMount } from "../ports.js";

/** Returns the presenter mount of `doc`. */
export function browserPresenterMount(doc: Document): TPresenterMount {
	const presenterIn = (host: HTMLElement, slot: string): TGraphPresenter | undefined => {
		const held = host.querySelector<TGraphPresenter>(`:scope > [slot="${slot}"]`);
		return held === null ? undefined : held;
	};
	return {
		presenterIn,
		mount: (host, slot, tag, scope) => {
			const presenter = doc.createElement(tag) as TGraphPresenter;
			presenter.slot = slot;
			presenter.setAttribute("data-external", "");
			presenter.dataset.persistScope = scope;
			host.appendChild(presenter);
			return presenter;
		},
	};
}
