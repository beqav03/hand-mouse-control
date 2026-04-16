// ─── main.js ─── Electron Main Process ───
// Handles native mouse control via IPC from the renderer

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

let mainWindow;
let nutMouse = null;
let nutKeyboard = null;

// ─── Load nut-js lazily ───
async function loadNut() {
    try {
        const nut = require('@nut-tree-fork/nut-js');
        nut.mouse.config.autoDelayMs = 0;
        nut.mouse.config.mouseSpeed = 0; // instant movement
        nutMouse = nut.mouse;
        nutKeyboard = nut.keyboard;
        console.log('✅ nut-js loaded successfully');
        return true;
    } catch (err) {
        console.error('❌ Failed to load nut-js:', err.message);
        return false;
    }
}

// ─── Create Window ───
function createWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

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
        },
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    // Send screen size to renderer
    mainWindow.webContents.on('did-finish-load', () => {
        const { width: sw, height: sh } = screen.getPrimaryDisplay().size;
        mainWindow.webContents.send('screen-size', { width: sw, height: sh });
    });
}

// ─── IPC Handlers for Mouse Control ───
function setupIPC() {
    // Move mouse to absolute position
    ipcMain.on('mouse-move', async (event, { x, y }) => {
        if (!nutMouse) return;
        try {
            const { Point } = require('@nut-tree-fork/nut-js');
            await nutMouse.setPosition(new Point(Math.round(x), Math.round(y)));
        } catch (e) {
            /* ignore movement errors */
        }
    });

    // Left mouse button down
    ipcMain.on('mouse-left-down', async () => {
        if (!nutMouse) return;
        try {
            const { Button } = require('@nut-tree-fork/nut-js');
            await nutMouse.pressButton(Button.LEFT);
        } catch (e) {
            console.error('left-down error:', e.message);
        }
    });

    // Left mouse button up
    ipcMain.on('mouse-left-up', async () => {
        if (!nutMouse) return;
        try {
            const { Button } = require('@nut-tree-fork/nut-js');
            await nutMouse.releaseButton(Button.LEFT);
        } catch (e) {
            console.error('left-up error:', e.message);
        }
    });

    // Right mouse click
    ipcMain.on('mouse-right-click', async () => {
        if (!nutMouse) return;
        try {
            const { Button } = require('@nut-tree-fork/nut-js');
            await nutMouse.click(Button.RIGHT);
        } catch (e) {
            console.error('right-click error:', e.message);
        }
    });

    // Scroll up/down
    ipcMain.on('mouse-scroll', async (event, { deltaY }) => {
        if (!nutMouse) return;
        try {
            const amount = Math.round(deltaY);
            if (amount > 0) {
                await nutMouse.scrollDown(Math.abs(amount));
            } else if (amount < 0) {
                await nutMouse.scrollUp(Math.abs(amount));
            }
        } catch (e) {
            console.error('scroll error:', e.message);
        }
    });

    // Get screen dimensions
    ipcMain.handle('get-screen-size', () => {
        const { width, height } = screen.getPrimaryDisplay().size;
        return { width, height };
    });
}

// ─── App Lifecycle ───
app.whenReady().then(async () => {
    await loadNut();
    setupIPC();
    createWindow();
});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
