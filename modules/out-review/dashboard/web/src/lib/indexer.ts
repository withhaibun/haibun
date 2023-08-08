import { TReviewLink } from "@haibun/domain-storage/build/domain-storage.js";

// this module might be replaced by specific storage implementations at runtime

const apiUrl = '/reviews';

export async function getLatestPublished() {
  const response = await fetch(`${apiUrl}/`);
  const data = await response.text();
  const latest = parseLinks(data).map(link => link.replace(apiUrl, ''))
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
export async function resolvePublishedReview(link: string): Promise<TReviewLink> {
  const response = await fetch(`${apiUrl}/${link}`);
  const reviewLink: TReviewLink = await response.json();
  reviewLink.link = reviewLink.link.replace(/.*\//, '');
  return reviewLink;
}
