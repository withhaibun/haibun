import { create } from 'xmlbuilder2';
import { EOL } from 'os';

import { TResult, TResultOutput, TTrace, TWorld } from '@haibun/core/build/lib/defs';
import { AStorage } from '@haibun/domain-storage/build/defs';
import { getCaptureDir } from '@haibun/core/build/lib/util';

const SCRIPT = `
const video = document.getElementById('video');
const setTime = n => video.currentTime = n;

video.addEventListener('timeupdate', (event) => {
    let closest = [];
    const ct = video.currentTime;
    document.querySelectorAll("[data-time]").forEach(d => {
        let colour = 'none';
        
        if (d.dataset.time >= ct) {
            closest.push(d);
            colour = 'orange';
        }
        d.style.background = colour;
    });
    let smallest = 9999999;
    closest.forEach(c => {
        if (c.dataset.time < smallest) {
            smallest = c.dataset.time;
        }
    });

    closest.forEach(c => {
        const diff = ct - c.dataset.time;
        if (c.dataset.time === smallest) {
            c.style.background = 'yellow';
        }
    })
});

document.onkeydown = function(e){
    if (e.keyCode === 32) {
        if (video.paused) {
            video.play();
        } else {
            video.pause();
        }
        return false;
    }
}
`

export default class GenerateReview implements TResultOutput {
  file: string = '<not initialized"';
  async getOutput(storage: AStorage, world: TWorld, result: TResult, { title = 'Haibun-Review', prettyPrint = true, uriArgs = '' }) {
    const { sequence } = result.tag;
    const videoBase = getCaptureDir(world, 'video');
    const video = await storage.readdir(videoBase)[0];
    const forHTML: any = {
      html: {
        "@xmlns": "http://www.w3.org/1999/xhtml",
        "@style": "font-family: 'Open Sans', sans-serif",
        link: {
          '@href': "https://fonts.googleapis.com/css2?family=Open+Sans&display=swap",
          '@rel': "stylesheet"
        },
        title,
        div: {
          '@style': 'position: fixed; top: 0, background-color: rgba(255,255,255,0.5), width: 100%',
          video: {
            '@id': 'video',
            '@controls': true,
            '@height': '480',
            '@width': '100%',
            source: {
              '@type': 'video/webm',
              '@src': `video/${video}${uriArgs}`
            }
          },
        },
        section: {
          '@style': 'padding-top: 480',
          div: []
        },
        script: {
          '@type': 'text/javascript',
          '#': '{{SCRIPT}}'
        },
      }
    }


    const feature: any = {
      div: {
        '@style': 'border-top: 1px dotted grey; padding-top: 4em',
        a: {
          '#': `Result: ${result.ok}`,
        },
        div: []
      }
    }
    for (const f of result.results!) {
      for (const s of f.stepResults) {
        for (const a of s.actionResults) {
          const start = (a as any).start;
          const o = {
            '@style': 'padding-top: 1em',
            a: {
              '@data-time': start,
              '@onclick': `setTime(${start})`,
              b: {
                b: {
                  '#': `<<  `,
                  span: [{
                    '@style': 'background: black; color: white; padding: 5, width: 3em; text-align: right',
                    '#': `${s.seq}`,
                  },
                  {
                    '#': `${a.ok} ${a.name} ${s.in}  `
                  }]

                }
              }
            },
            details: [(a.topics && {
              '#': JSON.stringify(a.topics),
              summary: {
                '#': 'topics'
              },
            }),
            ((a as any).traces && {
              '#': traces(a),
              summary: {
                '#': 'trace'
              },
            }),
            ]
          }
          feature.div.div.push(o);
        }
      }
    }

    forHTML.html.section.div.push(feature);
    const created = create(forHTML).end({ prettyPrint, newline: EOL });
    const html = this.finish(created);
    return { html, sequence, video };
  }
  finish(html: string) {
    html = html.replace('{{SCRIPT}}', SCRIPT);
    return html;
  }
  async writeOutput(result: TResult, args: any) {
    return `wrote to ${this.file}`;
  }
}

const traces = (a: any) => {
  const { traces } = a;
  const byUrl = (traces as TTrace[]).map((i) => ({ url: i.response.trace.url, since: i.response.since, headersContent: i.response.trace.headersContent }));

  const ret = byUrl.map(({ url, since, headersContent }) => {
    const summary = {
      a: {
        '@data-time': since,
        '@onclick': `setTime(${since})`,
        '#': `${since} ${url}`,
      }
    }
    const ul = (headersContent as any).map((i: any) => ({
      li:
      {
        '#': `${i.name}: ${i.value}`
      }
    }));

    return {
      details: {
        ul,
        summary
      }
    }
  });
  return ret;
}
