/** UI-state preservation across innerHTML rebuilds. Components wrap render with snapshotUiState/restoreUiState; details are matched by data-key, focus by data-testid/data-key. */

export type TUiStateSnapshot = {
	openDetailsKeys: Set<string>;
	focusedKey: string | null;
	scrollTop: number;
};

/** Capture user-visible UI state from `host`'s shadowRoot + its scrolling parent. */
export function snapshotUiState(host: HTMLElement): TUiStateSnapshot {
	const openDetailsKeys = new Set<string>();
	const root = host.shadowRoot;
	if (root) {
		for (const d of Array.from(root.querySelectorAll<HTMLDetailsElement>("details[data-key]"))) {
			if (d.open) openDetailsKeys.add(d.dataset.key ?? "");
		}
	}
	const activeElement = root?.activeElement as HTMLElement | null;
	const focusedKey = activeElement?.dataset.testid ?? activeElement?.dataset.key ?? null;
	const scrollHost = (host.parentElement as HTMLElement | null) ?? null;
	const scrollTop = scrollHost?.scrollTop ?? 0;
	return { openDetailsKeys, focusedKey, scrollTop };
}

/** Re-apply a snapshot to `host`'s freshly-rebuilt DOM. Safe no-op when fields are empty. */
export function restoreUiState(host: HTMLElement, snapshot: TUiStateSnapshot): void {
	const root = host.shadowRoot;
	if (!root) return;
	for (const d of Array.from(root.querySelectorAll<HTMLDetailsElement>("details[data-key]"))) {
		if (snapshot.openDetailsKeys.has(d.dataset.key ?? "")) d.open = true;
	}
	if (snapshot.focusedKey) {
		const escaped = snapshot.focusedKey.replace(/"/g, "");
		const next = root.querySelector<HTMLElement>(`[data-testid="${escaped}"], [data-key="${escaped}"]`);
		next?.focus({ preventScroll: true });
	}
	const scrollHost = (host.parentElement as HTMLElement | null) ?? null;
	if (scrollHost) scrollHost.scrollTop = snapshot.scrollTop;
}
