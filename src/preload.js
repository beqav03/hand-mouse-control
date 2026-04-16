// ─── preload.js ─── Secure bridge between renderer and main process ───

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mouseAPI', {
    moveMouse: (x, y) => ipcRenderer.send('mouse-move', { x, y }),
    leftDown: () => ipcRenderer.send('mouse-left-down'),
    leftUp: () => ipcRenderer.send('mouse-left-up'),
    rightClick: () => ipcRenderer.send('mouse-right-click'),
    scroll: (deltaY) => ipcRenderer.send('mouse-scroll', { deltaY }),
    getScreenSize: () => ipcRenderer.invoke('get-screen-size'),
    onScreenSize: (callback) =>
        ipcRenderer.on('screen-size', (event, data) => callback(data)),
});
