import { readdirSync, statSync } from 'fs';

const modules = readdirSync('./modules/')
	.map((d) => `./modules/${d}`)
	.filter((f) => statSync(f).isDirectory());
export default modules;
