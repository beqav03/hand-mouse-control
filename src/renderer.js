// renderer.js — runs in the BrowserWindow. Reads MediaPipe hand landmarks,
// maps them to cursor/click/scroll events, and forwards actions to main via
// the `mouseAPI` preload bridge.
//
// MediaPipe globals (Hands, Camera) are loaded by vendored scripts in
// index.html before this file.

// ─── State ───────────────────────────────────────────────────────────
const SETTINGS_KEY = 'handmouse.settings';

let isTracking = false;
let screenW = 1920;
let screenH = 1080;
let camera = null;
let activeStream = null;

let smoothX = 0;
let smoothY = 0;
let hasSmoothSample = false;

let isLeftDown = false;
let rightClickCooldown = false;
let rightClickTimer = null;
let isScrolling = false;
let scrollBaseY = 0;

let frameCount = 0;
let lastFpsTime = performance.now();

let sensitivity = 2.0;
let smoothingFactor = 5;
let pinchThreshold = 45;
let selectedDeviceId = null;

// ─── DOM handles ─────────────────────────────────────────────────────
const videoElement = document.getElementById('videoElement');
const canvasOverlay = document.getElementById('canvasOverlay');
const ctx = canvasOverlay.getContext('2d');
const cameraSelect = document.getElementById('cameraSelect');
const toggleBtn = document.getElementById('toggleBtn');
const statusDot = document.getElementById('statusDot');
const recDot = document.getElementById('recDot');
const camStatus = document.getElementById('camStatus');
const fpsBadge = document.getElementById('fpsBadge');

// Cached canvas dimensions, refreshed by a ResizeObserver rather than
// every frame.
let canvasW = canvasOverlay.offsetWidth || 1;
let canvasH = canvasOverlay.offsetHeight || 1;
canvasOverlay.width = canvasW;
canvasOverlay.height = canvasH;

// ─── Settings persistence ────────────────────────────────────────────
function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return;
        const s = JSON.parse(raw);
        if (typeof s.sensitivity === 'number') sensitivity = s.sensitivity;
        if (typeof s.smoothingFactor === 'number')
            smoothingFactor = s.smoothingFactor;
        if (typeof s.pinchThreshold === 'number')
            pinchThreshold = s.pinchThreshold;
        if (typeof s.deviceId === 'string') selectedDeviceId = s.deviceId;
    } catch {
        // corrupt storage — fall through with defaults
    }
}

function saveSettings() {
    try {
        localStorage.setItem(
            SETTINGS_KEY,
            JSON.stringify({
                sensitivity,
                smoothingFactor,
                pinchThreshold,
                deviceId: selectedDeviceId,
            }),
        );
    } catch {
        // storage quota / disabled — ignore
    }
}

function reflectSettingsToUI() {
    const slSens = document.getElementById('sensitivity');
    const slSmooth = document.getElementById('smoothing');
    const slThresh = document.getElementById('threshold');
    slSens.value = String(sensitivity);
    slSmooth.value = String(smoothingFactor);
    slThresh.value = String(pinchThreshold);
    document.getElementById('sensitivityVal').textContent =
        sensitivity.toFixed(1);
    document.getElementById('smoothingVal').textContent =
        String(smoothingFactor);
    document.getElementById('thresholdVal').textContent =
        String(pinchThreshold);
}

// ─── Screen size from main ───────────────────────────────────────────
window.mouseAPI.onScreenSize((data) => {
    screenW = data.width;
    screenH = data.height;
    log('Screen detected: ' + screenW + '×' + screenH, 'accent');
});
window.mouseAPI.getScreenSize().then((size) => {
    screenW = size.width;
    screenH = size.height;
});
window.mouseAPI.onToggleTracking(() => toggleTracking());
window.mouseAPI.onForceStop(() => stopTracking('Panic stop (hotkey)'));

// ─── MediaPipe Hands setup ───────────────────────────────────────────
const hands = new Hands({
    locateFile: (file) => `vendor/mediapipe/${file}`,
});
hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.6,
});
hands.onResults(onHandResults);

// ─── Mouse-move throttle (coalesce to rAF) ───────────────────────────
let pendingMove = null;
function queueMove(x, y) {
    pendingMove = { x, y };
}
function flushMove() {
    if (pendingMove) {
        window.mouseAPI.moveMouse(pendingMove.x, pendingMove.y);
        pendingMove = null;
    }
    requestAnimationFrame(flushMove);
}
requestAnimationFrame(flushMove);

// ─── Hand-tracking pipeline ──────────────────────────────────────────
function onHandResults(results) {
    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
        fpsBadge.textContent = frameCount + ' FPS';
        frameCount = 0;
        lastFpsTime = now;
    }

    ctx.clearRect(0, 0, canvasW, canvasH);

    if (
        !results.multiHandLandmarks ||
        results.multiHandLandmarks.length === 0
    ) {
        clearGestures();
        hasSmoothSample = false;
        return;
    }

    // The raw camera frame fed to MediaPipe is NOT mirrored; the display is
    // mirrored only via CSS `transform: scaleX(-1)`. Because MediaPipe's
    // handedness is reported as if the input were a selfie (mirrored), we
    // invert the label here so "Left"/"Right" match the user's actual hands.
    let leftHand = null;
    let rightHand = null;
    for (let i = 0; i < results.multiHandLandmarks.length; i++) {
        const lm = results.multiHandLandmarks[i];
        const reported =
            results.multiHandedness &&
            results.multiHandedness[i] &&
            results.multiHandedness[i].label;
        const label = reported === 'Left' ? 'Right' : 'Left';
        if (label === 'Left' && !leftHand) leftHand = lm;
        else if (label === 'Right' && !rightHand) rightHand = lm;
    }

    if (leftHand) drawHand(leftHand, '#00e5a0');
    if (rightHand) drawHand(rightHand, '#ffaa00');

    if (!isTracking) return;

    // LEFT hand drives cursor movement via the index fingertip.
    if (leftHand) {
        const indexTip = leftHand[8];
        const rawX = (1 - indexTip.x) * screenW * sensitivity;
        const rawY = indexTip.y * screenH * sensitivity;
        const offsetX = (screenW * sensitivity - screenW) / 2;
        const offsetY = (screenH * sensitivity - screenH) / 2;
        const mappedX = rawX - offsetX;
        const mappedY = rawY - offsetY;

        if (!hasSmoothSample) {
            smoothX = mappedX;
            smoothY = mappedY;
            hasSmoothSample = true;
        } else {
            const alpha = 1 / smoothingFactor;
            smoothX += alpha * (mappedX - smoothX);
            smoothY += alpha * (mappedY - smoothY);
        }

        const finalX = Math.max(0, Math.min(screenW - 1, smoothX));
        const finalY = Math.max(0, Math.min(screenH - 1, smoothY));

        queueMove(finalX, finalY);
        setGestureActive('gestureMove', true);
    } else {
        hasSmoothSample = false;
        setGestureActive('gestureMove', false);
    }

    // RIGHT hand — click / right-click / scroll.
    if (!rightHand) {
        if (isLeftDown) {
            isLeftDown = false;
            window.mouseAPI.leftUp();
            setGestureActive('gestureLeft', false);
        }
        if (isScrolling) {
            isScrolling = false;
            setGestureActive('gestureScroll', false);
        }
        return;
    }

    const thumb = rightHand[4];
    const index = rightHand[8];
    const middle = rightHand[12];
    const ring = rightHand[16];

    const distThumbIndex = dist(thumb, index, canvasW, canvasH);
    const distThumbMiddle = dist(thumb, middle, canvasW, canvasH);
    const distThumbRing = dist(thumb, ring, canvasW, canvasH);

    if (distThumbRing < pinchThreshold) {
        if (!isScrolling) {
            isScrolling = true;
            scrollBaseY = thumb.y;
            setGestureActive('gestureScroll', true);
            log('Scroll mode activated', 'accent');
        }
        const scrollDelta = (thumb.y - scrollBaseY) * 800;
        if (Math.abs(scrollDelta) > 2) {
            window.mouseAPI.scroll(scrollDelta);
            scrollBaseY = thumb.y;
        }
    } else if (isScrolling) {
        isScrolling = false;
        setGestureActive('gestureScroll', false);
    }

    if (!isScrolling) {
        if (distThumbIndex < pinchThreshold) {
            if (!isLeftDown) {
                isLeftDown = true;
                window.mouseAPI.leftDown();
                setGestureActive('gestureLeft', true);
                log('Left button DOWN', 'accent');
            }
        } else if (isLeftDown) {
            isLeftDown = false;
            window.mouseAPI.leftUp();
            setGestureActive('gestureLeft', false);
            log('Left button UP', 'accent');
        }

        if (distThumbMiddle < pinchThreshold) {
            if (!rightClickCooldown && !isLeftDown) {
                rightClickCooldown = true;
                window.mouseAPI.rightClick();
                setGestureActive('gestureRight', true);
                log('Right click', 'accent');
                rightClickTimer = setTimeout(() => {
                    rightClickCooldown = false;
                    rightClickTimer = null;
                    setGestureActive('gestureRight', false);
                }, 500);
            }
        }
    }
}

function dist(a, b, w, h) {
    const dx = (a.x - b.x) * w;
    const dy = (a.y - b.y) * h;
    return Math.sqrt(dx * dx + dy * dy);
}

// ─── Drawing helpers ─────────────────────────────────────────────────
const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
    [5, 9], [9, 13], [13, 17],
];
const TIP_INDEXES = new Set([4, 8, 12, 16, 20]);

// Cache `rgba(...)` strings so we don't rebuild them every frame.
const rgbaCache = new Map();
function rgba(hex, alpha) {
    const key = hex + '@' + alpha;
    let cached = rgbaCache.get(key);
    if (cached) return cached;
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    cached = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    rgbaCache.set(key, cached);
    return cached;
}

function drawHand(landmarks, color) {
    ctx.strokeStyle = rgba(color, 0.5);
    ctx.lineWidth = 2;
    for (const [i, j] of HAND_CONNECTIONS) {
        const a = landmarks[i];
        const b = landmarks[j];
        ctx.beginPath();
        ctx.moveTo((1 - a.x) * canvasW, a.y * canvasH);
        ctx.lineTo((1 - b.x) * canvasW, b.y * canvasH);
        ctx.stroke();
    }

    const tipFill = color;
    const jointFill = rgba(color, 0.6);
    for (let i = 0; i < landmarks.length; i++) {
        const lm = landmarks[i];
        const x = (1 - lm.x) * canvasW;
        const y = lm.y * canvasH;
        const isTip = TIP_INDEXES.has(i);
        ctx.beginPath();
        ctx.arc(x, y, isTip ? 5 : 3, 0, 2 * Math.PI);
        ctx.fillStyle = isTip ? tipFill : jointFill;
        ctx.fill();
    }

    const palmIdx = [0, 5, 9, 13, 17];
    let sx = 0;
    let sy = 0;
    for (const i of palmIdx) {
        sx += 1 - landmarks[i].x;
        sy += landmarks[i].y;
    }
    const px = (sx / palmIdx.length) * canvasW;
    const py = (sy / palmIdx.length) * canvasH;
    ctx.beginPath();
    ctx.arc(px, py, 8, 0, 2 * Math.PI);
    ctx.fillStyle = rgba(color, 0.3);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
}

// ─── UI helpers ──────────────────────────────────────────────────────
function setGestureActive(id, active) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', active);
}

function clearGestures() {
    [
        'gestureMove',
        'gestureLeft',
        'gestureRight',
        'gestureScroll',
    ].forEach((id) => setGestureActive(id, false));
    if (isLeftDown) {
        isLeftDown = false;
        window.mouseAPI.leftUp();
    }
    if (isScrolling) {
        isScrolling = false;
    }
    if (rightClickTimer) {
        clearTimeout(rightClickTimer);
        rightClickTimer = null;
    }
    rightClickCooldown = false;
}

function log(msg, type = '') {
    const panel = document.getElementById('logPanel');
    const div = document.createElement('div');
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    const ts = document.createElement('span');
    if (type) ts.className = `log-${type}`;
    ts.textContent = `[${time}]`;
    div.append(ts, document.createTextNode(' ' + msg));
    panel.appendChild(div);
    panel.scrollTop = panel.scrollHeight;
    while (panel.children.length > 50) panel.removeChild(panel.firstChild);
}

function updateSetting(input) {
    const val = parseFloat(input.value);
    switch (input.id) {
        case 'sensitivity':
            sensitivity = val;
            document.getElementById('sensitivityVal').textContent =
                val.toFixed(1);
            break;
        case 'smoothing':
            smoothingFactor = val;
            document.getElementById('smoothingVal').textContent = val;
            break;
        case 'threshold':
            pinchThreshold = val;
            document.getElementById('thresholdVal').textContent = val;
            break;
    }
    saveSettings();
}

// ─── Camera device picker ────────────────────────────────────────────
async function populateCameraList() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter((d) => d.kind === 'videoinput');
        cameraSelect.innerHTML = '';
        cams.forEach((d, i) => {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.textContent = d.label || `Camera ${i + 1}`;
            cameraSelect.appendChild(opt);
        });
        if (selectedDeviceId && cams.some((d) => d.deviceId === selectedDeviceId)) {
            cameraSelect.value = selectedDeviceId;
        } else if (cams.length) {
            selectedDeviceId = cams[0].deviceId;
            cameraSelect.value = selectedDeviceId;
        }
    } catch (e) {
        log('Device enumeration failed: ' + e.message, 'warn');
    }
}

cameraSelect.addEventListener('change', async () => {
    selectedDeviceId = cameraSelect.value;
    saveSettings();
    if (isTracking) {
        await stopTracking('Switching camera');
        await startTracking();
    }
});

// ─── Start / Stop ────────────────────────────────────────────────────
async function startTracking() {
    try {
        const constraints = {
            video: {
                width: 640,
                height: 480,
                facingMode: 'user',
            },
        };
        if (selectedDeviceId) {
            constraints.video.deviceId = { exact: selectedDeviceId };
            delete constraints.video.facingMode;
        }
        activeStream = await navigator.mediaDevices.getUserMedia(constraints);
        videoElement.srcObject = activeStream;

        // Device labels are only populated after the first permission grant,
        // so re-enumerate now.
        await populateCameraList();

        camera = new Camera(videoElement, {
            onFrame: async () => {
                await hands.send({ image: videoElement });
            },
            width: 640,
            height: 480,
        });
        await camera.start();

        isTracking = true;
        toggleBtn.textContent = 'STOP';
        toggleBtn.classList.add('active');
        statusDot.classList.add('active');
        recDot.style.display = 'inline-block';
        camStatus.textContent = 'TRACKING';
        log('Tracking started — show your hand', 'accent');
    } catch (err) {
        log('Camera error: ' + err.message, 'warn');
    }
}

async function stopTracking(reason) {
    isTracking = false;
    if (camera) {
        try {
            camera.stop();
        } catch {
            // ignore
        }
        camera = null;
    }
    if (activeStream) {
        activeStream.getTracks().forEach((t) => t.stop());
        activeStream = null;
    }
    if (videoElement.srcObject) {
        videoElement.srcObject = null;
    }
    clearGestures();
    hasSmoothSample = false;
    ctx.clearRect(0, 0, canvasW, canvasH);

    toggleBtn.textContent = 'START';
    toggleBtn.classList.remove('active');
    statusDot.classList.remove('active');
    recDot.style.display = 'none';
    camStatus.textContent = 'CAMERA OFF';
    log(reason ? `Tracking stopped: ${reason}` : 'Tracking stopped');
}

async function toggleTracking() {
    if (!isTracking) await startTracking();
    else await stopTracking();
}

// ─── Wire up DOM ─────────────────────────────────────────────────────
toggleBtn.addEventListener('click', toggleTracking);
['sensitivity', 'smoothing', 'threshold'].forEach((id) => {
    document.getElementById(id).addEventListener('input', (e) =>
        updateSetting(e.target),
    );
});

const resizeObserver = new ResizeObserver(() => {
    const w = canvasOverlay.offsetWidth;
    const h = canvasOverlay.offsetHeight;
    if (w !== canvasW || h !== canvasH) {
        canvasW = w || 1;
        canvasH = h || 1;
        canvasOverlay.width = canvasW;
        canvasOverlay.height = canvasH;
    }
});
resizeObserver.observe(canvasOverlay);

// ─── Init ────────────────────────────────────────────────────────────
loadSettings();
reflectSettingsToUI();
populateCameraList();
log('Waiting for user to start tracking...');
