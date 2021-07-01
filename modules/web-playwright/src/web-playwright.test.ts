import { Resolver } from "@haibun/core/build/lib/Resolver";
import { TVStep } from "@haibun/core/build/lib/defs";
import { Executor } from "@haibun/core/build/lib/Executor";
import Logger, { LOGGER_NONE } from "@haibun/core/build/lib/Logger";
import { getDefaultWorld, getSteppers } from "@haibun/core/build/lib/util";

const wp = [process.cwd(), "build", "web-playwright"].join("/");

describe("playwrightWeb", () => {
  it("sets up steps", async () => {
    const steppers = await getSteppers({
      steppers: [wp],
      ...getDefaultWorld(),
    });
    expect(Object.keys(steppers[0].steps).length > 0).toBe(true);
    expect(Object.values(steppers[0].steps).every((s) => !!s.action)).toBe(
      true
    );
  });
  it("sets browser type and device", async () => {
    const { world } = getDefaultWorld();
    const steppers = await getSteppers({ steppers: [wp], world });
    const resolver = new Resolver(steppers, "", world);
    const test = "using firefox.Pixel 5 browser";
    const actions = resolver.findSteps(test);
    const tvstep: TVStep = {
      in: test,
      seq: 0,
      actions,
    };

    await Executor.doFeatureStep(tvstep, world);
    expect((steppers[0] as any).bf.browserType.name()).toBe("firefox");
    expect((steppers[0] as any).bf.device).toBe("Pixel 5");
  });
  it("fails setting browser type and device", async () => {
    const { world } = getDefaultWorld();
    const logger = new Logger(LOGGER_NONE);
    const steppers = await getSteppers({
      steppers: [wp],
      world,
    });
    const resolver = new Resolver(steppers, "", world);
    const test = "using nonexistant browser";
    const actions = resolver.findSteps(test);
    const tvstep: TVStep = {
      in: test,
      seq: 0,
      actions,
    };

    const result = await Executor.doFeatureStep(tvstep, world);
    expect(result.actionResults[0].ok).toBe(false);
  });
});
