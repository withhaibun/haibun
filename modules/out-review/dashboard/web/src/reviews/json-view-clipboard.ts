import { LitElement, css, html } from 'lit';
import '@alenaksu/json-viewer';
import { property } from 'lit/decorators.js';

class ClipboardCopy extends LitElement {
    // black background css
    static styles = css`:host {
        display: block;
        background-color: black;
        padding: 1px;
        }`;

    @property({ type: String }) json = {};

    render() {
        return html`<div>
      <button @click="${this.copyToClipboard}">📋</button>
      <json-viewer .data=${this.json}></json-viewer>
    <div>`;
    }

    copyToClipboard() {
        const jsonText = JSON.stringify(this.json);
        navigator.clipboard.writeText(jsonText)
            .then(() => console.log('JSON copied to clipboard'))
            .catch(err => console.error('Error in copying JSON: ', err));
    }
}

customElements.define('json-view-clipboard', ClipboardCopy);
