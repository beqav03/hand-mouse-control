#!/usr/bin/env node
// Copies MediaPipe runtime assets from node_modules/@mediapipe/* into
// src/vendor/mediapipe/ so the renderer can load them from disk under a
// strict Content-Security-Policy (script-src 'self'). Invoked from
// `postinstall`, `prestart`, `prebuild`, and `prepack`.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'src', 'vendor', 'mediapipe');

const SOURCES = [
    '@mediapipe/hands',
    '@mediapipe/camera_utils',
    '@mediapipe/drawing_utils',
];

function copyDir(srcDir, destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        if (entry.name === 'package.json' || entry.name === 'README.md') continue;
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        if (entry.isDirectory()) copyDir(srcPath, destPath);
        else fs.copyFileSync(srcPath, destPath);
    }
}

function main() {
    let copied = 0;
    let missing = [];

    for (const pkg of SOURCES) {
        const srcDir = path.join(ROOT, 'node_modules', pkg);
        if (!fs.existsSync(srcDir)) {
            missing.push(pkg);
            continue;
        }
        copyDir(srcDir, DEST);
        copied++;
    }

    if (missing.length) {
        console.warn(
            `[copy-mediapipe] Skipped (not installed yet): ${missing.join(', ')}. ` +
                `Run "npm install" first.`,
        );
    }
    if (copied) {
        console.log(`[copy-mediapipe] Vendored ${copied} package(s) into ${path.relative(ROOT, DEST)}`);
    }
}

main();
