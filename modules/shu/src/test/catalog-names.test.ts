/**
 * A view reads types and fields from the concern catalog (CR4), as it reads data through a controller (data-access.test.ts).
 * The scan reads shu's components and controllers for the persisted types and fields the catalog of haibun's steppers
 * supplies, and each file names them at most as often as catalog-names.baseline.json records.
 */
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { buildConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { expectWithinBaseline } from "@haibun/core/lib/test/baseline.js";
import { DEF_PROTO_OPTIONS, getTestWorldWithOptions } from "@haibun/core/lib/test/lib.js";
import { sourceFiles, workspacePackages } from "@haibun/core/lib/test/repository-files.js";
import { createSteppers, setStepperWorldsAndDomains } from "@haibun/core/lib/util/index.js";
import { addStepperConcerns } from "@haibun/core/phases/Executor.js";
import ActivitiesStepper from "@haibun/core/steps/activities-stepper.js";
import AuthorityStepper from "@haibun/core/steps/authority-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import ResourcesStepper from "@haibun/core/steps/resources-stepper.js";
import UrakataStepper from "@haibun/core/steps/urakata-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import StorageMem from "@haibun/storage-mem/storage-mem.js";
import WebPlaywright from "@haibun/web-playwright";
import WebServerStepper from "@haibun/web-server-hono/web-server-stepper.js";
import ClientCacheStepper from "../client-cache/client-cache-stepper.js";
import GraphSourceStepper from "../graph-source-stepper.js";
import MonitorStepper from "../monitor-stepper.js";
import ShuStepper from "../shu-stepper.js";
import { catalogNameFindings, catalogNames } from "./catalog-names-scan.js";
import { CONTROLLERS, viewDirectories, VIEWS } from "./data-access-scan.js";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..", "..");
const VIEWS = viewDirectories(join(REPOSITORY, "modules/shu/src"), [VIEWS, CONTROLLERS]).map((dir) => relative(REPOSITORY, dir));
/** The steppers whose persisted types a page of shu shows. */
const STEPPERS = [
	Haibun,
	ActivitiesStepper,
	AuthorityStepper,
	ResourcesStepper,
	UrakataStepper,
	VariablesStepper,
	StorageMem,
	WebServerStepper,
	WebPlaywright,
	ClientCacheStepper,
	GraphSourceStepper,
	MonitorStepper,
	ShuStepper,
];
const FIX = "read the type or field from the concern catalog through a controller, as rels-cache.ts reads it";

describe("a view's types and fields", () => {
	it("come from the catalog, apart from the names catalog-names.baseline.json records (CR4)", async () => {
		const world = getTestWorldWithOptions(DEF_PROTO_OPTIONS);
		const steppers = createSteppers(STEPPERS);
		await setStepperWorldsAndDomains(steppers, world);
		addStepperConcerns(world, steppers);
		const names = catalogNames(buildConcernCatalog(world.domains));
		expect([...names.types]).toEqual(expect.arrayContaining(["Comment", "SeqPath", "Principal"]));
		const files = sourceFiles(REPOSITORY, VIEWS);
		const found = catalogNameFindings(REPOSITORY, { files, packages: workspacePackages(REPOSITORY, "modules"), names });
		expectWithinBaseline({
			baselineFile: join(import.meta.dirname, "catalog-names.baseline.json"),
			found,
			testFile: "modules/shu/src/test/catalog-names.test.ts",
			fix: FIX,
		});
	});
});
