export const AllCSS = `
body: {
  padding: 2em;
}

a, a:visited, a:link, a {
    text-decoration: none;
 }
`;


// from https://stackoverflow.com/questions/70630336/create-css-circles-connected-by-line
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

export const ReviewScript = `
    const video = document.getElementById('video');
    const setVideoTime = n => video.currentTime = n;

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
        document.location.replace('#' + smallest);
    });
    
    const fixVideo = (e) => {
        console.log('pos', videoDiv)
        videoDiv.style.top = 0;
        videoDiv.style.right = 0;
        videoDiv.style.position = 'fixed';
    }

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

    fixVideo();
    document.onscroll = fixVideo;
`