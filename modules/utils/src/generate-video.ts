// generate an editly video from a monitor.json file
import { CHECK_NO, CHECK_YES } from '@haibun/core/build/lib/defs.js';
import { TAnyFixme } from '@haibun/core/build/lib/fixme.js';
import { TArtifactSpeech, TLogArgs, TLogLevel, TMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';
import * as fs from 'fs';

interface LogEntry {
	level: TLogLevel;
	message: TLogArgs;
	messageContext?: TMessageContext;
}

interface EditlyClip {
	duration: number;
	transition: null;
	layers: Array<{
		type: string;
		[key: string]: TAnyFixme;
	}>;
}

interface EditlyConfig {
	outPath: string;
	width: number;
	height: number;
	fps: number;
	clips: EditlyClip[];
}

interface MediaAsset {
	type: string;  // 'video', 'speech', 'start', 'cue'
	path?: string;
	start?: number;
	messageContext?: TMessageContext;
	metadata?: TAnyFixme;
}

const generateEditlyConfig = (logEntries: LogEntry[], outputPath: string, inputFilePath: string): TAnyFixme => {
	// Get the base directory from the input file path to resolve relative paths
	const basePath = inputFilePath.substring(0, inputFilePath.lastIndexOf('/') + 1);
	console.log(`Base path for assets: ${basePath}`);

	// Collect assets and find videoStart
	const assets = { video: [] as MediaAsset[], speech: [] as MediaAsset[], videoStart: undefined as number | undefined };
	for (const entry of logEntries) {
		const startTime = entry.messageContext?.incidentDetails?.result?.actionResult?.start;
		if (assets.videoStart === undefined && entry.messageContext?.artifact?.artifactType === 'video/start' && typeof entry.messageContext.artifact.start === 'number') {
			assets.videoStart = entry.messageContext.artifact.start;
		}
		if (entry.messageContext?.artifact?.artifactType === 'video') {
			const videoPath = entry.messageContext.artifact.path;
			const resolvedPath = `${basePath}${videoPath}`;
			if (!fs.existsSync(resolvedPath)) throw new Error(`Media file not found at ${resolvedPath}`);
			assets.video.push({ type: 'video', path: resolvedPath, start: startTime, messageContext: entry.messageContext, metadata: entry.messageContext.artifact });
		}
		if (entry.messageContext?.artifact?.artifactType === 'speech') {
			const speechPath = entry.messageContext.artifact.path;
			const resolvedPath = `${basePath}${speechPath}`;
			if (!fs.existsSync(resolvedPath)) throw new Error(`Media file not found at ${resolvedPath}`);
			assets.speech.push({ type: 'speech', path: resolvedPath, start: startTime, messageContext: entry.messageContext, metadata: entry.messageContext.artifact });
		}
	}
	if (assets.videoStart === undefined) throw new Error('No video/start artifact found in log.');

	// Print assets
	console.log("\nAssets:");
	console.log("video:", assets.video.map(v => ({ start: v.start, duration: v.metadata?.durationS, path: v.path })));
	console.log("speech:", assets.speech.map(s => ({ start: s.start, duration: s.metadata?.durationS, path: s.path })));
	console.log("videoStart:", assets.videoStart);

	// Find the main video asset
	if (assets.video.length === 0) throw new Error('No video asset found.');
	const mainVideoAsset = assets.video[0];

	// Find the minimum start time among all assets (timeline zero)
	const allStarts = [
		...assets.speech.map(s => s.start ?? 0),
		assets.videoStart ?? 0
	];
	const timelineZero = Math.min(...allStarts);

	// Find FEATURE_END for duration
	let totalDuration = undefined;
	const featureEndEntry = logEntries.find(e => e.messageContext?.incident === 'FEATURE_END' && e.messageContext?.incidentDetails?.totalTime);
	if (featureEndEntry) {
		totalDuration = featureEndEntry.messageContext.incidentDetails.totalTime / 1000;
	}

	// Build layers for the single clip
	const layers: TAnyFixme[] = [];
	for (const speech of assets.speech) {
		const relStartS = ((speech.start ?? 0) - timelineZero) / 1000;
		layers.push({
			type: 'detached-audio',
			path: speech.path,
			cutFrom: 0,
			start: relStartS
		});
	}
	// Video layer uses video/start as its start (relative to timeline zero)
	const videoLayerStart = ((assets.videoStart ?? 0) - timelineZero) / 1000;
	layers.push({
		type: 'video',
		path: mainVideoAsset.path,
		start: videoLayerStart
	});
	layers.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

	const config: TAnyFixme = {
		outPath: outputPath,
		defaults: {
			layer: { fontPath: "/usr/share/fonts/truetype/ubuntu/UbuntuSansMono[wght].ttf" }
		},
		clips: [
			{
				duration: totalDuration,
				layers
			}
		]
	};
	return config;
};

const sanitizeCaption = (text: string) => {
	// Replace common emoji and non-ASCII with ASCII equivalents or remove
	return text
		.replace(CHECK_YES, 'PASS')
		.replace(CHECK_NO, 'FAIL')
	// eslint-disable-next-line no-misleading-character-class
	// .replace(/[▶️]/g, '>')
	// .replace(/[🔵]/g, 'Scenario:')
	// .replace(/[^\x00-\x7F]/g, ''); // Remove any remaining non-ASCII
};

const formatMessage = (entry: LogEntry): string => {
	// Prefer messageContext.incidentDetails.step.in if present
	const stepIn = entry.messageContext?.incidentDetails?.step?.in;
	if (stepIn) {
		return sanitizeCaption(stepIn);
	}
	let prefix = '';
	if (entry.messageContext?.incident === 'SCENARIO_START') {
		prefix = 'Scenario: ';
	} else if (entry.messageContext?.incident === 'STEP_START') {
		prefix = '> ';
	} else if (entry.level === 'debug') {
		prefix = '';
	}
	// Handle transcript if available
	if ((entry.messageContext?.artifact as TArtifactSpeech)?.transcript) {
		return sanitizeCaption(prefix + (entry.messageContext.artifact as TArtifactSpeech).transcript);
	}
	return sanitizeCaption(prefix + entry.message);
};

const main = () => {
	try {
		// Get command line arguments
		const args = process.argv.slice(2);
		const inputFile = args[0] || './monitor.json';
		const outputFile = args[1] || 'haibun-test-video.mp4';
		const configOutput = args[2] || 'editly-config.json';

		console.log(`Input file: ${inputFile}`);
		console.log(`Output video file: ${outputFile}`);
		console.log(`Config output: ${configOutput}`);

		// Read monitor.json
		const logData = fs.readFileSync(inputFile, 'utf-8');
		const logEntries: LogEntry[] = JSON.parse(logData);
		console.log(`Loaded ${logEntries.length} log entries`);

		// Generate editly config
		const editlyConfig = generateEditlyConfig(logEntries, outputFile, inputFile);

		// Write config to file
		fs.writeFileSync(configOutput, JSON.stringify(editlyConfig, null, 2));

		console.log(`\nEditly config written to ${configOutput}`);
		console.log(`To generate video, run: editly ${configOutput}`);

	} catch (error) {
		console.error('Error:', error);
		process.exit(1);
	}
};


main();

export { generateEditlyConfig };
