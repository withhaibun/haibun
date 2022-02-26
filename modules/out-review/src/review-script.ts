const ReviewScript = `
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

export default ReviewScript;