/**
 * Formats an instant and a count in the reader's locale and time zone, through `Intl.DateTimeFormat`,
 * `Intl.RelativeTimeFormat` and `Intl.NumberFormat`. An instant on the reader's day reads as that day and its time, an
 * instant in the reader's week reads as its weekday and time, an instant in the reader's year reads as its month, day and
 * time, and an earlier instant adds its year. A week starts on Monday.
 */

/** The locale and the time zone of a page's formats. */
export type TReaderZone = { locale: string; timeZone: string };

/** The ISO weekday of each `weekday: "short"` part in the `en-US` locale, Monday first. */
const ISO_WEEKDAY: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const DAY_MS = 86_400_000;
/** The count from which a count reads in compact notation, such as `1.2M`. */
const COMPACT_FROM = 1_000_000;
const DATE_RE = [/^\d{4}-\d{2}-\d{2}(T|\s)\d{2}:\d{2}/, /^\d{4}-\d{2}-\d{2}$/, /^[A-Z][a-z]{2},?\s+\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}/];

/** Returns the locale and time zone the page's environment resolves. */
export function readerZone(): TReaderZone {
	const { locale, timeZone } = new Intl.DateTimeFormat().resolvedOptions();
	return { locale, timeZone };
}

/** Whether a text states an instant: an ISO date or date-time, or a mail header's date. */
export const isDateValue = (value: string): boolean => DATE_RE.some((re) => re.test(value));

/** The calendar day of `instant` in `timeZone`, as days since the epoch, and its ISO weekday. */
function calendarDay(instant: Date, timeZone: string): { day: number; weekday: number; year: number } {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", weekday: "short" }).formatToParts(instant).map(({ type, value }) => [type, value]),
	);
	const weekday = ISO_WEEKDAY[String(parts.weekday)];
	if (weekday === undefined) throw new Error(`the weekday "${String(parts.weekday)}" isn't a weekday of the en-US locale`);
	const year = Number(parts.year);
	return { day: Date.UTC(year, Number(parts.month) - 1, Number(parts.day)) / DAY_MS, weekday, year };
}

/** Returns `value` formatted relative to `now` in `zone`, or `value` where it doesn't state an instant. */
export function formatInstant(value: string, now: Date, { locale, timeZone }: TReaderZone): string {
	const instant = new Date(value);
	if (Number.isNaN(instant.getTime())) return value;
	const time = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(instant);
	const at = calendarDay(instant, timeZone);
	const today = calendarDay(now, timeZone);
	if (at.day === today.day) return `${new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(0, "day")}, ${time}`;
	if (at.day - at.weekday === today.day - today.weekday) return `${new Intl.DateTimeFormat(locale, { timeZone, weekday: "long" }).format(instant)} ${time}`;
	const date = at.year === today.year ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" };
	return `${new Intl.DateTimeFormat(locale, { timeZone, ...date } as Intl.DateTimeFormatOptions).format(instant)} ${time}`;
}

/** Returns a count in `locale`: grouped below a million, and in compact notation with one fraction digit from a million. */
export const formatCount = (count: number, locale: string): string =>
	new Intl.NumberFormat(locale, count < COMPACT_FROM ? { maximumFractionDigits: 0 } : { notation: "compact", maximumFractionDigits: 1 }).format(count);
