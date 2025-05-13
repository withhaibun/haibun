import { resolve } from 'path/posix';
import { pathToFileURL } from 'url';
import { HOST_PROJECT_DIR } from '../defs.js';

// return either the virtual host path or the real path

export function actualURI(file: string) {
	const hostPath = process.env[HOST_PROJECT_DIR];
	const actualPath = pathToFileURL(hostPath ? resolve(hostPath, file) : resolve(file));
	return actualPath;
}
