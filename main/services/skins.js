'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URLS, dataDir } = require('../config');
const { getValidMcAccessToken, getStoredProfile } = require('./auth');
const { loadState, saveState } = require('../store');

const HISTORY_LIMIT = 12;

async function mcGet(p) {
  const token = await getValidMcAccessToken();
  const res = await fetch(`${URLS.mcServicesBase}${p}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Mojang API request failed (${res.status}): ${p}`);
  return res.json();
}

async function getSkinState() {
  const profile = await mcGet('/minecraft/profile');
  return {
    id: profile.id,
    name: profile.name,
    skins: profile.skins || [],
    capes: profile.capes || [],
  };
}

function validateSkinPng(buffer) {
  if (!buffer || buffer.length < 8) throw new Error('Empty file.');
  if (buffer.length > 5 * 1024 * 1024) throw new Error('Skin file is too large (max 5 MB).');
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(pngSig)) throw new Error('Skin must be a PNG file.');
  let offset = 8;
  let width = 0;
  let height = 0;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'IHDR') {
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
      break;
    }
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  if (!width || !height) throw new Error('Could not read PNG dimensions.');
  const ok = width === 64 && (height === 64 || height === 32);
  if (!ok) throw new Error(`Invalid skin dimensions ${width}x${height}. Must be 64x64 or 64x32.`);
  return { width, height };
}

async function fetchUrlAsDataUrl(url, retries = 1) {
  if (!url) return null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'KebabClient (Minecraft launcher)',
          Accept: 'image/png,image/*,*/*',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) throw new Error('empty body');
      const mime = res.headers.get('content-type') || 'image/png';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch (err) {
      if (attempt === retries) {
        console.error(`[skins] texture download failed: ${url} — ${err?.message || err}`);
        return null;
      }
      await new Promise(r => setTimeout(r, 600));
    }
  }
  return null;
}

function skinsDir() {
  const dir = path.join(dataDir(), 'skins');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function historyFile(id) {
  return path.join(skinsDir(), `${String(id).replace(/[^0-9a-f]/gi, '')}.png`);
}

async function rememberSkin(buffer, variant) {
  try {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const id = crypto.createHash('sha1').update(buf).digest('hex');
    fs.writeFileSync(historyFile(id), buf);
    const state = loadState();
    const prev = Array.isArray(state.skinHistory) ? state.skinHistory : [];
    const next = [{ id, variant, addedAt: Date.now() }, ...prev.filter(h => h.id !== id)].slice(0, HISTORY_LIMIT);
    const keep = new Set(next.map(h => `${h.id}.png`));
    for (const f of fs.readdirSync(skinsDir())) {
      if (f.endsWith('.png') && !keep.has(f)) {
        try {
          fs.unlinkSync(path.join(skinsDir(), f));
        } catch {}
      }
    }
    saveState({ skinHistory: next });
  } catch {}
}

async function getHistory() {
  const state = loadState();
  const hist = Array.isArray(state.skinHistory) ? state.skinHistory : [];
  const out = [];
  for (const h of hist) {
    try {
      const dataUrl = 'data:image/png;base64,' + fs.readFileSync(historyFile(h.id)).toString('base64');
      out.push({ id: h.id, variant: h.variant, addedAt: h.addedAt, dataUrl });
    } catch {}
  }
  return out;
}

async function applyHistory(id) {
  const state = loadState();
  const hist = Array.isArray(state.skinHistory) ? state.skinHistory : [];
  const entry = hist.find(h => h.id === String(id));
  if (!entry) throw new Error('Skin not found in history.');
  const buf = fs.readFileSync(historyFile(entry.id));
  return uploadSkin(buf, entry.variant || 'classic');
}

async function getPreview() {
  const profile = getStoredProfile();
  const state = await getSkinState();
  const activeSkin = (state.skins || []).find(s => s.state === 'ACTIVE') || state.skins[0] || null;
  const activeCape = (state.capes || []).find(c => c.state === 'ACTIVE') || null;
  const [skinDataUrl, capeDataUrl] = await Promise.all([
    fetchUrlAsDataUrl(activeSkin?.url),
    fetchUrlAsDataUrl(activeCape?.url),
  ]);
  if (skinDataUrl) {
    const model = activeSkin?.variant === 'SLIM' ? 'slim' : 'classic';
    try {
      await rememberSkin(Buffer.from(skinDataUrl.split(',')[1], 'base64'), model);
    } catch {}
  }
  const capes = await Promise.all(
    (state.capes || []).map(async c => ({
      ...c,
      dataUrl: await fetchUrlAsDataUrl(c.url),
    }))
  );
  return {
    playerName: profile?.name || state.name,
    skin: activeSkin ? { ...activeSkin, dataUrl: skinDataUrl } : null,
    cape: activeCape ? { ...activeCape, dataUrl: capeDataUrl } : null,
    capes,
  };
}

async function uploadSkin(buffer, variant) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const { width, height } = validateSkinPng(buf);
  const model = variant === 'slim' ? 'slim' : 'classic';
  const token = await getValidMcAccessToken();
  const form = new FormData();
  form.set('variant', model);
  form.set('file', new Blob([buf], { type: 'image/png' }), 'skin.png');
  const res = await fetch(URLS.mcProfileSkins, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Skin upload failed (${res.status}): ${text.slice(0, 300)}`);
  }
  await rememberSkin(buf, model);
  return { ok: true, width, height, variant: model };
}

async function equipCape(capeId) {
  const token = await getValidMcAccessToken();
  const id = String(capeId || '').trim();
  if (!id) throw new Error('Missing cape id.');
  const res = await fetch(`${URLS.mcProfileCapes}/active`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ capeId: id }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Equip cape failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return { ok: true, capeId: id };
}

module.exports = {
  getSkinState,
  getPreview,
  uploadSkin,
  equipCape,
  getHistory,
  applyHistory,
  validateSkinPng,
};
