// d3-force-3d ships no .d.ts; declare the minimal surface these layout modules drive.
declare module "d3-force-3d" {
	type CollideForce = { radius(r: (node: unknown) => number): CollideForce; strength(s: number): CollideForce };
	export function forceCollide(radius?: number): CollideForce;
	// Per-axis positioning forces pull each node toward a target coordinate, used to anchor a group's members so
	// the group settles into its own region. Accessor and strength each take a constant or a per-node function.
	type Accessor = (node: unknown) => number;
	type AxisForce<K extends string> = { [P in K]: (a: Accessor | number) => AxisForce<K> } & { strength(s: Accessor | number): AxisForce<K> };
	export function forceX(x?: Accessor | number): AxisForce<"x">;
	export function forceY(y?: Accessor | number): AxisForce<"y">;
	export function forceZ(z?: Accessor | number): AxisForce<"z">;
	// The simulation and the three forces it starts with: a spring along each link, repulsion between nodes, and a pull
	// toward the centre. The scene runs this itself, so every view's positions are computed before anything displays them.
	type LinkForce = { id(fn: (node: never) => string): LinkForce; links(links: unknown[]): LinkForce; strength(s?: unknown): unknown; distance(d: unknown): LinkForce };
	type BodyForce = { strength(s?: unknown): unknown };
	export function forceLink(links?: unknown[]): LinkForce;
	export function forceManyBody(): BodyForce;
	export function forceCenter(x?: number, y?: number, z?: number): unknown;
	export type Simulation = {
		numDimensions(n: number): Simulation;
		alphaDecay(d: number): Simulation;
		velocityDecay(d: number): Simulation;
		nodes(nodes?: unknown[]): Simulation;
		/** Register a force under a name, or read the one registered. Returns the simulation so calls chain, which is how
		 *  the library is used and what a caller building a simulation writes. */
		/** Register a force under a name, or read the one registered. Registering returns the simulation so calls chain;
		 *  reading returns whatever was registered, which the caller knows the shape of. */
		force(name: string, force: unknown): Simulation;
		force(name: string): unknown;
		alpha(a: number): Simulation;
		tick(n?: number): Simulation;
		stop(): Simulation;
		restart(): Simulation;
	};
	export function forceSimulation(nodes?: unknown[]): Simulation;
}
