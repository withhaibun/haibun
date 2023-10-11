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

export const reviewsLD: TRetrievedReviews = {
    test1: [{
        overview: {
            when: '2021-01-01 12:00:00',
            title: 'Eat a plum',
            video: 'https://www.youtube.com/watch?v=1Fg5iWmQjwk',
            ok: true
        },
        steps: [{
            '@type': 'HowToStep',
            description: 'Eat the plum',
            result: true
        },
        {
            '@type': 'HowToStep',
            description: 'Wash your hands',
            result: true
        },
        {
            '@type': 'HowToStep',
            description: 'Dry your hands',
            result: true,
        }]
    }],
    test2: [{
        overview: {
            when: '2021-01-01 12:01:00',
            title: 'Use a bathtub',
            video: 'https://www.youtube.com/watch?v=1Fg5iWmQjwk',
            ok: true

        },
        steps: [{
            '@type': 'HowToStep',
            description: 'fill the bathtub',
            result: true
        },
        {
            '@type': 'HowToStep',
            description: 'get in the bathtub',
            result: true
        },
        {
            '@type': 'HowToStep',
            description: 'wash yourself',
            result: true
        },
        {
            '@type': 'HowToStep',
            description: 'get out of the bathtub',
            result: true
        }
        ]
    }, {
        overview: {
            when: '2021-01-01 09:01:00',
            title: 'Eat a plum',
            video: 'https://www.youtube.com/watch?v=1Fg5iWmQjwk',
            ok: false
        },
        steps: [{
            '@type': 'HowToStep',
            description: 'Eat the plum',
            result: true
        },
        {
            '@type': 'HowToStep',
            description: 'Wash your hands',
            result: true
        },
        {
            '@type': 'HowToStep',
            description: 'Dry your hands',
            result: false,
            report: {
                type: 'a11y',
                html: '<p>Use a towel</p>'
            }
        }]
    }]
};
