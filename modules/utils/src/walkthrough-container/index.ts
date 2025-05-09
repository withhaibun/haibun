#!/usr/bin/env node

import { getPackageLocation } from '@haibun/core/build/lib/util/workspace-lib.js';
import { execSync } from 'child_process';
import { resolve } from 'path';
import { writeFileSync, unlinkSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { HOST_PROJECT_DIR } from '@haibun/core/build/lib/defs.js';
const runContainer = (testToRun, filter, includeDirs = [], recreate) => {
	try {
		const utilDir = resolve(getPackageLocation(import.meta), '..', '..', 'walkthrough-container');
		const projectDir = process.cwd();
		const tmpFile = resolve(tmpdir(), `docker-compose.override-${Date.now()}.yml`);
		const envs = readFileSync(`${projectDir}/.env`, 'utf8').split('\n').join(',');
		const haibunEnvc = (envs.length > 0) ? `HAIBUN_ENV=${envs} ` : '';
		// Ensure capture directory exists
		const captureDir = resolve(projectDir, 'capture');
		if (!existsSync(captureDir)) {
			console.log('Creating capture directory');
			mkdirSync(captureDir, { recursive: true });
		}
		// Add capture to directories to mount
		const dirsToMount = [...includeDirs, 'capture'];
		// Create docker compose config file with volumes
		const volumeConfig = dirsToMount.map(dir => {
			const sourcePath = resolve(projectDir, dir);
			return `      - ${sourcePath}:/app/${dir}`;
		}).join('\n');
		const buildContextDir = resolve(tmpdir(), `build-context-${Date.now()}`);
		mkdirSync(buildContextDir, { recursive: true });
		// Copy project's package files to build context
		execSync(`cp ${projectDir}/package*.json ${buildContextDir}/`);
		// Copy container files to build context
		execSync(`cp ${utilDir}/speak-to-wav.sh ${utilDir}/kokoro-speak.cjs ${utilDir}/entrypoint.sh ${buildContextDir}/`);
		const composeFile = `
services:
  haibun-recorder:
    build:
      context: ${buildContextDir}
      dockerfile: ${utilDir}/Dockerfile
    volumes:
      - ${projectDir}/capture:/app/capture
      - ${projectDir}:/app/output
${volumeConfig}
    environment:
      - DISPLAY=:99
      - HAIBUN_O_HAIBUN_TTS_CMD=/app/speak-to-wav.sh @WHAT@
      - HAIBUN_O_HAIBUN_TTS_PLAY=aplay @WHAT@
      - ${HOST_PROJECT_DIR}=${projectDir}
      - COMMAND_TO_RECORD=${HOST_PROJECT_DIR}="${projectDir}" HAIBUN_LOG_LEVEL=log ${haibunEnvc} npm run ${testToRun} ${filter}
`;
		writeFileSync(tmpFile, composeFile);
		console.log(`Building then starting walkthrough container using ${utilDir}`);
		console.log(`Mounting directories:\n${volumeConfig}`);
		try {
			execSync(`docker compose -f docker-compose.yml -f ${tmpFile} up --build ${recreate ? '--force-recreate' : ''}`, {
				cwd: utilDir,
				stdio: 'inherit',
				env: {
					...process.env,
					CURRENT_DIR: projectDir,
				}
			});
		}
		finally {
			unlinkSync(tmpFile);
			execSync(`rm -rf ${buildContextDir}`);
		}
	}
	catch (error) {
		console.error('Error:', error.stderr?.toString() || error.message);
		process.exit(1);
	}
};
let recreate = false;
const args = process.argv.slice(2).reduce((acc, arg) => {
	if (arg === '--recreate') {
		recreate = true;
		return acc;
	}
	else if (arg === '--help') {
		printHelp();
	}
	return [...acc, arg];
}, []);
const [testToRun, filter, ...includeDirs] = args;
if (!testToRun || includeDirs.length === 0) {
	printHelp();
}
runContainer(testToRun, filter, includeDirs, recreate);
function printHelp() {
	console.error(`Usage: ${process.argv[1]} [--rebuild] script filter features files ...`);
	process.exit(1);
}
