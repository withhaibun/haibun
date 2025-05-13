import { execSync } from 'child_process';
import { resolve } from 'path';
import { writeFileSync, unlinkSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';

import { getPackageLocation } from '@haibun/core/build/lib/util/workspace-lib.js';
import { HOST_PROJECT_DIR } from '@haibun/core/build/lib/defs.js';

type TRunOptions = {
	recreate: boolean;
	tts: boolean;
	capture: boolean;
	res: string;
	passEnv: string | undefined;
	featureFilter: string | undefined;
}

export const runContainer = (testToRun, includeDirs = [], thisRunOptions: TRunOptions) => {
	try {
		const utilDir = resolve(getPackageLocation(import.meta), '..', '..', 'vcapture');
		const projectDir = process.cwd();
		const tmpFile = resolve(tmpdir(), `docker-compose.override-${Date.now()}.yml`);
		const envs = existsSync(`${projectDir}/.env`) ? readFileSync(`${projectDir}/.env`, 'utf8').split('\n').filter(l => l.length > 0) : [];
		const haibunEnvc = (envs.length > 0) ? `HAIBUN_ENV=${envs.join(',').replace(/,$/, '')} ` : '';
		const captureDir = resolve(projectDir, 'capture');
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
			`COMMAND_TO_RECORD=${HOST_PROJECT_DIR}="${projectDir}" HAIBUN_LOG_LEVEL=log ${haibunEnvc} ${thisRunOptions.passEnv?.split(',').join(' ') || ""} npm run ${testToRun} -- ${thisRunOptions.featureFilter || ""} ${includeDirs.join(' ')}`
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
		console.log(`Mounting directories:\n${composeVolumes.join('\n')}`);
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
function asYamlOptions(options: string[]) {
	return options.map(o => `      - ${o}`).join('\n');
}

export function parseVCaptureArgs(args: string[], printHelp: (exitCode?: number) => void) {
	const runOptions: TRunOptions = {
		recreate: false,
		tts: false,
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
					runOptions.recreate = recreateValue !== 'false';
					break;
				}
				case '--tts': {
					const ttsValue = value;
					runOptions.tts = ttsValue !== 'false';
					break;
				}
				case '--no-capture': {
					const captureValue = value;
					runOptions.capture = !(captureValue !== 'false');
					break;
				}
				case '--feature-filter': {
					runOptions.featureFilter = value;
					break;
				}
				case '--pass-env': {
					runOptions.passEnv = value;
					break;
				}
				case '--res': {
					if (value && value.match(/^\d+x\d+$/)) {
						runOptions.res = value;
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
	return { runOptions, testToRun, includeDirs };
}
