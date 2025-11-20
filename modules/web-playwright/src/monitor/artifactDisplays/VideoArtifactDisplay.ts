import { TArtifactVideo } from '@haibun/core/lib/interfaces/logger.js';
import { ArtifactDisplay } from './artifactDisplayBase.js';

export class VideoArtifactDisplay extends ArtifactDisplay {
	readonly placementTarget: 'details' | 'haibun-focus';
	constructor(protected artifact: TArtifactVideo) {
		super(artifact);
		this.placementTarget = document.querySelector('#haibun-focus') ? 'haibun-focus' : 'details';
		if (this.placementTarget === 'details') {
			console.info('Cannot find #haibun-video container; video will be appended to details on toggle.');
		}
	}
	public render(container: HTMLElement): void {
		const videoElement = document.createElement('video');
		videoElement.controls = false;
		videoElement.style.width = '320px';
		videoElement.src = this.artifact.path;
		container.replaceChildren(videoElement);
	}
}
