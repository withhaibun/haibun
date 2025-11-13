import { execSync } from 'child_process';
import { resolve } from 'path';
import { writeFileSync, unlinkSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';

import { getPackageLocation } from '@haibun/core/lib/util/workspace-lib.js';
import { HOST_PROJECT_DIR } from '@haibun/core/lib/util/actualURI.js';

export type TCaptureOptions = {
	recreate: boolean;
	tts: boolean;
	capture: boolean;
	res: string;
	passEnv: string[] | undefined;
	cliEnv: string[] | undefined;
	featureFilter: string | undefined;
}

export const runContainer = (testToRun, includeDirs = [], thisCaptureOptions: TCaptureOptions) => {
	try {
		const { tmpFile, composeEnvironment, utilDir, composeVolumes, projectDir, buildContextDir } = getContainerSetup(thisCaptureOptions, includeDirs, testToRun);
		const captureDir = resolve(projectDir, 'capture');
		if (!existsSync(captureDir)) {
			console.info('Creating capture directory');
			mkdirSync(captureDir, { recursive: true });
		}
		mkdirSync(buildContextDir, { recursive: true });
		execSync(`cp ${projectDir}/*.json ${buildContextDir}/`);
		execSync(`cp ${utilDir}/*.sh ${utilDir}/kokoro-speak.cjs ${buildContextDir}/`);
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
		console.info(`Building then starting vcapture container using ${utilDir}`);
		console.info(`Mounting directories:\n${composeVolumes.join('\n')}`);
		try {
			const cmd = `docker compose -f docker-compose.yml -f ${tmpFile} up ${thisCaptureOptions.recreate ? '--force-recreate --build' : ''}`
			console.info('building with:', cmd);
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

export function getContainerSetup(thisRunOptions: TCaptureOptions, includeDirs: string[], testToRun: string) {
	const utilDir = resolve(getPackageLocation(import.meta), '..', '..', 'vcapture');
	const projectDir = process.cwd();
	const tmpFile = resolve(tmpdir(), `docker-compose.override-${Date.now()}.yml`);

	const envs = existsSync(`${projectDir}/.env`) ? readFileSync(`${projectDir}/.env`, 'utf8').split('\n').filter(l => l.length > 0) : [];
	if (thisRunOptions.cliEnv) {
		envs.push(...thisRunOptions.cliEnv);
	}

	const haibunCliEnvc = (envs.length > 0) ? `HAIBUN_ENV=${envs.join(',').replace(/,$/, '')} ` : '';
	const buildContextDir = resolve(tmpdir(), `build-context-${Date.now()}`);
	const dirsToMount = [...includeDirs, 'capture'];
	const composeVolumes = [
		`${projectDir}/capture:/app/capture`,
		`${projectDir}:/app/output`,
		...dirsToMount.map(dir => `${resolve(projectDir, dir)}:/app/${dir}`)
	];
	const flags = thisRunOptions.featureFilter ? ` -- ${thisRunOptions.featureFilter}` : '';
	const composeEnvironment = [
		'DISPLAY=:99',
		`RES=${thisRunOptions.res}`,
		`${HOST_PROJECT_DIR}=${projectDir}`,
		`COMMAND_TO_RECORD=${HOST_PROJECT_DIR}="${projectDir}" HAIBUN_LOG_LEVEL=log ${haibunCliEnvc} ${thisRunOptions.passEnv?.join(' ') || ""} npm run ${testToRun}${flags}`
	];
	if (thisRunOptions.tts) {
		composeEnvironment.push(
			'HAIBUN_O_NARRATOR_TTS_CMD=/app/speak-to-wav.sh @WHAT@',
			'HAIBUN_O_NARRATOR_TTS_PLAY=aplay @WHAT@'
		);
	}
	if (thisRunOptions.capture) {
		composeEnvironment.push(
			'HAIBUN_O_NARRATOR_CAPTURE_START=/app/capture-start.sh',
			'HAIBUN_O_NARRATOR_CAPTURE_STOP=/app/capture-stop.sh'
		);
	}

	return { tmpFile, composeEnvironment, utilDir, composeVolumes, projectDir, buildContextDir };
}

function asYamlOptions(options: string[]) {
	return options.map(o => `      - ${o}`).join('\n');
}

export function parseVCaptureArgs(args: string[], printHelp: (exitCode?: number) => void) {
	const captureOptions: TCaptureOptions = {
		recreate: false,
		tts: false,
		cliEnv: undefined,
		capture: true,
		res: '1280x1024',
		passEnv: undefined,
		featureFilter: undefined
	};

	// Collect all non-flag arguments in order
	const positional: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith('--')) {
			const [what, ...v] = arg.split('=');
			const value = v.join('=');

			switch (what) {
				case '--recreate': {
					const recreateValue = value;
					captureOptions.recreate = recreateValue !== 'false';
					break;
				}
				case '--tts': {
					const ttsValue = value;
					captureOptions.tts = ttsValue !== 'false';
					break;
				}
				case '--no-capture': {
					const captureValue = value;
					captureOptions.capture = !(captureValue !== 'false');
					break;
				}
				case '--feature-filter': {
					captureOptions.featureFilter = value;
					break;
				}
				case '--cli-env': {
					captureOptions.cliEnv = captureOptions.cliEnv ? [...captureOptions.cliEnv, value] : [value];
					break;
				}
				case '--pass-env': {
					captureOptions.passEnv = captureOptions.passEnv ? [...captureOptions.passEnv, value] : [value];
					break;
				}
				case '--res': {
					if (value && value.match(/^\d+x\d+$/)) {
						captureOptions.res = value;
					} else {
						console.error(`Missing or incorrect WxH value for --res: ${value}`);
						printHelp();
					}
					break;
				}
				case '--help':
					printHelp(0);
					break;
				default:
					console.error(`unknown -- arg ${arg}`);
					printHelp();
			}
		} else {
			positional.push(arg);
		}
	}
	const [testToRun, ...includeDirs] = positional;
	if (!testToRun || includeDirs.length === 0) printHelp();
	return { captureOptions, testToRun, includeDirs };
}
