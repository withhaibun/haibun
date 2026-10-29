/** Minimal ambient types for the slice of troika-three-text the polymorphic view uses (the package doesn't ship a .d.ts). Text is a
 *  THREE.Mesh subclass; only the properties this view sets/reads are declared, structurally (without a dependency on three's types). */
declare module "troika-three-text" {
	/** Sets what every Text builds with: `defaultFontURL` is the font a Text reads where it doesn't name its own, and `unicodeFontsURL`
	 *  is where it looks up a font for a character that font lacks. */
	export function configureTextBuilder(config: { defaultFontURL?: string; unicodeFontsURL?: string }): void;
	export class Text {
		text: string;
		fontSize: number;
		color: string | number;
		anchorX: "center" | "left" | "right" | number | string;
		anchorY: "middle" | "top" | "bottom" | number | string;
		outlineWidth: number | string;
		outlineColor: string | number;
		fillOpacity: number;
		outlineOpacity: number;
		renderOrder: number;
		material: unknown;
		scale: { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
		position: { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
		quaternion: { copy(q: unknown): void };
		/** The laid-out text's bounds, once a sync has measured it. */
		textRenderInfo?: { blockBounds: [number, number, number, number] };
		/** A label isn't a pick target, so its raycast is replaced with one that doesn't hit. */
		raycast: () => void;
		sync(callback?: () => void): void;
		dispose(): void;
	}
}

/** troika's parser of a font file, as its worker loads it: the fonts a file holds, and the glyph each code point draws as. */
declare module "troika-three-text/libs/typr.factory.js" {
	const typrFactory: () => { parse(otf: ArrayBuffer): unknown[]; U: { codeToGlyph(font: unknown, point: number): number } };
	export default typrFactory;
}

/** troika's conversion of a WOFF file to the OpenType its parser reads. */
declare module "troika-three-text/libs/woff2otf.factory.js" {
	const woff2otfFactory: () => (woff: ArrayBuffer) => ArrayBuffer;
	export default woff2otfFactory;
}
