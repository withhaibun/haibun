import path from "path";

import { CAPTURE, TAnyFixme, TFeatureResult, TTag } from "@haibun/core/build/lib/defs.js";
import { getFeatureTitlesFromResults, getRunTag } from "@haibun/core/build/lib/util/index.js";
import { AStorage } from "@haibun/domain-storage/build/AStorage.js";
import { TLocationOptions, EMediaTypes, TMissingTracks, TTrackResult, guessMediaExt } from "@haibun/domain-storage/build/domain-storage.js";
import HtmlGenerator, { TFeatureSummary, TIndexSummary, TIndexSummaryResult, TStepSummary, TSummaryItem } from "../html-generator.js";
import { ReviewScript } from "../assets.js";
import { INDEXED, MISSING_TRACKS, MISSING_TRACKS_FILE } from "../out-reviews-stepper.js";
import { ILogger } from "@haibun/core/build/lib/interfaces/logger.js";
import { toc } from "../components/index/toc.js";

export class ReviewsUtils {
    tracksStorage: AStorage;
    reviewsStorage: AStorage;
    indexStorage: AStorage;
    publishStorage: AStorage;
    logger: ILogger;
    uriArgs: string;

    constructor(logger: ILogger, trackStorage: AStorage, reviewsStorage: AStorage, publishStorage: AStorage, indexStorage: AStorage, uriArgs?: string) {
        this.logger = logger;
        this.tracksStorage = trackStorage;
        this.reviewsStorage = reviewsStorage;
        this.publishStorage = publishStorage;
        this.indexStorage = indexStorage;
        this.uriArgs = uriArgs;
    }
    async getMemberEntries(dest: string): Promise<{ tag: TTag, memDir: string, loc: TLocationOptions }[]> {
        const reviewsIn = this.tracksStorage;
        const n = (i: string) => {
            return parseInt(i.replace(/.*-/, ''));
        }

        const allTracks = [];
        const start = this.tracksStorage.fromCaptureLocation(EMediaTypes.html, dest);

        const executions = await reviewsIn.readdir(start);
        for (const execution of executions) {
            const loops = await reviewsIn.readdir(`${start}/${execution}`);
            for (const loop of loops) {
                const loopDir = `${start}/${execution}/${loop}`;
                const sequences = await reviewsIn.readdir(loopDir);
                for (const seq of sequences) {
                    const seqDir = `${loopDir}/${seq}`;
                    const featureNums = await reviewsIn.readdir(seqDir)
                    for (const featureNum of featureNums) {
                        const featDir = `${seqDir}/${featureNum}`;
                        const members = await reviewsIn.readdir(featDir);
                        for (const member of members) {
                            const memDir = `${featDir}/${member}`;
                            const tag = { ...getRunTag(n(seqDir), n(loopDir), n(featDir), n(memDir)), when: execution };
                            allTracks.push({ tag, memDir });
                        }
                    }
                }
            }
        }
        return allTracks;
    }
    // find parseable artifacts from known tracks
    async findArtifacts(fromWhere: AStorage, filter?: string) {
        const dir = await fromWhere.readdirStat(`./${CAPTURE}`);
        const found: string[] = [];
        const dirs = dir.filter(e => e.isDirectory);
        for (const entry of dirs) {
            const entryDir = entry.name.replace(/.*\//, '');
            if (entryDir === 'sarif') {
                found.push(`${INDEXED}:${entryDir}`);
            } else if (entry.isDirectory) {
                const executions = await fromWhere.readdirStat(`${entry.name}`);
                for (const execution of executions) {
                    const loops = await fromWhere.readdirStat(`${execution.name}`)
                    const loop = loops.map(e => e.name.replace(/.*\//, '')).find(e => e === 'loop-1');

                    if (loop) {
                        found.push(entryDir);
                    }
                }
            }
        }
        return filter ? found.filter(f => !f.includes(filter)) : found;
    }
    // indexes.json is created by @haibun/sarif
    async getIndexedResults(dir: string) {
        const file = this.indexStorage.fromCaptureLocation(EMediaTypes.json, dir, 'indexed.json');
        let contents;
        try {
            contents = await this.indexStorage.readFile(file);
            const indexSummary: TIndexSummary = JSON.parse(contents);
            return indexSummary;
        } catch (e) {
            this.logger.error(`can't parse indexedResults ${file}: ${e} from ${contents}`);
            throw (e);
        }
    }
    getWorld() {
        throw new Error("Method not implemented.");
    }
    async getReviewSummary(dir: string) {
        const res: Partial<TIndexSummary> = {
            indexTitle: 'no title yet',
            results: <TIndexSummaryResult[]>[]
        }

        const locs = await this.getMemberEntries(dir);

        for (const { memDir, tag } of locs) {
            const tracksDir = `${memDir}/tracks`;
            if (!this.publishStorage.exists(tracksDir)) {
                continue;
            }
            const tracks = await this.readTracksFile(tracksDir);

            const { result, meta } = (<TTrackResult>tracks);
            const { title: indexTitle, startTime } = meta;
            res.indexTitle = indexTitle;
            const featureTitles = getFeatureTitlesFromResults(result);

            if (result !== undefined) {
                const loc: TLocationOptions = { tag, options: { DEST: dir }, extraOptions: {}, mediaType: EMediaTypes.html }
                const r = {
                    ok: result.ok,
                    sourcePath: await this.publishStorage.getCaptureLocation(loc, 'review.html'),
                    startTime: new Date(startTime).toString(),
                    featureTitle: featureTitles.join(','),
                    memDir
                }
                console.log('qrr;', r.sourcePath, loc)

                res.results.push(r);
            } else {
                res.results.push({ error: `no result`, ok: false, memDir });
            }
        }
        return res as TIndexSummary;
    }
    async readTracksFile(where: string): Promise<TTrackResult | TMissingTracks> {
        try {
            const tracks = this.tracksStorage;
            const output = await tracks.readFile(where + '/tracks.json', 'utf-8');
            const result = JSON.parse(output);
            return result;
        } catch (e) {
            return {
                error: (<TAnyFixme>e).toString()
            };
        }
    }

    async getFeatureDisplay(tracksDoc: TTrackResult | TMissingTracks, htmlGenerator: HtmlGenerator, loc: TLocationOptions, dir: string) {
        if ((tracksDoc as TMissingTracks).error) {
            const dir = await this.reviewsStorage.getCaptureLocation(loc);
            return { featureJSON: htmlGenerator.getFeatureError(dir, (tracksDoc as TMissingTracks).error), script: undefined };
        } else {
            const { startOffset } = (<TTrackResult>tracksDoc).meta;
            const featureTitle = getFeatureTitlesFromResults((<TTrackResult>tracksDoc).result).join(',');
            const tracksResult = await this.tracksToSummaryItem(loc, this.tracksStorage, <TTrackResult>tracksDoc, dir);
            return { featureJSON: htmlGenerator.getFeatureResult(tracksResult as TFeatureSummary, featureTitle), script: ReviewScript(startOffset) };
        }
    }
    async recurseCopy({ src, fromFS, toFS, toFolder, trimFolder }: { src: string, fromFS: AStorage, toFS: AStorage, toFolder?: string, trimFolder?: string }) {
        const entries = await fromFS.readdirStat(src);

        for (const entry of entries) {
            const here = entry.name;
            if (entry.isDirectory) {
                await this.recurseCopy({ src: here, fromFS, toFS, toFolder, trimFolder });
            } else {
                const content = await fromFS.readFile(here);
                const ext = <EMediaTypes>guessMediaExt(entry.name);

                const trimmed = trimFolder ? here.replace(trimFolder, '') : here;
                const dest = toFS.pathed(ext, toFolder ? `${toFolder}/${trimmed}`.replace(/\/\//, '/') : trimmed);
                await toFS.mkdirp(path.dirname(dest));
                await toFS.writeFile(dest, content, ext);
            }
        }
    }
    async tracksToSummaryItem(loc: TLocationOptions, storage: AStorage, tracks: TTrackResult | typeof MISSING_TRACKS, dir: string): Promise<TSummaryItem> {
        const { result, meta } = (<TTrackResult>tracks);
        const { title, startTime } = meta;
        const videoBase = await this.tracksStorage.getCaptureLocation(loc, 'video');
        let videoSrc: string | undefined = undefined;
        try {
            const file = (await storage.readdir(videoBase))[0];
            videoSrc = this.publishStorage.pathed(EMediaTypes.video, await this.publishStorage.getCaptureLocation(loc, 'video') + `/${file}`, dir);
        } catch (e) {
            // there is no video file
        }

        if (!result) {
            return { title, startTime, sourcePath: MISSING_TRACKS_FILE, ok: false, subResults: [] }
        } else {
            const i: Partial<TSummaryItem> = { videoSrc, title, startTime, sourcePath: result.path, ok: result.ok, subResults: [] }
            for (const stepResult of (result as TFeatureResult).stepResults) {
                for (const actionResult of stepResult.actionResults) {
                    const sr: Partial<TSummaryItem> = {
                        start: (actionResult as TAnyFixme).start, seq: stepResult.seq, in: stepResult.in,
                        sourcePath: stepResult.sourcePath,
                        ok: actionResult.ok, name: actionResult.name, topics: actionResult.topics, traces: actionResult.traces
                    };
                    i.subResults?.push(sr as TStepSummary);
                }
            }
            return i as TSummaryItem;
        }
    }

    async getReviewsResults(indexDirs: string[]) {
        const htmlGenerator = new HtmlGenerator(this.uriArgs);
        const results: { ok: boolean; link: string; index: TIndexSummary[]; dir: string; }[] = [];

        let success = 0;
        let fail = 0;

        console.log('wtw', indexDirs)
        for (const spec of indexDirs) {
            const [type, dirIn] = spec.split(':');
            const dir = dirIn || type;
            const summary: TIndexSummary = await (type === INDEXED ? this.getIndexedResults(dir) : this.getReviewSummary(dir));

            const ok = !!summary.results.every(r => r.ok);
            success += summary.results.filter(r => r.ok).length;
            fail += summary.results.filter(r => !r.ok).length;
            const toDir = this.publishStorage.pathed(EMediaTypes.html, dir, `./${CAPTURE}`)
            console.log('toDir', summary, spec, dir, toDir);
            const index = toc(summary, toDir, this.uriArgs);

            results.push({ ok, dir, link: htmlGenerator.linkFor(dir), index });
        }

        return { fail, success, results };
    }
}
