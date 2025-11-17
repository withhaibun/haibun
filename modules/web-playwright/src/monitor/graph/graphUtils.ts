// Helper function to sanitize text for use in Mermaid node IDs
// Remove control and non-printable characters, normalize unicode, and collapse whitespace
const normalizeForDisplay = (input: string): string => {
    if (input === undefined || input === null) return '';
    // Normalize to NFC to have consistent combining characters
    let s = String(input).normalize('NFC');

    // Remove Unicode control characters and private use / replacement characters
    // Keep common printable ranges (letters, numbers, punctuation, symbols, whitespace)
    // Also strip characters in the Cc (control) and Cf (format) categories
    s = s.replace(/\p{Cc}|\p{Cf}/gu, '');

    // Replace any remaining non-printable or isolated surrogate characters
    s = s.replace(/[\u{FFFD}]/gu, '');

    // Collapse repeated whitespace (including newlines/tabs) to single space
    s = s.replace(/\s+/g, ' ').trim();

    return s;
};

// Helper function to sanitize text for use in Mermaid node IDs
export const sanitize = (text: string): string => {
    const s = normalizeForDisplay(text || '');
    if (!s) return 'empty_sanitized_string'; // Avoid empty IDs by providing a placeholder
    // Replace any non-word characters with underscore, then collapse sequential underscores
    const replaced = s.replace(/[^\p{L}\p{N}_-]+/gu, '_');
    const collapsed = replaced.replace(/_+/g, '_').replace(/^_|_$/g, '');
    // Ensure ID starts with a letter to be a valid HTML-like identifier; prefix if needed
    if (!/^[A-Za-z]/.test(collapsed)) return `id_${collapsed}`;
    return collapsed;
};

// Helper function to format strings for Mermaid labels (wrap in quotes and escape internal quotes)
export const formatLabel = (text: string): string => {
    const raw = normalizeForDisplay(text === undefined || text === null ? ' ' : String(text));
    // Escape double quotes for mermaid by replacing with HTML entity for readability
    const escaped = raw.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Also ensure we don't accidentally end up with empty labels
    const finalLabel = escaped === '' ? ' ' : escaped;
    return `"${finalLabel}"`;
};
