import { Executor } from "@haibun/core/build/phases/Executor";
import {
  getDefaultWorld,
  getStepper,
  getSteppers,
} from "@haibun/core/build/lib/util";
import { getTestEnv } from "@haibun/core/build/lib/TestSteps";
import { TWebPlaywright } from "./web-playwright";

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
    const { world, vstep, steppers } = await getTestEnv(
      [wp],
      "using firefox.Pixel 5 browser",
      getDefaultWorld().world
    );
    await Executor.doFeatureStep(vstep, world);
    const webPlaywright: TWebPlaywright = getStepper(steppers, "WebPlaywright");
    expect(webPlaywright.bf.browserType.name()).toBe("firefox");
    expect(webPlaywright.bf.device).toBe("Pixel 5");
  });
  it("fails setting browser type and device", async () => {
    const { world, vstep } = await getTestEnv(
      [wp],
      "using nonexistant browser",
      getDefaultWorld().world
    );
    const result = await Executor.doFeatureStep(vstep, world);
    expect(result.actionResults[0].ok).toBe(false);
  });
});
