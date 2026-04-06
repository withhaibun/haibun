import { SpeclSchema } from "../build/lib/defs.js";
import * as fs from "fs";
import * as path from "path";

// Define the absolute output path
const outPath = path.resolve(process.cwd(), "haibun-core-specl.schema.json");

// Generate schema using Zod 4 native method
const jsonSchema = SpeclSchema.toJSONSchema({
	target: "draft-2020-12",
});

// Write to disk
fs.writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2));
console.log(`Generated JSON schema at ${outPath}`);
