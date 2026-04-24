// preload.js — context-isolated bridge between renderer and main.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mouseAPI', {
    moveMouse: (x, y) => ipcRenderer.send('mouse-move', { x, y }),
    leftDown: () => ipcRenderer.send('mouse-left-down'),
    leftUp: () => ipcRenderer.send('mouse-left-up'),
    rightClick: () => ipcRenderer.send('mouse-right-click'),
    scroll: (deltaY) => ipcRenderer.send('mouse-scroll', { deltaY }),
    getScreenSize: () => ipcRenderer.invoke('get-screen-size'),
    onScreenSize: (callback) =>
        ipcRenderer.on('screen-size', (_e, data) => callback(data)),
    onToggleTracking: (callback) =>
        ipcRenderer.on('toggle-tracking', () => callback()),
    onForceStop: (callback) =>
        ipcRenderer.on('force-stop', () => callback()),
});
