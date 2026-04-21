// main.js — Electron main process.
// Bridges native mouse/keyboard control and global hotkeys to the renderer.

const {
    app,
    BrowserWindow,
    ipcMain,
    screen,
    globalShortcut,
    session,
} = require('electron');
const path = require('path');

let mainWindow;
let nutMouse = null;
let nutKeyboard = null;
let NutPoint = null;
let NutButton = null;

const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "connect-src 'self' blob:",
    "worker-src 'self' blob:",
    "font-src 'self'",
].join('; ');

async function loadNut() {
    try {
        const nut = require('@nut-tree-fork/nut-js');
        nut.mouse.config.autoDelayMs = 0;
        nut.mouse.config.mouseSpeed = 0;
        nutMouse = nut.mouse;
        nutKeyboard = nut.keyboard;
        NutPoint = nut.Point;
        NutButton = nut.Button;
        console.log('nut-js loaded');
        return true;
    } catch (err) {
        console.error('Failed to load nut-js:', err.message);
        return false;
    }
}

function createWindow() {
    const { width } = screen.getPrimaryDisplay().workAreaSize;

    mainWindow = new BrowserWindow({
        width: 420,
        height: 680,
        x: width - 440,
        y: 20,
        resizable: true,
        alwaysOnTop: true,
        frame: true,
        transparent: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.webContents.on('did-finish-load', () => {
        const { width: sw, height: sh } = screen.getPrimaryDisplay().size;
        mainWindow.webContents.send('screen-size', { width: sw, height: sh });
    });
}

function setupIPC() {
    ipcMain.on('mouse-move', async (_event, { x, y }) => {
        if (!nutMouse || !NutPoint) return;
        try {
            await nutMouse.setPosition(
                new NutPoint(Math.round(x), Math.round(y)),
            );
        } catch {
            // movement errors (off-screen, race) are non-fatal
        }
    });

    ipcMain.on('mouse-left-down', async () => {
        if (!nutMouse || !NutButton) return;
        try {
            await nutMouse.pressButton(NutButton.LEFT);
        } catch (e) {
            console.error('left-down error:', e.message);
        }
    });

    ipcMain.on('mouse-left-up', async () => {
        if (!nutMouse || !NutButton) return;
        try {
            await nutMouse.releaseButton(NutButton.LEFT);
        } catch (e) {
            console.error('left-up error:', e.message);
        }
    });

    ipcMain.on('mouse-right-click', async () => {
        if (!nutMouse || !NutButton) return;
        try {
            await nutMouse.click(NutButton.RIGHT);
        } catch (e) {
            console.error('right-click error:', e.message);
        }
    });

    ipcMain.on('mouse-scroll', async (_event, { deltaY }) => {
        if (!nutMouse) return;
        try {
            const amount = Math.round(deltaY);
            if (amount > 0) await nutMouse.scrollDown(Math.abs(amount));
            else if (amount < 0) await nutMouse.scrollUp(Math.abs(amount));
        } catch (e) {
            console.error('scroll error:', e.message);
        }
    });

    ipcMain.handle('get-screen-size', () => {
        const { width, height } = screen.getPrimaryDisplay().size;
        return { width, height };
    });
}

function attachCSP() {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [CSP],
            },
        });
    });
}

async function forceReleaseLeft() {
    if (!nutMouse || !NutButton) return;
    try {
        await nutMouse.releaseButton(NutButton.LEFT);
    } catch {
        // best-effort panic release
    }
}

function registerHotkeys() {
    globalShortcut.register('CommandOrControl+Shift+H', () => {
        if (mainWindow) mainWindow.webContents.send('toggle-tracking');
    });
    globalShortcut.register('CommandOrControl+Shift+Escape', async () => {
        await forceReleaseLeft();
        if (mainWindow) mainWindow.webContents.send('force-stop');
    });
}

app.whenReady().then(async () => {
    attachCSP();
    await loadNut();
    setupIPC();
    createWindow();
    registerHotkeys();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

// nutKeyboard is intentionally loaded but unused for now — reserved for future
// keyboard-gesture features. Mark as referenced so lint doesn't complain.
void nutKeyboard;
