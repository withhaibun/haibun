import { readFileSync, writeFileSync } from 'fs';
import fetch from 'node-fetch';
import TurndownService from 'turndown';

export async function parseMatches(docs: string[], base: string, matches: RegExp[]) {
  let conditions = [];

  for (const doc of docs) {
    let markdown: string;
    const loc = `${base}/refs/${doc}.md`;
    try {
      markdown = readFileSync(loc, 'utf-8');
    } catch (e) {
      const content = await fetchFileOrUri(doc);
      const turndownService = new TurndownService();
      markdown = turndownService.turndown(content);
      writeFileSync(loc, markdown);
    }

    for (const match of matches) {
      const matches = markdown.matchAll(match);
      for (const match of matches) {
        const [m] = match;
        conditions.push({
          doc,
          condition: m,
          index: match.index,
        });
      }
      writeFileSync(`${base}/features/${doc}.md`, conditions.map((c) => c.condition).join('\n'));
    }
    console.info('wrote', Object.keys(docs));
  }
}

async function fetchFileOrUri(doc: string) {
  console.info(`fetching ${doc}`);
  if (doc.includes('://')) {
    const response = await fetch(doc);
    return await response.text();
  }
  return readFileSync(doc, 'utf-8');
}
