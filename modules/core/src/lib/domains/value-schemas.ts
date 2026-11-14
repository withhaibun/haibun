/**
 * The schemas of core's primitive domains: a string, a number, a date, a length of time and a step's place. core's domain
 * registration parses each value with them, and the DomainTypes entries of those domains state their output types.
 */
import { z } from "zod";
import { DURATION_TERM } from "./domains.js";
import { extractSeqPathPrefix, parseSeqPath } from "../actuality/domains/seq-path.js";

/** A string literal, or any value as its text. */
export const StringSchema = z.coerce.string({ error: "value is required" });
/** A finite number, or text that reads as one. */
export const NumberSchema = z.coerce.number({ error: "invalid number" }).refine((value) => Number.isFinite(value), "invalid number");
/** A Date, from an ISO timestamp, epoch milliseconds or a Date. */
export const DateSchema = z.coerce.date({ error: "invalid date" });
/** Reads a length of time in milliseconds from seconds or milliseconds, such as `2s` or `30 ms`, or from a number of milliseconds. */
export const DurationSchema = z.preprocess((value, ctx) => {
	if (typeof value !== "string") return value;
	const match = DURATION_TERM.exec(value.trim());
	if (!match) ctx.addIssue({ code: "custom", message: `${JSON.stringify(value)} isn't a length of time: give seconds or milliseconds, such as 2s or 30 ms` });
	return match ? Number(match[1]) * (match[2] === "s" ? 1000 : 1) : value;
}, z.number().nonnegative());

/** Reads a step's place from its dot-joined sequence path, or from an id that begins with one. */
export const StepPathSchema = z.preprocess((value, ctx) => {
	if (typeof value !== "string") return value;
	const prefix = extractSeqPathPrefix(value);
	const path = prefix === null ? null : parseSeqPath(prefix);
	if (path === null) ctx.addIssue({ code: "custom", message: `${JSON.stringify(value)} doesn't name a step: a step's place is dot-joined integers, such as 0.1.5.3` });
	return path ?? value;
}, z.array(z.number().int()).min(1));
