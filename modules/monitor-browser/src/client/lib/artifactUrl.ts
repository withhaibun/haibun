/**
 * Get the URL for an artifact path.
 * 
 * In development mode (via Vite dev server), artifact requests
 * are proxied through /artifacts to the Haibun monitor server.
 * 
 * In serialized/production mode, artifacts are relative to the HTML file.
 */
export function getArtifactUrl(path: string | undefined): string {
  if (!path) return '';

  // If already an absolute URL or data URL, return as-is
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
    return path;
  }

  // Check if we're in dev mode by looking for Vite's dev flag
  // or checking if the page was loaded from the Vite dev server
  const isDev = typeof window !== 'undefined' &&
    ((import.meta as any).env?.DEV || window.location.port === '3458');

  if (isDev) {
    // Strip leading ./ or /
    const cleanPath = path.replace(/^\.?\//, '');
    // Connect directly to the monitor server on port 8080 at the same host
    // The Vite proxy only works when accessing from localhost
    const pageHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    return `http://${pageHost}:8080/${cleanPath}`;
  }

  // In production/serialized mode, use the path as-is (relative to HTML)
  return path;
}
