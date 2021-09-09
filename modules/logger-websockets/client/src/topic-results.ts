// eslint-disable-next-line max-classes-per-file
import { customElement, html, LitElement, property, state } from 'lit-element';
import type { TMessageWithTopic } from '@haibun/core/build/lib/interfaces/logger';
import {
  GridBodyRenderer,
  GridColumnElement,
  GridItemModel,
} from '@vaadin/vaadin-grid';
import { render } from 'lit';

@customElement('topic-results')
export default class TopicResult extends LitElement {
  @property({ type: Array }) topics: TMessageWithTopic[] = [];

  @state()
  private evidenceColumnRenderer: GridBodyRenderer<any> =
    this.renderEvidenceColumn.bind(this);

  // eslint-disable-next-line class-methods-use-this
  renderEvidenceColumn(
    root: HTMLElement,
    _column: GridColumnElement | undefined,
    data: GridItemModel<any> | undefined
  ) {
    const { evidence } = data?.item;

    if (evidence && Object.keys(evidence).length > 0) {
      render(
        html`<details>
          <summary>Details</summary>
          ${JSON.stringify(evidence)}
        </details>`,
        root
      );
    }
  }

  render() {
    const lines: { [line: string]: TMessageWithTopic[] } = {};
    for (const m of this.topics) {
      const { seq } = m.messageTopic!;
      lines[seq] = [...(lines[seq] || []), m];
    }

    const data: any[] = [];
    Object.entries(lines).forEach(([, entries]) => {
      const { result } = entries[0].messageTopic.topics;
      const { seq, in: line, actionResults } = result;

      const { name, ok, topics } = actionResults[0];
      console.log(name, !['set', 'onPage', 'isSet'].includes(name));

      if (!['set', 'onPage', 'isSet'].includes(name)) {
        const evidence = topics ? topics.evidence : '';
        data.push({ seq, line, name, ok, evidence });
      }
    });

    return html`
      <vaadin-grid
        .items=${data}
        theme="column-borders"
        aria-label="Content Renderer Function"
      >
        <vaadin-grid-column
          width="8em"
          flex-grow="0"
          path="seq"
          header="Sequence"
        ></vaadin-grid-column>
        <vaadin-grid-column
          width="12em"
          flex-grow="0"
          path="name"
          header="Name"
        ></vaadin-grid-column>
        <vaadin-grid-column
          width="30em"
          flex-grow="0"
          path="line"
          header="Line"
        ></vaadin-grid-column>
        <vaadin-grid-column
          width="8em"
          flex-grow="0"
          path="ok"
          header="ok"
        ></vaadin-grid-column>
        <vaadin-grid-column
          .renderer="${this.evidenceColumnRenderer}"
          width="30em"
          flex-grow="0"
          header="Evidence"
        ></vaadin-grid-column>
        <vaadin-grid-column></vaadin-grid-column>
      </vaadin-grid>
    `;
  }
}
