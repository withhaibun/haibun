// generate an editly video from a monitor.json file
import { TAnyFixme } from '@haibun/core/build/lib/fixme.js';
import { TArtifactVideoStart, TLogArgs, TLogLevel, TMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';
import { getMediafileDuration } from '@haibun/core/build/steps/lib/tts.js';
import * as fs from 'fs';

interface LogEntry {
	level: TLogLevel;
	message: TLogArgs;
	messageContext?: TMessageContext;
}
interface MediaAsset {
	type: string;  // 'video', 'speech', 'start', 'cue'
	path?: string;
	start?: number;
	messageContext?: TMessageContext;
	metadata?: TAnyFixme;
}

const generateEditlyConfig = async (logEntries: LogEntry[], outputPath: string, inputFilePath: string, title: string): Promise<TAnyFixme> => {
	// Get the base directory from the input file path to resolve relative paths
	const basePath = inputFilePath.substring(0, inputFilePath.lastIndexOf('/') + 1);
	console.log(`Base path for assets: ${basePath}`);

	// Collect assets and find videoStart
	const assets = { video: [] as MediaAsset[], speech: [] as MediaAsset[], featureStart: undefined as number };
	for (const entry of logEntries) {
		const startTime = entry.messageContext?.incidentDetails?.result?.actionResult?.start;
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
	// Extract featureStart from FEATURE_START's incidentDetails.startTime
	const featureStartEntry = logEntries.find(e => e.messageContext?.incident === 'FEATURE_START' && e.messageContext?.incidentDetails?.startTime);
	if (featureStartEntry) {
		assets.featureStart = featureStartEntry.messageContext.incidentDetails.startTime;
	}
	const featureEndEntry = logEntries.find(e => e.messageContext?.incident === 'FEATURE_END' && e.messageContext?.incidentDetails?.totalTime);
	const totalDuration = featureEndEntry.messageContext.incidentDetails.totalTime / 1000;

	if (!featureEndEntry) throw new Error('No FEATURE_END with totalTime found in log.');
	// Find the main video asset
	if (assets.video.length === 0) throw new Error('No video asset found.');
	const mainVideoAsset = assets.video[0];

	const videoFileDuration = await getMediafileDuration(mainVideoAsset.path!);
	if (!assets.featureStart) throw new Error('No FEATURE_START with startTime found in log.');
	const videoLayerStart = totalDuration - videoFileDuration;
	const videoStartFromArtifact = (logEntries.find(e => e.messageContext?.artifact?.artifactType === 'video/start').messageContext.artifact as TArtifactVideoStart).start / 1000;


	console.info("\nAssets:");
	console.info("video:", assets.video.map(v => ({ start: v.start, path: v.path })));
	console.info("speech:", assets.speech.map(s => ({ start: s.start, path: s.path })));
	console.info("featureStart", assets.featureStart);
	console.info("totalDuration", totalDuration);
	console.info("videoFileDuration", videoFileDuration);
	console.info("videoLayerStart", videoLayerStart);
	console.info('videoStartFromArtifact', videoStartFromArtifact);

	// this is subject to wobble, videoLayerStart or videoStartFromArtifact are forays
	const videoStart = videoStartFromArtifact;

	// Build layers for the single clip
	const layers: TAnyFixme[] = [];
	layers.push({
		type: 'title',
		text: title,
		textColor: '#cccccc',
		backgroundColor: '#222',
		position: 'center',
		start: 0,
		duration: videoStart,
		fadeIn: 0,
		transition: null
	});
	for (const speech of assets.speech) {
		layers.push({
			type: 'detached-audio',
			path: speech.path,
			cutFrom: 0,
			start: speech.start / 1000,
			mixVolume: 100
		});
	}
	layers.push({
		type: 'video',
		path: mainVideoAsset.path,
		start: videoStart
	});
	// Sort layers by their start time (if present)
	layers.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

	const config: TAnyFixme = {
		outPath: outputPath,
		defaults: {
			layer: {
				// fontPath: "/usr/share/fonts/truetype/ubuntu/UbuntuSansMono[wght].ttf"
			}
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

const main = async () => {
	try {
		if (process.argv.length < 5) {
			console.error('Usage: node generate-video.js <inputFile> <outputFile> <configOutput> <title>');
			process.exit(1);
		}
		const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));
		const args = process.argv.slice(2);
		const inputFile = args[0];
		const outputFile = args[1];
		const configOutput = args[2];
		const title = args[3] || packageJson?.description || packageJson?.name;

		console.info(args)
		console.info(`Input file: ${inputFile}`);
		console.info(`Output video file: ${outputFile}`);
		console.info(`Config output: ${configOutput}`);
		console.info('Title:', title);

		// Read monitor.json
		const logData = fs.readFileSync(inputFile, 'utf-8');
		const logEntries: LogEntry[] = JSON.parse(logData);
		console.log(`Loaded ${logEntries.length} log entries`);

		// Generate editly config
		const editlyConfig = await generateEditlyConfig(logEntries, outputFile, inputFile, title);

		// Write config to file
		fs.writeFileSync(configOutput, JSON.stringify(editlyConfig, null, 2));

		console.info(`\nEditly config written to ${configOutput}`);

	} catch (error) {
		console.error('Error:', error);
		process.exit(1);
	}
};

main().catch((error) => {
	console.error('Error in main function:', error);
});

