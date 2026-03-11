import { resolve } from 'path';
import { pathToFileURL } from 'url';

export const HOST_PROJECT_DIR = 'HOST_PROJECT_DIR';
export const containerHostPath = process.env[HOST_PROJECT_DIR];

// return either the virtual host path or the real path
export function actualURI(file: string) {
	const actualPath = pathToFileURL(containerHostPath ? resolve(containerHostPath, file) : resolve(file));
	return actualPath;
}
