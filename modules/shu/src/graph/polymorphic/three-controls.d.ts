// super-three ships no .d.ts for its addon entry points; declare the minimal surface this view drives.
declare module "three/examples/jsm/controls/OrbitControls.js" {
	export class OrbitControls {
		constructor(object: unknown, domElement?: HTMLElement);
		enabled: boolean;
		enableDamping: boolean;
		dampingFactor: number;
		screenSpacePanning: boolean;
		mouseButtons: { LEFT: number; MIDDLE: number; RIGHT: number };
		target: { set(x: number, y: number, z: number): void };
		object: { position: { set(x: number, y: number, z: number): void } };
		update(): boolean;
		dispose(): void;
	}
}
