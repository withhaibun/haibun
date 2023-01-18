
try {
    importScripts('./js/background.js');
    console.log('hihi')
} catch (e) {
    console.error(JSON.stringify(e));
}