// this module might be replaced by specific storage implementations at runtime

export const endpoint = '/tracks';

export async function getPublishedReviews() {
  const response = await fetch(endpoint);
  const data = await response.text();
  const latest = parseLinks(data).map(link => link.replace(endpoint, ''))
    .map(link => link.replace(/^\//, '')).filter(link => link.length > 0);
  return latest;
}

export function parseLinks(html: string): string[] {
  const links: string[] = [];
  const linkRegex = /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1/g;

  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const link = match[2];
    links.push(link);
  }

  return links;
}