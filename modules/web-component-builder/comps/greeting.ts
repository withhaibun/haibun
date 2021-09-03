import { css, html, LitElement } from "lit";

    
    export class SimpleGreeting extends LitElement {
      name;
      static get styles() {
        return css`p { color: blue }`;
      }

      static get properties() {
        return {
          name: {type: String}
        }
      }

      constructor() {
        super();
        this.name = 'Somebody';
      }

      render() {
        return html`<p>Hello, ${this.name}!</p>`;
      }
    }