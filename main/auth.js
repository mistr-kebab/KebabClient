'use strict';

const crypto = require('node:crypto');
const { BrowserWindow } = require('electron');
const { URLS, microsoftClientId, msRedirectUri, BUILTIN_CLIENT_ID, BUILTIN_REDIRECT_URI, OWN_CLIENT_ID } = require('./config');
const { loadSecrets, saveSecrets, clearSecrets, loadState, saveState } = require('./store');

const SCOPES = ['XboxLive.signin', 'offline_access', 'openid', 'profile', 'email'];

function storedCustomId() {
  const fromEnv = (microsoftClientId() || '').trim();
  if (fromEnv) return { value: fromEnv, source: 'env' };
  const stored = String(loadState().clientId || '').trim();
  if (stored) return { value: stored, source: 'stored' };
  return { value: '', source: null };
}

function resolveLoginConfig() {
  const custom = storedCustomId();
  let mode = loadState().authMode || null;
  if (!mode) mode = custom.value ? 'custom' : 'own';
  if (mode === 'custom') {
    if (!custom.value) {
      throw new Error('Custom App ID selected but no client ID configured. Enter it below or switch to the KebabClient app.');
    }
    return { mode, clientId: custom.value, redirectUri: msRedirectUri(), source: custom.source };
  }
  if (mode === 'builtin') {
    return { mode, clientId: BUILTIN_CLIENT_ID, redirectUri: BUILTIN_REDIRECT_URI, source: 'builtin' };
  }
  return { mode: 'own', clientId: OWN_CLIENT_ID, redirectUri: msRedirectUri(), source: 'own' };
}

function getClientIdInfo() {
  const custom = storedCustomId();
  let cfg;
  try {
    cfg = resolveLoginConfig();
  } catch {
    cfg = { mode: loadState().authMode || 'builtin', clientId: '', redirectUri: '', source: null };
  }
  return {
    mode: cfg.mode,
    customValue: custom.value,
    customSource: custom.source,
    effectiveSource: cfg.source,
    ownClientId: OWN_CLIENT_ID
  };
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function newPkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(sha256(verifier));
  return { verifier, challenge };
}

function newState() {
  return base64url(crypto.randomBytes(16));
}

async function postForm(url, params) {
  const body = new URLSearchParams(params);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  if (!res.ok) {
    const msg = (json && (json.error_description || json.error || json.message)) || text.slice(0, 500);
    throw new Error(`Token request failed (${res.status}): ${msg}`);
  }
  return json;
}

async function postJson(url, payload, token) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* noop */ }
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}) ${url}: ${String(text).slice(0, 500)}`);
  }
  return json;
}

function listenForAuthCode(parent, cfg) {
  const clientId = cfg.clientId;
  const { verifier, challenge } = newPkce();
  const state = newState();
  const redirect = cfg.redirectUri;
  const authUrl =
    `${URLS.msAuthorize}?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code&redirect_uri=${encodeURIComponent(redirect)}` +
    `&response_mode=query&scope=${encodeURIComponent(SCOPES.join(' '))}` +
    `&state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(challenge)}` +
    `&code_challenge_method=S256&prompt=select_account`;

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      parent: parent || null,
      modal: false,
      width: 480,
      height: 720,
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    });
    let settled = false;
    const done = (err, code) => {
      if (settled) return;
      settled = true;
      try { win.close(); } catch { /* noop */ }
      if (err) reject(err);
      else resolve({ code, verifier });
    };
    win.on('closed', () => done(new Error('Sign-in window was closed before completing authentication.')));
    const filter = { urls: [`${redirect}*`, 'https://login.live.com/oauth20_desktop.srf*'] };
    win.webContents.session.webRequest.onBeforeRequest(filter, (details, callback) => {
      try {
        const u = new URL(details.url);
        const code = u.searchParams.get('code');
        const err = u.searchParams.get('error');
        const errDesc = u.searchParams.get('error_description');
        if (err) {
          callback({ cancel: true });
          done(new Error(`Microsoft sign-in failed: ${err} ${errDesc || ''}`.trim()));
          return;
        }
        if (code) {
          callback({ cancel: true });
          done(null, code);
          return;
        }
      } catch { /* ignore parse errors */ }
      callback({});
    });
    win.webContents.on('will-redirect', (event, url) => {
      try {
        const u = new URL(url);
        if (url.startsWith(redirect)) {
          const code = u.searchParams.get('code');
          const err = u.searchParams.get('error');
          if (code || err) {
            event.preventDefault();
            if (err) done(new Error(`Microsoft sign-in failed: ${err}`));
            else done(null, code);
          }
        }
      } catch { /* noop */ }
    });
    win.loadURL(authUrl).catch((e) => done(e));
  });
}

async function exchangeCodeForTokens(code, verifier, cfg) {
  return postForm(URLS.msToken, {
    client_id: cfg.clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: verifier,
    scope: SCOPES.join(' ')
  });
}

async function refreshMsTokens(refreshToken, clientId) {
  return postForm(URLS.msToken, {
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: SCOPES.join(' ')
  });
}

async function xboxAuthenticate(msAccessToken) {
  const body = await postJson(URLS.xboxUserAuth, {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  });
  if (!body || !body.Token) throw new Error('Xbox Live authentication returned no token.');
  return { token: body.Token, uhs: body?.DisplayClaims?.xui?.[0]?.uhs };
}

async function xstsAuthorize(xblToken) {
  const body = await postJson(URLS.xstsAuthorize, {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT'
  });
  if (!body || !body.Token) throw new Error('XSTS authorization returned no token.');
  const uhs = body?.DisplayClaims?.xui?.[0]?.uhs;
  return { token: body.Token, uhs };
}

async function mcLoginWithXbox(uhs, xstsToken) {
  const body = await postJson(URLS.mcLoginXbox, {
    identityToken: `XBL3.0 x=${uhs};${xstsToken}`
  });
  if (!body || !body.access_token) throw new Error('Minecraft Services login returned no access token.');
  return body;
}

async function fetchMcProfile(mcAccessToken) {
  const res = await fetch(URLS.mcProfile, { headers: { Authorization: `Bearer ${mcAccessToken}` } });
  if (res.status === 404) throw new Error('No Minecraft profile found for this Microsoft account (game not owned?).');
  if (!res.ok) throw new Error(`Failed to fetch Minecraft profile (${res.status}).`);
  return res.json();
}

async function fullLoginFlow(parentWindow) {
  const cfg = resolveLoginConfig();
  const { code, verifier } = await listenForAuthCode(parentWindow, cfg);
  const msTokens = await exchangeCodeForTokens(code, verifier, cfg);
  const result = await finishLoginWithMsTokens(msTokens);
  saveState({ loginClientId: cfg.clientId, loginMode: cfg.mode });
  return result;
}

async function finishLoginWithMsTokens(msTokens) {
  if (!msTokens.access_token) throw new Error('Microsoft token response missing access_token.');
  const xbl = await xboxAuthenticate(msTokens.access_token);
  if (!xbl.uhs) throw new Error('Xbox Live response missing user hash.');
  const xsts = await xstsAuthorize(xbl.token);
  const mc = await mcLoginWithXbox(xsts.uhs || xbl.uhs, xsts.token);
  const profile = await fetchMcProfile(mc.access_token);
  const secrets = {
    msRefreshToken: msTokens.refresh_token || null,
    mcAccessToken: mc.access_token,
    mcExpiresIn: mc.expires_in || 86400,
    obtainedAt: Date.now()
  };
  saveSecrets(secrets);
  saveState({
    profile: { id: profile.id, name: profile.name },
    mcTokenObtainedAt: Date.now(),
    mcTokenExpiresIn: mc.expires_in || 86400
  });
  return { profile, mcAccessToken: mc.access_token };
}

async function refreshSession() {
  const secrets = loadSecrets();
  if (!secrets || !secrets.msRefreshToken) {
    throw new Error('No stored session. Please sign in with Microsoft first.');
  }
  const state = loadState();
  const clientId = state.loginClientId || resolveLoginConfig().clientId;
  let msTokens;
  try {
    msTokens = await refreshMsTokens(secrets.msRefreshToken, clientId);
  } catch (err) {
    if (/invalid_grant/i.test(err.message)) {
      throw new Error('Session expired or created with a different App ID. Please sign in again.');
    }
    throw err;
  }
  return finishLoginWithMsTokens({
    access_token: msTokens.access_token,
    refresh_token: msTokens.refresh_token || secrets.msRefreshToken
  });
}

function getStoredProfile() {
  const state = loadState();
  return state.profile || null;
}

function isMcTokenFresh(bufferMs = 5 * 60 * 1000) {
  const state = loadState();
  if (!state.mcTokenObtainedAt) return false;
  const expiresIn = (state.mcTokenExpiresIn || 86400) * 1000;
  return Date.now() < state.mcTokenObtainedAt + expiresIn - bufferMs;
}

async function getValidMcAccessToken() {
  const secrets = loadSecrets();
  if (!secrets || !secrets.mcAccessToken) throw new Error('Not signed in.');
  if (isMcTokenFresh()) return secrets.mcAccessToken;
  const refreshed = await refreshSession();
  return refreshed.mcAccessToken;
}

function logout() {
  clearSecrets();
  saveState({ profile: null, mcTokenObtainedAt: 0 });
}

module.exports = {
  fullLoginFlow,
  refreshSession,
  getStoredProfile,
  getValidMcAccessToken,
  getClientIdInfo,
  logout
};
