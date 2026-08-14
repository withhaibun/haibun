/** Minimal ambient types for the slice of troika-three-text the polymorphic view uses (the package ships no .d.ts). Text is a
 *  THREE.Mesh subclass; only the properties this view sets/reads are declared, structurally (no dependency on three's types). */
declare module "troika-three-text" {
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
		sync(callback?: () => void): void;
		dispose(): void;
	}
}
