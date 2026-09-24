'use strict';

// Server-backed client ban check (fail-open).
//
// Flow: POST { installId, uuid, username, version } to /api/client/hello.
// A definitive answer is { ok: true, banned, reason }. Anything inconclusive
// (network error, timeout, 400, 429 exhausted, malformed answer) returns
// { ok: false } and the caller MUST let the user play (fail-open).
// Only { ok: true, banned: true } may block a game launch.

const { app } = require('electron');
const { randomUUID } = require('node:crypto');
const { URLS } = require('../config');
const { saveState } = require('../store');
const { getStoredProfile } = require('./auth');
const telemetry = require('../telemetry');

const HELLO_TIMEOUT_MS = 8000;
const INTERACTIVE_ATTEMPTS = 2;
const INTERACTIVE_MAX_BACKOFF_MS = 5000;
const BACKGROUND_ATTEMPTS = 3;
const BACKGROUND_MAX_BACKOFF_MS = 30000;
const RECHECK_INTERVAL_MS = 60 * 60 * 1000;
const MAX_REASON_LEN = 500;

const INSTALL_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const UUID_RE = /^[0-9a-f]{32}$/;
const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

function clientVersion() {
  try {
    return String(app.getVersion() || 'unknown');
  } catch (err) {
    console.warn('[ban] Could not get app version:', err?.message || err);
    return 'unknown';
  }
}

function userAgent() {
  return `KebabClient/${clientVersion()}`;
}

// Mojang UUIDs are lowercase hex without dashes; normalize anything stored.
function normalizeUuid(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/-/g, '');
}

// Stable install ID, shared with the ping telemetry (never invent a second
// one). randomUUID() output always matches INSTALL_ID_RE.
function stableInstallId() {
  try {
    const stored = telemetry.installId();
    if (stored && INSTALL_ID_RE.test(stored)) return stored;
    const fresh = randomUUID();
    try {
      saveState({ installId: fresh });
    } catch (err) {
      console.warn('[ban] Could not persist installId:', err?.message || err);
    }
    return fresh;
  } catch (err) {
    console.warn('[ban] installId failed:', err?.message || err);
    return randomUUID();
  }
}

// Client-side validation so a malformed payload (400) never goes out.
// Returns null when valid, otherwise a short error description.
function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') return 'payload must be an object';
  if (typeof payload.installId !== 'string' || !INSTALL_ID_RE.test(payload.installId)) {
    return 'installId must match [A-Za-z0-9_-]{4,64}';
  }
  if (typeof payload.uuid !== 'string' || !(payload.uuid === '' || UUID_RE.test(payload.uuid))) {
    return 'uuid must be empty or 32 lowercase hex chars without dashes';
  }
  if (typeof payload.username !== 'string' || !(payload.username === '' || USERNAME_RE.test(payload.username))) {
    return 'username must be empty or 3-16 chars [A-Za-z0-9_]';
  }
  if (typeof payload.version !== 'string' || payload.version.length < 1 || payload.version.length > 32) {
    return 'version must be a non-empty string (max 32 chars)';
  }
  return null;
}

function buildPayload() {
  const profile = getStoredProfile();
  return {
    installId: stableInstallId(),
    uuid: profile && profile.id ? normalizeUuid(profile.id) : '',
    username: profile && profile.name ? String(profile.name) : '',
    version: clientVersion(),
  };
}

function sanitizeReason(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') {
    console.warn('[ban] Ignoring non-string ban reason.');
    return null;
  }
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_REASON_LEN);
}

// Strict: only a boolean true counts as banned.
function parseHelloResponse(json) {
  if (!json || typeof json !== 'object') {
    console.warn('[ban] Malformed hello response (not an object).');
    return { ok: false, error: 'malformed-response' };
  }
  if (json.banned !== true && json.banned !== false) {
    console.warn('[ban] Malformed hello response (banned is not a boolean).');
    return { ok: false, error: 'malformed-response' };
  }
  return { ok: true, banned: json.banned, reason: sanitizeReason(json.reason ?? null) };
}

function parseRetryAfterMs(value, maxMs) {
  let ms = 0;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    ms = Number(value.trim()) * 1000;
  } else if (typeof value === 'string') {
    const at = Date.parse(value);
    if (!Number.isNaN(at)) ms = at - Date.now();
  }
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  return Math.min(ms, maxMs);
}

function sleep(ms) {
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms);
    if (t && typeof t.unref === 'function') t.unref();
  });
}

async function postHello(payload, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await globalThis.fetch(URLS.clientHello, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': userAgent(),
      },
      body: JSON.stringify(payload),
    });
    let json = null;
    try {
      json = await res.json();
    } catch {}
    return { status: res.status, json, retryAfter: res.headers ? res.headers.get('retry-after') : null };
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`Ban check timed out after ${timeoutMs}ms.`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Shared in-flight request: concurrent triggers (Play click during hourly
// check) reuse the same fresh answer instead of stampeding into a 429.
let inflight = null;

async function checkNow(options) {
  if (inflight) return inflight;
  const opts = options || {};
  const timeoutMs = opts.timeoutMs || HELLO_TIMEOUT_MS;
  const background = !!opts.background;
  const maxAttempts = opts.maxAttempts || (background ? BACKGROUND_ATTEMPTS : INTERACTIVE_ATTEMPTS);
  const maxBackoffMs = opts.maxBackoffMs || (background ? BACKGROUND_MAX_BACKOFF_MS : INTERACTIVE_MAX_BACKOFF_MS);

  inflight = runCheck({ timeoutMs, maxAttempts, maxBackoffMs }).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function runCheck({ timeoutMs, maxAttempts, maxBackoffMs }) {
  const payload = buildPayload();
  const invalid = validatePayload(payload);
  if (invalid) {
    console.warn('[ban] Refusing to send invalid hello payload:', invalid);
    return { ok: false, error: 'invalid-payload', username: payload.username || '' };
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await postHello(payload, timeoutMs);
    } catch (err) {
      // Offline / DNS / timeout / server down -> fail-open, play allowed.
      console.warn('[ban] Hello request failed (fail-open):', err?.message || err);
      return { ok: false, error: 'network', username: payload.username };
    }
    if (res.status === 429) {
      if (attempt >= maxAttempts) {
        console.warn('[ban] Hello rate-limited, giving up (fail-open).');
        return { ok: false, error: 'rate-limited', username: payload.username };
      }
      const wait = Math.max(1000 * attempt, parseRetryAfterMs(res.retryAfter, maxBackoffMs));
      console.warn(`[ban] Hello rate-limited, retrying in ${wait}ms (attempt ${attempt}/${maxAttempts}).`);
      await sleep(Math.min(wait, maxBackoffMs));
      continue;
    }
    if (res.status === 400) {
      console.warn('[ban] Hello payload rejected by server (400, fail-open).');
      return { ok: false, error: 'bad-request', username: payload.username };
    }
    if (res.status !== 200) {
      console.warn(`[ban] Hello request failed with status ${res.status} (fail-open).`);
      return { ok: false, error: `http-${res.status}`, username: payload.username };
    }
    const parsed = parseHelloResponse(res.json);
    if (!parsed.ok) return { ...parsed, username: payload.username };
    return { ok: true, banned: parsed.banned, reason: parsed.reason, username: payload.username };
  }
  return { ok: false, error: 'exhausted', username: buildUsername() };
}

function buildUsername() {
  try {
    const profile = getStoredProfile();
    return (profile && profile.name) || '';
  } catch {
    return '';
  }
}

// Best-effort hello after auth events (login/refresh). Only broadcasts when
// the answer is a definitive ban; everything else stays quiet (fail-open).
async function afterAuth(broadcast, _trigger) {
  try {
    const res = await checkNow({ background: true });
    if (res.ok && res.banned && typeof broadcast === 'function') {
      broadcast('ban:status', { banned: true, reason: res.reason, username: res.username });
    }
  } catch (err) {
    console.warn('[ban] Post-auth check failed (fail-open):', err?.message || err);
  }
}

let watcherStarted = false;
let lastKnownBanned = null;

function startBanWatcher(broadcast) {
  if (watcherStarted) return;
  watcherStarted = true;
  const tick = async () => {
    let res;
    try {
      res = await checkNow({ background: true });
    } catch (err) {
      console.warn('[ban] Hourly re-check failed (fail-open):', err?.message || err);
      return;
    }
    if (!res.ok) return;
    if (res.banned && lastKnownBanned !== true) {
      lastKnownBanned = true;
      try {
        broadcast('ban:status', { banned: true, reason: res.reason, username: res.username });
      } catch (err) {
        console.warn('[ban] Broadcast failed:', err?.message || err);
      }
    } else if (!res.banned && lastKnownBanned === true) {
      lastKnownBanned = false;
      try {
        broadcast('ban:status', { banned: false, reason: null, username: res.username });
      } catch (err) {
        console.warn('[ban] Broadcast failed:', err?.message || err);
      }
    } else {
      lastKnownBanned = res.banned;
    }
  };
  setInterval(tick, RECHECK_INTERVAL_MS).unref?.();
}

module.exports = {
  normalizeUuid,
  validatePayload,
  buildPayload,
  parseHelloResponse,
  checkNow,
  afterAuth,
  startBanWatcher,
};
