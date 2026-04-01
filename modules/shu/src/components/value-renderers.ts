export interface ValueRenderer {
	detect(value: string): boolean;
	render(value: string): string;
}

const renderers: ValueRenderer[] = [];

export function registerValueRenderer(r: ValueRenderer): void {
	renderers.push(r);
}

export function renderValue(value: string): string | null {
	for (const r of renderers) {
		if (r.detect(value)) return r.render(value);
	}
	return null;
}
