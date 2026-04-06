/**
 * Mermaid diagram utilities
 */

/**
 * Escape characters that break mermaid syntax in labels.
 * Handles: " ' @ : [ ] { } ( ) < > | # ; & newlines
 */
export function escapeLabel(label: string): string {
	return label
		.replace(/"/g, "")
		.replace(/'/g, "")
		.replace(/@/g, " at ")
		.replace(/:/g, "-")
		.replace(/\|/g, "")
		.replace(/\n/g, " ")
		.replace(/[[\]{}()<>]/g, "")
		.replace(/[#;&]/g, "")
		.replace(/\//g, "-")
		.replace(/\*/g, "");
}

/**
 * Sanitize a string to be used as a mermaid node/participant ID.
 * IDs must be alphanumeric with underscores.
 */
export function sanitizeId(name: string): string {
	return (
		name
			.replace(/[^a-zA-Z0-9]/g, "_")
			.replace(/^_+|_+$/g, "")
			.substring(0, 30) || "node"
	);
}

/**
 * Truncate text to max length with ellipsis.
 */
export function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.substring(0, maxLen - 3) + "...";
}
