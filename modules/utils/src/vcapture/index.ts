#!/usr/bin/env node

import { getPackageLocation } from '@haibun/core/build/lib/util/workspace-lib.js';
import { execSync } from 'child_process';
import { resolve } from 'path';
import { writeFileSync, unlinkSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { HOST_PROJECT_DIR } from '@haibun/core/build/lib/defs.js';
import { TAnyFixme } from '@haibun/core/build/lib/fixme.js';

process.on('unhandledRejection', (err: TAnyFixme) => {
	console.error('cli Unhandled Rejection:', err);
	if (err && err.stack) {
		console.error(err.stack);
	} else {
		console.error(err);
	}
});

const runOptions = {
	recreate: false,
	tts: false,
	capture: true,
	res: '1280x1024',
}

const runContainer = (testToRun, filter, includeDirs = [], thisRunOptions: typeof runOptions) => {
	try {
		const utilDir = resolve(getPackageLocation(import.meta), '..', '..', 'vcapture');
		const projectDir = process.cwd();
		const tmpFile = resolve(tmpdir(), `docker-compose.override-${Date.now()}.yml`);
		const envs = existsSync(`${projectDir}/.env`) ? readFileSync(`${projectDir}/.env`, 'utf8').split('\n').filter(l => l.length > 0) : [];
		const haibunEnvc = (envs.length > 0) ? `HAIBUN_ENV=${envs.join(',')} ` : '';
		const captureDir = resolve(projectDir, 'capture');
		console.info('vcapture running with options:', thisRunOptions);
		if (!existsSync(captureDir)) {
			console.log('Creating capture directory');
			mkdirSync(captureDir, { recursive: true });
		}
		const buildContextDir = resolve(tmpdir(), `build-context-${Date.now()}`);
		mkdirSync(buildContextDir, { recursive: true });
		execSync(`cp ${projectDir}/*.json ${buildContextDir}/`);
		execSync(`cp ${utilDir}/*.sh ${utilDir}/kokoro-speak.cjs ${buildContextDir}/`);
		const dirsToMount = [...includeDirs, 'capture'];
		const composeVolumes = [
			`${projectDir}/capture:/app/capture`,
			`${projectDir}:/app/output`,
			...dirsToMount.map(dir => `${resolve(projectDir, dir)}:/app/${dir}`)
		];
		const composeEnvironment = [
			'DISPLAY=:99',
			`RES=${thisRunOptions.res}`,
			`${HOST_PROJECT_DIR}=${projectDir}`,
			`COMMAND_TO_RECORD=${HOST_PROJECT_DIR}="${projectDir}" HAIBUN_LOG_LEVEL=log ${haibunEnvc} npm run ${testToRun} ${filter}`
		];
		if (thisRunOptions.tts) {
			composeEnvironment.push(
				'HAIBUN_O_HAIBUN_TTS_CMD=/app/speak-to-wav.sh @WHAT@',
				'HAIBUN_O_HAIBUN_TTS_PLAY=aplay @WHAT@'
			);
		}
		if (thisRunOptions.capture) {
			composeEnvironment.push(
				'HAIBUN_O_HAIBUN_CAPTURE_START=/app/capture-start.sh',
				'HAIBUN_O_HAIBUN_CAPTURE_STOP=/app/capture-stop.sh'
			);
		}

		const composeFile = `
services:
  haibun-recorder:
    build:
      context: ${buildContextDir}
      dockerfile: ${utilDir}/Dockerfile
    volumes:
${asYamlOptions(composeVolumes)}
    environment:
${(asYamlOptions(composeEnvironment))}
`;
		writeFileSync(tmpFile, composeFile);
		console.log(`Building then starting vcapture container using ${utilDir}`);
		console.log(`Mounting directories:\n${composeVolumes}`);
		try {
			const cmd = `docker compose -f docker-compose.yml -f ${tmpFile} up ${thisRunOptions.recreate ? '--force-recreate --build' : ''}`
			console.log('building with:', cmd);
			execSync(cmd, {
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
	} catch (error) {
		console.error('Error:', error.stderr?.toString() || error.message);
		process.exit(1);
	}
};
const args = process.argv.slice(2);
args.reduce((acc, arg) => {
	if (arg.startsWith('--')) {
		const [what, value] = arg.split('=');
		if (what === '--recreate') {
			runOptions.recreate = value !== 'false';
			return acc;
		} else if (what === '--tts') {
			runOptions.tts = value !== 'false';
			return acc;
		} else if (what === '--no-capture') {
			runOptions.capture = false;
			return acc;
		} else if (what === '--res') {
			const res = args.shift();
			if (res && res.match(/^\d+x\d+$/)) {
				runOptions.res = res;
				return acc;
			}
			console.error(`Missing or incorrect WxH value for --res: ${res}`);
			printHelp();
		} else if (arg === '--help') {
			printHelp(0);
		}
		console.error(`unknown -- arg ${arg}`);
		printHelp();
	}
	return [...acc, arg];
}, []);
const [testToRun, filter, ...includeDirs] = args;
if (!testToRun || includeDirs.length === 0) {
	printHelp();
}
runContainer(testToRun, filter, includeDirs, runOptions);
function printHelp(exitCode = 1) {
	console.error(`Usage: ${process.argv[1]} [--recreate[=boolean]] [--tts[=boolean]] [--no-capture] [--help] [--res WxH] script filter features files ...`);
	process.exit(exitCode);
}

function asYamlOptions(options: string[]) {
	return options.map(o => `      - ${o}`).join('\n');
}
