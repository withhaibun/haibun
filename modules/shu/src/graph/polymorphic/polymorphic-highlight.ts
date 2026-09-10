/**
 * The active node's highlight: a soft glow behind the mark.
 *
 * One mechanism for every kind of mark: chip, sprite, and the marks whose own border is part of their texture and so
 * cannot be recoloured. A glow is a billboarded sprite carrying a radial-alpha texture, added as a child of the mark's
 * own object, so it sits behind the mark, follows it as the layout moves, and grows with it when the focus magnifier
 * scales it.
 *
 * The texture is shared: one canvas, built once, tinted per node through the material's colour. Blending is normal,
 * not additive — an additive glow disappears against the light theme's background.
 */
type GlowObj = {
	position: { set(x: number, y: number, z: number): void };
	scale: { x: number; y: number; set(x: number, y: number, z: number): void };
	renderOrder: number;
	material: { opacity: number; transparent: boolean; color?: { set(css: string): void } };
	visible: boolean;
};

/** The slice of the scene's THREE a glow needs — passed in, never separately imported. */
export type GlowThree = {
	Sprite: new (material: unknown) => GlowObj;
	SpriteMaterial: new (params: Record<string, unknown>) => unknown;
	CanvasTexture: new (canvas: HTMLCanvasElement) => unknown;
};

/** How far the glow reaches past the mark, as a fraction of the mark's own size. */
export const GLOW_SPREAD = 1.0;
const TEXTURE_PX = 128;
/** Alpha at the centre; it falls to nothing at the edge, so the glow has no boundary of its own. */
const GLOW_ALPHA = 0.85;

/** The breath: one glow cycle, and how far it dips and swells over it. A steady blob reads as part of the drawing;
 *  a slow breath reads as the one live thing on screen, which is what "this is the node you are reading" means.
 *  One cycle carries the size, the intensity and the colour together, so there is a single slow rhythm to read. */
export const PULSE_MS = 4200;
const PULSE_MIN = 0.45; // dimmest point of the breath, as a share of full intensity
const PULSE_SWELL = 0.14; // how much larger the glow grows at its fullest

/** The breath's cadence: how often the glow is redrawn, in wall time rather than frames, so a 120 Hz display or a
 *  headless browser's unthrottled loop breathes at the same rate as a 60 Hz one. Ten times a second reads as smooth
 *  over a four-second cycle. */
export const BREATH_MS = 100;

/** The intensity a glow holds while the breath rests: its fullest, so a held glow reads as the same mark the breath
 *  swells to, and never as a dimmed one. */
export const RESTING_INTENSITY = 1;

/** How long a freshly-streamed node wears the glow: long enough to catch the eye where it landed, short enough that a
 *  busy stream does not read as a field of alarms. After this, only the active node glows. */
export const NEWCOMER_GLOW_MS = 2000;

/** The breath's intensity (PULSE_MIN..1) at time `nowMs` — a sine, so it has no corners to catch the eye. */
export const pulseAt = (nowMs: number): number => PULSE_MIN + (1 - PULSE_MIN) * (0.5 + 0.5 * Math.sin((nowMs / PULSE_MS) * Math.PI * 2));

/** How much the glow's size swells at a given intensity: full breath is `PULSE_SWELL` larger than the dimmest. */
export const swellAt = (intensity: number): number => 1 + PULSE_SWELL * intensity;

/**
 * The glow's colour cycle: a WARM ramp, not the app accent. The accent is a green that carries meaning elsewhere
 * (a pressed control, a healthy state) and reads as a status rather than as light; a flame does not.
 *
 * One ramp per theme, because a glow is light on a surface: on the dark theme it runs from white through gold to
 * orange, the way something hot looks; on the light theme it starts at gold, since white on white is nothing to see.
 * The ramp is walked to its end and back over one breath, so the colour turns with the size and never cuts from the
 * last stop back to the first.
 */
export const GLOW_RAMP = {
	dark: ["#ffffff", "#ffe9a3", "#ffd24a", "#ffa41c"],
	light: ["#ffc21c", "#ff9d00", "#f07000", "#c04a00"],
} as const;
/** Steps the ramp is precomputed into: a frame then costs an array index, never a colour computation or a new string. */
const RAMP_STEPS = 48;

/** Lerp two "#rrggbb" colours, returning "#rrggbb". Runs only while a ramp table is built, never per frame. */
function mixHex(a: string, b: string, t: number): string {
	const ch = (s: string, i: number) => Number.parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
	const mix = (i: number) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t);
	return `#${[0, 1, 2].map((i) => mix(i).toString(16).padStart(2, "0")).join("")}`;
}

const rampTables = new WeakMap<readonly string[], string[]>();

/** The ramp as `RAMP_STEPS` colours from its first stop to its last. Built once per ramp. */
function rampTable(ramp: readonly string[]): string[] {
	const cached = rampTables.get(ramp);
	if (cached) return cached;
	const last = ramp.length - 1;
	const table = Array.from({ length: RAMP_STEPS }, (_, i) => {
		const at = (i / (RAMP_STEPS - 1)) * last;
		const from = Math.min(Math.floor(at), last - 1);
		return mixHex(ramp[from], ramp[from + 1], at - from);
	});
	rampTables.set(ramp, table);
	return table;
}

/**
 * The glow's colour at a given intensity: a table lookup, so the cycle costs the same as a static colour.
 *
 * The intensity is the one `pulseAt` gives and `swellAt` reads, so the colour, the size and the light are one value
 * rather than three readings of the same clock. The ramp's first stop is the dimmest point and its last the fullest,
 * so one cycle takes the colour out and back.
 */
export const glowColorAt = (intensity: number, ramp: readonly string[]): string => {
	const breath = (intensity - PULSE_MIN) / (1 - PULSE_MIN);
	return rampTable(ramp)[Math.min(RAMP_STEPS - 1, Math.max(0, Math.round(breath * (RAMP_STEPS - 1))))];
};

let sharedTexture: unknown;

/** The radial-alpha texture every glow shares: white (so the material's colour tints it), fading to fully transparent. */
function glowTexture(three: GlowThree): unknown {
	if (sharedTexture) return sharedTexture;
	const canvas = document.createElement("canvas");
	canvas.width = TEXTURE_PX;
	canvas.height = TEXTURE_PX;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("polymorphic glow: no 2d context to build the highlight texture");
	const r = TEXTURE_PX / 2;
	const g = ctx.createRadialGradient(r, r, 0, r, r, r);
	g.addColorStop(0, `rgba(255,255,255,${GLOW_ALPHA})`);
	g.addColorStop(0.45, `rgba(255,255,255,${GLOW_ALPHA * 0.55})`);
	g.addColorStop(1, "rgba(255,255,255,0)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, TEXTURE_PX, TEXTURE_PX);
	sharedTexture = new three.CanvasTexture(canvas);
	return sharedTexture;
}

/** How a mark's glow burns right now: its strength (0..1) and its colour, both driven per frame by the focus pass. */
export type TBurn = { intensity: number; color?: string };

/** The glow a mark carries, built on FIRST activation and kept — one node is active at a time, so a graph pays for the
 *  few marks ever opened rather than a sprite per node. `size` is the mark's own sizing rule: a chip sizes its glow to
 *  its measured box, a sprite to a share of its own scale (a child's scale multiplies its parent's). */
export class MarkGlow {
	private glow?: GlowObj;
	private lastColor?: string;
	private lit = false;

	constructor(
		private readonly build: () => GlowObj,
		private readonly size: (glow: GlowObj, swell: number) => void,
	) {}

	get isLit(): boolean {
		return this.lit;
	}

	/** Show or hide the glow, at the given strength and colour. */
	set(on: boolean, burn?: TBurn): void {
		this.lit = on;
		if (on && !this.glow) this.glow = this.build();
		const glow = this.glow;
		if (!glow) return;
		glow.visible = on;
		const intensity = burn?.intensity ?? 1;
		glow.material.opacity = intensity;
		// The ramp holds a few dozen colours, so most frames ask for the colour already set; a CSS-colour parse per
		// frame for no change is the one avoidable cost in the breath.
		if (burn?.color && burn.color !== this.lastColor) {
			glow.material.color?.set(burn.color);
			this.lastColor = burn.color;
		}
		this.size(glow, swellAt(intensity));
	}
}

/** A glow sprite in `color`, drawn under `renderOrder`. Hidden until shown, so a mark can build one lazily and keep it. */
export function makeGlow(three: GlowThree, color: string, renderOrder: number): GlowObj {
	const sprite = new three.Sprite(new three.SpriteMaterial({ map: glowTexture(three), color, transparent: true, depthTest: false, depthWrite: false }));
	sprite.renderOrder = renderOrder;
	sprite.visible = false;
	return sprite;
}

export type { GlowObj };
