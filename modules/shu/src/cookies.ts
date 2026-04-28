/**
 * Cookie helpers for SPA-side persistence. One-year max-age, path=/, encoded
 * values. JSON variants take a default for parse failures so a corrupt cookie
 * doesn't break the call site — bad JSON falls back instead of throwing.
 */

const ONE_YEAR = 60 * 60 * 24 * 365;

export function getCookie(name: string): string {
	if (typeof document === "undefined") return "";
	const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
	return match ? decodeURIComponent(match[1]) : "";
}

export function setCookie(name: string, value: string): void {
	if (typeof document === "undefined") return;
	document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${ONE_YEAR}`;
}

export function clearCookie(name: string): void {
	if (typeof document === "undefined") return;
	document.cookie = `${name}=; path=/; max-age=0`;
}

export function getJsonCookie<T>(name: string, fallback: T): T {
	const raw = getCookie(name);
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

export function setJsonCookie(name: string, value: unknown): void {
	setCookie(name, JSON.stringify(value));
}
