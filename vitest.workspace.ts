import { readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const modulesDir = join(__dirname, 'modules');

const modules = readdirSync(modulesDir)
	.map((d) => join(modulesDir, d))
	.filter((f) => statSync(f).isDirectory());
export default modules;
