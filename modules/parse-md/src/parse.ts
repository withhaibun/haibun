import { readFileSync, writeFileSync } from "fs";
import fetch from "node-fetch";
import TurndownService from "turndown";
import { TSpecl, IStepper } from "@haibun/core/build/lib/defs";

export async function parse(specl: TSpecl, base: string, steppers: IStepper[]) {
  const { refs } = specl;
  const { docs } = refs!;
  let conditions = [];

  for (const stepper of steppers) {
    for (const doc in docs) {
      let content: string;
      const loc = `${base}/refs/${doc}.md`;
      try {
        content = readFileSync(loc, "utf-8");
      } catch (e) {
        console.info(`fetching ${loc} from ${docs[doc].src}`);
        const response = await fetch(docs[doc].src);
        content = await response.text();
        const turndownService = new TurndownService();
        const markdown = turndownService.turndown(content);
        writeFileSync(loc, markdown);
      }

      for (const [name, step] of Object.entries(stepper.steps)) {
        const matches = content.matchAll(step.match!);
        for (const match of matches) {
          const [m] = match;
          conditions.push({
            doc,
            condition: m,
            index: match.index,
          });
        }
      }
      writeFileSync(`${base}/features/${doc}.md`, conditions.map(c => c.condition).join('\n'));
    }
    console.info('wrote', Object.keys(docs));
  }
}
