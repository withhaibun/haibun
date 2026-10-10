/**
 * The page's settings, each stored by the element that sets it: the theme and the scale by `<shu-theme-switch>`, and the
 * window size by `<shu-window-size>`. A reader outside the element reads a setting through the page's preferences by the
 * element's tag.
 */
import { z } from "zod";

/** The themes a reader chooses. `auto` follows the operating system's preference. */
export const THEMES = [
	{ value: "auto", label: "Auto" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
] as const;

/** The scales a reader chooses, each a factor of every component's sizes. */
export const SCALES = [
	{ value: "0.85", label: "S" },
	{ value: "1", label: "M" },
	{ value: "1.25", label: "L" },
	{ value: "1.5", label: "XL" },
] as const;

/** How many rows a windowed read returns: a page of actuality's records and a page of the graph query. The last size reads
 *  every row. */
export const WINDOW_SIZES = [
	{ value: "50", label: "50" },
	{ value: "500", label: "500" },
	{ value: "2000", label: "2000" },
	{ value: "5000", label: "5000" },
	{ value: "10000", label: "10000" },
	{ value: "20000", label: "20000" },
	{ value: "9000000000", label: "∞" },
] as const;

const values = <T extends ReadonlyArray<{ value: string }>>(choices: T): [T[number]["value"], ...T[number]["value"][]] =>
	choices.map(({ value }) => value) as [T[number]["value"], ...T[number]["value"][]];

export const ThemeSwitchSchema = z.object({ theme: z.enum(values(THEMES)), scale: z.enum(values(SCALES)) });
export type TThemeSettings = z.infer<typeof ThemeSwitchSchema>;

export const WindowSizeSchema = z.object({ rows: z.enum(values(WINDOW_SIZES)) });
export type TWindowSize = z.infer<typeof WindowSizeSchema>;

/** The settings of a reader who hasn't chosen them. */
export const INITIAL_THEME: TThemeSettings = { theme: "auto", scale: "1" };
export const INITIAL_WINDOW_SIZE: TWindowSize = { rows: "500" };

/** The key of the one stored instance of a page-wide setting. */
export const PAGE_SETTING_KEY = "";

/** Whether a view's controls show in its pane. `<shu-column-pane>` stores it by the view's tag (`shownControlsKey`), so
 *  each view of a tag opens with its controls as the reader last set them. */
export const ShownControlsSchema = z.object({ shown: z.boolean() });
export type TShownControls = z.infer<typeof ShownControlsSchema>;
export const INITIAL_SHOWN_CONTROLS: TShownControls = { shown: false };

/** The key under which `<shu-column-pane>` stores whether a view of `tag` shows its controls. */
export const shownControlsKey = (tag: string): string => `controls:${tag}`;
