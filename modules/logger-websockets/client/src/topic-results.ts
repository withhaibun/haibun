// eslint-disable-next-line max-classes-per-file
import { html, LitElement, render } from 'lit';
import { customElement, property, state } from 'lit/decorators';
import {
  GridBodyRenderer,
  GridColumnElement,
  GridItemModel,
} from '@vaadin/vaadin-grid';

import type { TMessageWithTopic } from '@haibun/core/build/lib/interfaces/logger.js';
import { TSeqFeature } from './message-processor';

@customElement('topic-results')
export default class TopicResult extends LitElement {
  @property({ type: Array }) features: TSeqFeature[] = [];

  @property({ type: Array }) topics: TMessageWithTopic[] = [];

  @state()
  private assessmentResultColumnRenderer: GridBodyRenderer<any> =
    this.renderAssessmentResultColumn.bind(this);

  // eslint-disable-next-line class-methods-use-this
  renderAssessmentResultColumn(
    root: HTMLElement,
    _column: GridColumnElement | undefined,
    data: GridItemModel<any> | undefined
  ) {
    const { assessmentResult } = data?.item;
    if (assessmentResult && Object.keys(assessmentResult).length > 0) {
      render(
        html`<details>
          <summary>${assessmentResult.summary}</summary>
          <pre>${JSON.stringify(assessmentResult.details, null, 2)}</pre>
        </details>`,
        root
      );
    }
  }

  @state()
  private mitigationActivityColumnRenderer: GridBodyRenderer<any> =
    this.renderMitigationActivityColumn.bind(this);

  // eslint-disable-next-line class-methods-use-this
  renderMitigationActivityColumn(
    root: HTMLElement,
    _column: GridColumnElement | undefined,
    data: GridItemModel<any> | undefined
  ) {
    const { mitigationActivity } = data?.item;
    if (mitigationActivity && Object.keys(mitigationActivity).length > 0) {
      render(
        html`<details>
          <summary>${mitigationActivity.summary}</summary>
          <pre>${JSON.stringify(mitigationActivity.details, null, 2)}</pre>
        </details>`,
        root
      );
    }
  }

  render() {
    const lines: { [line: string]: TMessageWithTopic[] } = {};
    for (const m of this.topics) {
      if (m.messageTopic.result) {
        const { seq } = m.messageTopic.result;
        lines[seq] = [...(lines[seq] || []), m];
      }
    }
    console.debug(
      'TODO use these',
      this.features
        .map(f => {
          let a = (f as any).line;
          a = a.endsWith('.') ? `\n${a}\n` : a;
          return a;
        })
        .join('\n')
    );

    const data: any[] = [];
    Object.entries(lines).forEach(([, entries]) => {
      const { result } = entries[0].messageTopic;
      const { seq, in: line, actionResults } = result;

      const { name, ok, topics } = actionResults[0];

      if (ok) {
        const evidence = topics?.evidence;
        if (evidence) {
          data.push({
            seq,
            line: line.replace(/ or .*$/, ''),
            name,
            ok: '✅️',
            assessmentResult: { ...evidence },
          });
        }
      } else {
        const { message } = actionResults[0];
        const warning = topics?.warning;
        const response = topics?.response;

        data.push({
          seq,
          line,
          name,
          ok: '❌',
          assessmentResult: warning || { summary: message },
          mitigationActivity: response || undefined,
        });
      }
    });

    return html`
      <vaadin-grid
        .items=${data}
        theme="row-stripes wrap-cell-content"
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
          width="20em"
          flex-grow="0"
          path="line"
          header="Line"
        ></vaadin-grid-column>
        <vaadin-grid-column
          width="8em"
          flex-grow="0"
          path="ok"
          header="Status"
        ></vaadin-grid-column>
        <vaadin-grid-column
          .renderer="${this.assessmentResultColumnRenderer}"
          width="15em"
          flex-grow="0"
          header="Assessment Result"
        ></vaadin-grid-column>
        <vaadin-grid-column
          .renderer="${this.mitigationActivityColumnRenderer}"
          width="15em"
          flex-grow="0"
          header="Mitigation Activity"
        ></vaadin-grid-column>
        <vaadin-grid-column></vaadin-grid-column>
      </vaadin-grid>
    `;
  }
}
