import { TArtifactJSON } from "@haibun/core/build/lib/interfaces/logger.js";
import { ArtifactDisplay } from "./artifactDisplayBase.js";
import { disclosureJson } from "../disclosureJson.js";

export class JsonArtifactDisplay extends ArtifactDisplay {
    readonly placementTarget = 'details'; // This artifact is always placed in details
    constructor(protected artifact: TArtifactJSON) {
        super(artifact); // type is 'json' by default from TArtifactJSON
        // Element creation is deferred to render method
    }
    public render(container: HTMLElement): void {
        const preElement = document.createElement('pre');
        preElement.classList.add('haibun-message-details-json');
        preElement.appendChild(disclosureJson(this.artifact.json || {}));
        container.replaceChildren(preElement); // Clear placeholder and add json content
    }
}
