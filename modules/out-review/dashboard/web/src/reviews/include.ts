import { css } from 'lit';

export const globalStyles = css`
    a {
      text-decoration: none;
    }
    a :hover {
      text-decoration: underline;
    }
    h1 a {
      font-size: 80%;
    }
  `;

export type TStep = { '@type': string, description: string, result: boolean, report?: { html: string, type: string } };
export type TReview = {
    overview: { title: string, when: string, video: string, ok: true | false },
    steps: TStep[]
};

export type TRetrievedReviews = {
    [source: string]: TReview[]
}

