# 🖐️ Hand Mouse Control

A Windows desktop app that lets you control your mouse with hand gestures using your webcam.

## Gestures

| Gesture                         | Action                                      |
| ------------------------------- | ------------------------------------------- |
| **Open palm**                   | Move cursor (follows palm center)           |
| **Thumb + Index finger pinch**  | Left click & hold (release = release click) |
| **Thumb + Middle finger pinch** | Right click                                 |
| **Thumb + Ring finger pinch**   | Scroll mode (move hand up/down to scroll)   |

---

## Prerequisites

- **Node.js 18+** — Download from https://nodejs.org
- **Windows 10/11**
- **Webcam**
- **VS Code** (for editing)

---

## Setup Instructions

### 1. Open the project folder in VS Code

Open a terminal in VS Code (`Ctrl + ~`) and navigate to the project:

```bash
cd hand-mouse-control
```

### 2. Install dependencies

```bash
npm install
```

> ⚠️ The `@nut-tree-fork/nut-js` package requires native compilation.  
> If you get build errors, install the Windows build tools first:
>
> ```bash
> npm install -g windows-build-tools
> ```
>
> Or install Visual Studio Build Tools with the "Desktop development with C++" workload.

### 3. Run the app

```bash
npm start
```

### 4. Using the app

1. Click **START** to enable the camera and hand tracking
2. Show your hand to the camera
3. Move your palm to move the cursor
4. Pinch thumb + index finger to left-click (hold)
5. Pinch thumb + middle finger to right-click
6. Pinch thumb + ring finger and move up/down to scroll

### 5. Build a Windows installer (optional)

```bash
npm run build
```

This creates a `.exe` installer in the `dist/` folder.

---

## Settings

| Setting             | Description                                        | Default |
| ------------------- | -------------------------------------------------- | ------- |
| **Sensitivity**     | How far the cursor moves relative to hand movement | 2.0     |
| **Smoothing**       | Higher = smoother but slower cursor (1–10)         | 5       |
| **Pinch Threshold** | Distance threshold for detecting finger pinches    | 45      |

---

## Troubleshooting

**Camera not working?**

- Make sure no other app is using your webcam
- Check Windows privacy settings: Settings → Privacy → Camera

**Cursor is jumpy?**

- Increase the **Smoothing** slider
- Ensure good lighting on your hand
- Keep your hand 30–60cm from the camera

**Clicks not registering?**

- Lower the **Pinch Threshold** slider
- Make sure you're clearly touching your fingertips together

**Native module build errors?**

- Run `npm install -g windows-build-tools` in an admin terminal
- Or install Visual Studio 2022 with C++ build tools

---

## Project Structure

```
hand-mouse-control/
├── package.json           # Dependencies and scripts
├── src/
│   ├── main.js            # Electron main process (mouse control)
│   ├── preload.js         # IPC bridge (renderer ↔ main)
│   └── index.html         # UI + MediaPipe hand tracking
└── README.md
```

## Tech Stack

- **Electron** — Desktop app framework
- **MediaPipe Hands** — Real-time hand landmark detection
- **@nut-tree-fork/nut-js** — Native mouse/keyboard control
