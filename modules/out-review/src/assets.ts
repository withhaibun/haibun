export const AllCSS = `
body: {
  padding: 2em;
}

details summary, details[open] {
  border: none !important;
}

a, a:visited, a:link, a {
    text-decoration: none;
}
`;

export const ReviewCSS = `

.review-subresults {
    margin: 0px; 
}

.review-header-fixed {
    position: fixed; top: 0; left: 0; padding: 18px; margin: 0px; background-color: rgba(255,255,255,0.85);
}
.review-header {
  padding-top: 5em;
}

.review-spacer {
    display: inline-block; width: 2.3em;
}

.feature-section {
    padding-top: 480;
}


.review-fixed-video {
    width: 40%; position: fixed; top: 0; right: 0; background-color: black; border: 4px dotted black;
}
.step-result-section {
    margin-left: 40px;
    border-left: 1px dotted grey;
}

.step-result-line {
    display: inline-block; width: 11em; color: #888;
}

.step-result-seq {
    display: inline-block; background: black; color: white; padding: 2px; width: 2em; text-align: right;
}

.trace-current, .step-current {
    background: yellow;
}
` ;

// derived from https://stackoverflow.com/questions/70630336/create-css-circles-connected-by-line
export const StepCircleCSS = `

.index-header {
  padding: 2em;
}

.no-bullets {
  list-style: none
}

*, ::after, ::before { box-sizing: border-box; }

.steplist {
  border-top: 2px solid #ccc;
  display: inline-flex;
  font-family: 'Gill Sans', 'Gill Sans MT', Calibri, 'Trebuchet MS', sans-serif;
  list-style-type: none;
  gap: 7em;
  margin: 0;
  padding: 0;
  --circle-radius: 8px;
}

.steplist li {
  color: #999;
  cursor: pointer;
  padding: calc(5px + var(--circle-radius)) 0 0;
  margin: 0;
  position: relative;
  text-align: center;
}

.steplist li::before {
  background-color: #ccc;
  border-radius: 50%;
  content: '';
  position: absolute;
  height: calc(2 * var(--circle-radius));
  width: calc(2 * var(--circle-radius));
  top: 0;
  left: 50%;
  transform: translate(-50%, -50%);
  transition: all 0.3s ease;
}

.steplist .failed {
  color: black;
}

.steplist .failed::before {
  background-color: red;
  box-shadow: 0 0 0 3px rgba(255,0,0,.25);
}

.steplist .passed {
  color: black;
}

.steplist .passed::before {
  background-color: green;
  box-shadow: 0 0 0 3px rgba(0,255,0,.25);
}

.steplist li:first-child::after {
  background-color: white;
  content: '';
  position: absolute;
  height: 2px;
  width: 100%;
  top: -2px;
  left: calc(-50% - var(--circle-radius));
}

.steplist li:last-child::after {
  background-color: white;
  content: '';
  position: absolute;
  height: 2px;
  width: 100%;
  top: -2px;
  left: calc(50% + var(--circle-radius));
}

.circle-big {
  --circle-radius: 12px;
}
`;

export const ReviewScript = (startOffset: number) => {

  return `
const startOffset = ${startOffset};
const video = document.getElementById('video');
const videoDiv = document.getElementById('videoDiv');
const setVideoTime = n => {
  video.currentTime = n - startOffset;
  document.location.replace('#i' + n);
}
let lastTrace;
const nowlink = document.URL.split('#i')[1];
if (nowlink) {
  setVideoTime(nowlink);
}

video.addEventListener('timeupdate', (event) => {
    let closest = [];
    const ct = video.currentTime + startOffset;
    document.querySelectorAll("[data-time]").forEach(d => {
        let colour = 'none';

        if (parseFloat(d.dataset.time) >= ct) {
            closest.push(d);
            colour = '#ffe5b4';
        }
        d.style.background = colour;
    });
    let smallest = Infinity;
    closest.forEach(c => {
        if (parseFloat(c.dataset.time) < smallest) {
            smallest = parseFloat(c.dataset.time);
        }
    });

    closest.forEach(c => {
        if (parseFloat(c.dataset.time) === smallest) {
            c.style.background = 'yellow';
        }
    })
    const id = 'i' + smallest;
    const el = document.getElementById(id);

    if (lastTrace) {
      lastTrace.innerHTML = '';
    }
    if (el) {
      // open details 
      const start = el.dataset.start;
      const whereto = 'start-' + start;
      document.getElementById(whereto).scrollIntoView({behavior: "smooth", block: "center"});
      lastTrace = document.getElementById('current-' + start);

      if (lastTrace) {
        if (!lastTrace.parentNode.parentNode.open) {
          lastTrace.innerHTML = el.innerHTML;
        }
      }
    }
});

document.onkeydown = function (e) {
    if (e.keyCode === 32) {
        if (video.paused) {
            video.play();
        } else {
            video.pause();
        }
        return false;
    }
}
`;
}