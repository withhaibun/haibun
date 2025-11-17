const normalizeForDisplay = (input: string): string => {
    if (input === undefined || input === null) return '';
    let s = String(input).normalize('NFC');
    s = s.replace(/\p{Cc}|\p{Cf}/gu, '');
    s = s.replace(/[\u{FFFD}]/gu, '');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
};

export const sanitize = (text: string): string => {
    const s = normalizeForDisplay(text || '');
    if (!s) return 'empty_sanitized_string';
    const replaced = s.replace(/[^\p{L}\p{N}_-]+/gu, '_');
    const collapsed = replaced.replace(/_+/g, '_').replace(/^_|_$/g, '');
    if (!/^[A-Za-z]/.test(collapsed)) return `id_${collapsed}`;
    return collapsed;
};

export const formatLabel = (text: string): string => {
    const raw = normalizeForDisplay(text === undefined || text === null ? ' ' : String(text));
    const escaped = raw.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const finalLabel = escaped === '' ? ' ' : escaped;
    return `"${finalLabel}"`;
};
