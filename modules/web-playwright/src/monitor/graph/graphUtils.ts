// Helper function to sanitize text for use in Mermaid node IDs
export const sanitize = (text: string): string => {
    if (!text) return 'empty_sanitized_string'; // Avoid empty IDs by providing a placeholder
    return text.replace(/\W/g, '_');
};

// Helper function to format strings for Mermaid labels (wrap in quotes and escape internal quotes)
export const formatLabel = (text: string): string => {
    if (text === undefined || text === null) return '" "'; // Use a space for undefined/null
    if (text === "") return '" "'; // Use a space for empty string
    const escapedText = text.replace(/"/g, '#quot;');
    return `"${escapedText}"`;
};
