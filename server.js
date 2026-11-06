"use strict";
// Roblox-in-Roblox relay: holds only the latest low-resolution, color-quantized frame.
// No images, passwords, or recordings are saved to disk.
const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const PC_TOKEN = process.env.PC_TOKEN || '';
const ROBLOX_TOKEN = process.env.ROBLOX_TOKEN || '';
const WIDTH = 96;
const HEIGHT = 54;
const BASE64_SIZE = 4 * Math.ceil((WIDTH * HEIGHT) / 3);
const VIDEO_TIMEOUT_MS = 3500;
const INPUT_TIMEOUT_MS = 1000;
const EMPTY = Object.freeze({ up: false, down: false, left: false, right: false, jump: false });
const keys = Object.keys(EMPTY);

if (PC_TOKEN.length < 20 || ROBLOX_TOKEN.length < 20 || PC_TOKEN === ROBLOX_TOKEN) {
  console.error('Set two DIFFERENT 20+ character secrets: PC_TOKEN and ROBLOX_TOKEN.');
  process.exit(1);
}

let latestFrame = '';
let frameSeq = 0;
let lastFrameAt = 0;
let latestControls = { ...EMPTY };
let lastControlsAt = 0;

function authorized(actual, expected) {
  const a = Buffer.from(String(actual || ''), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(json);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > 50000) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}
function normalizedControls(input) {
  const result = { ...EMPTY };
  if (input && typeof input === 'object') {
    for (const key of keys) result[key] = input[key] === true;
  }
  return result;
}
function route(req, res, body) {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'GET' && path === '/') {
    return send(res, 200, { service: 'Roblox Screen Relay', ready: true, version: 1 });
  }
  if (req.method !== 'POST') return send(res, 404, { error: 'Not found' });
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return send(res, 400, { error: 'Invalid body' });
  }
  if (path === '/api/pc/frame') {
    if (!authorized(body.token, PC_TOKEN)) return send(res, 403, { error: 'Denied' });
    if (typeof body.frame !== 'string' || body.frame.length !== BASE64_SIZE ||
        !/^[A-Za-z0-9+/]+$/.test(body.frame)) {
      return send(res, 400, { error: 'Expected 96x54 RGB332 base64 frame' });
    }
    latestFrame = body.frame;
    frameSeq += 1;
    lastFrameAt = Date.now();
    return send(res, 200, { ok: true, seq: frameSeq });
  }
  if (path === '/api/pc/controls') {
    if (!authorized(body.token, PC_TOKEN)) return send(res, 403, { error: 'Denied' });
    const fresh = Date.now() - lastControlsAt < INPUT_TIMEOUT_MS;
    return send(res, 200, { controls: fresh ? latestControls : EMPTY, active: fresh });
  }
  if (path === '/api/roblox/sync') {
    if (!authorized(body.token, ROBLOX_TOKEN)) return send(res, 403, { error: 'Denied' });
    latestControls = normalizedControls(body.controls);
    lastControlsAt = Date.now();
    const live = latestFrame !== '' && Date.now() - lastFrameAt < VIDEO_TIMEOUT_MS;
    const seen = Number.isInteger(body.lastSeq) ? body.lastSeq : -1;
    return send(res, 200, {
      online: live,
      seq: live ? frameSeq : -1,
      frame: live && frameSeq !== seen ? latestFrame : null,
    });
  }
  return send(res, 404, { error: 'Not found' });
}
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST') {
      const body = await readJson(req);
      return route(req, res, body);
    }
    return route(req, res, {});
  } catch (error) {
    if (!res.headersSent) send(res, 400, { error: error.message });
  }
});
server.requestTimeout = 12000;
server.listen(PORT, '0.0.0.0', () => console.log('Relay listening on port', PORT));
