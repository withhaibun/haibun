import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

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
  const isDev = typeof window !== 'undefined' &&
    (import.meta as { env?: { DEV?: boolean } }).env?.DEV;

  if (isDev) {
    // Strip leading ./ or /
    const cleanPath = path.replace(/^\.?\//, '');
    // Use the Vite proxy (configured in vite.config.ts) to reach the artifact server
    return `/artifacts/${cleanPath}`;
  }

  // In production/serialized mode, use the path as-is (relative to HTML)
  return path;
}

