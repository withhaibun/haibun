
import { readFileSync } from "fs";
import { TSpecl, IStepper, IStepperConstructor } from "./lib/defs";
import { Investigator } from "./lib/Investigator";
import { parse } from "./lib/parse";
import { getSteppers, recurse, use } from "./lib/util";

const specl: TSpecl = JSON.parse(readFileSync(process.argv[2], 'utf-8'));

run(specl);

async function run(specl: TSpecl) {
  const vars = {};
  const steppers: IStepper[] = await getSteppers(specl.steppers, vars);
  if (specl.refs) {
    try {
      await parse(specl, steppers);
    } catch (e) {
      console.error('failed parsing', { specl, steppers })
      process.exit(1);
    }
  }
  const investigator = new Investigator(steppers, specl);
  const paths = await recurse(`${specl.folder}/features`, 'feature', {});
  await investigator.investigate(paths);
  await investigator.close();
  process.exit(0);
}
