const ReviewScript = `
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
`;

export default ReviewScript;