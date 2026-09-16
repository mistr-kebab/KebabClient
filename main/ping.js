'use strict';

// Minecraft Server List Ping (Java Edition, modern 1.7+ Status-Protokoll):
// Handshake -> Status-Request -> JSON-Response (+ Ping/Pong fuer Latenz).
// Liefert MOTD (als Klartext), Spielerzahlen, Version, Favicon und Latenz.
// Wirft bei Timeout/unerreichbar einen lesbaren Fehler (Renderer zeigt Offline).
const dns = require('node:dns').promises;
const net = require('node:net');

const CONNECT_TIMEOUT_MS = 5000;
const TOTAL_TIMEOUT_MS = 8000;
const MAX_FAVICON_BYTES = 64 * 1024;

function encodeVarInt(value) {
  let v = value >>> 0;
  const out = [];
  for (;;) {
    let part = v & 0x7f;
    v >>>= 7;
    if (v) out.push(part | 0x80);
    else {
      out.push(part);
      break;
    }
  }
  return Buffer.from(out);
}

function encodeString(str) {
  const bytes = Buffer.from(String(str || ''), 'utf8');
  return Buffer.concat([encodeVarInt(bytes.length), bytes]);
}

function encodePacket(id, data) {
  const body = Buffer.concat([encodeVarInt(id), data || Buffer.alloc(0)]);
  return Buffer.concat([encodeVarInt(body.length), body]);
}

function createPacketReader(onPacket) {
  let buf = Buffer.alloc(0);
  return {
    push(chunk) {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const len = tryReadVarInt(buf, 0);
        if (!len) break;
        if (buf.length < len.bytes + len.value) break;
        const body = buf.subarray(len.bytes, len.bytes + len.value);
        buf = buf.subarray(len.bytes + len.value);
        const id = tryReadVarInt(body, 0);
        if (!id) break;
        onPacket(id.value, body.subarray(id.bytes));
      }
    }
  };
}

function tryReadVarInt(buf, off) {
  let value = 0;
  let shift = 0;
  let bytes = 0;
  for (let i = 0; i < 5 && off + i < buf.length; i++) {
    const b = buf[off + i];
    bytes++;
    value |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return { value: value >>> 0, bytes };
    shift += 7;
  }
  return null;
}

function readVarInt(buf, ref) {
  const r = tryReadVarInt(buf, ref.off);
  if (!r) throw new Error('Truncated packet.');
  ref.off = ref.off + r.bytes;
  return r.value;
}

function readStringPacket(buf, ref) {
  const len = readVarInt(buf, ref);
  if (ref.off + len > buf.length) throw new Error('Truncated string.');
  const s = buf.subarray(ref.off, ref.off + len).toString('utf8');
  ref.off += len;
  return s;
}

// Chat-Komponente -> Klartext (rekursiv ueber text/extra, translate faellt auf Key zurueck).
function chatToPlain(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(chatToPlain).join('');
  if (typeof node === 'object') {
    let s = '';
    if (typeof node.text === 'string') s += node.text;
    else if (typeof node.translate === 'string') s += node.translate;
    if (Array.isArray(node.extra)) s += node.extra.map(chatToPlain).join('');
    if (Array.isArray(node.with)) s += node.with.map(chatToPlain).join(' ');
    return s;
  }
  return String(node);
}

function cleanMotd(raw) {
  const plain = chatToPlain(raw).replace(/\u00a7[0-9a-fk-or]/gi, '');
  return plain.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 2).join(' · ');
}

function parseAddress(input) {
  const s = String(input || '').trim();
  if (!s) throw new Error('Empty server address.');
  let host = s;
  let port = null;
  const bracket = s.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracket) {
    host = bracket[1];
    if (bracket[2]) port = Number(bracket[2]);
  } else {
    const idx = s.lastIndexOf(':');
    if (idx > -1 && s.indexOf(':') === idx) {
      const maybePort = s.slice(idx + 1);
      if (/^\d+$/.test(maybePort)) {
        host = s.slice(0, idx);
        port = Number(maybePort);
      }
    }
  }
  if (!host) throw new Error(`Invalid server address: ${s}`);
  if (port !== null && !(port >= 1 && port <= 65535)) throw new Error(`Invalid port in: ${s}`);
  return { host, port };
}

async function resolveTarget(host, port) {
  if (port === null && net.isIP(host) === 0) {
    try {
      const records = await dns.resolveSrv(`_minecraft._tcp.${host}`);
      if (records && records.length) {
        const best = [...records].sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0];
        if (best && best.name) return { host: best.name, port: best.port || 25565 };
      }
    } catch { /* kein SRV -> direkt verbinden */ }
  }
  return { host, port: port === null ? 25565 : port };
}

function pingOnce(host, port) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const reader = createPacketReader((id, body) => onPacket(id, body));
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* noop */ }
      reject(err);
    };
    const totalTimer = setTimeout(() => fail(new Error('Timed out.')), TOTAL_TIMEOUT_MS);
    let stage = 'status';
    let pingSentAt = 0n;

    function onPacket(id, body) {
      if (settled) return;
      try {
        if (stage === 'status' && id === 0x00) {
          const ref = { off: 0 };
          const json = readStringPacket(body, ref);
          let status;
          try { status = JSON.parse(json); }
          catch { throw new Error('Invalid status response.'); }
          const result = {
            online: true,
            motd: cleanMotd(status && status.description),
            playersOnline: status?.players?.online ?? null,
            playersMax: status?.players?.max ?? null,
            version: (status && status.version && status.version.name) || null,
            favicon: null,
            latencyMs: null
          };
          const fav = status && status.favicon;
          if (typeof fav === 'string' && fav.startsWith('data:image/png;base64,')) {
            const b64 = fav.slice('data:image/png;base64,'.length);
            if (b64.length <= MAX_FAVICON_BYTES * 1.4) result.favicon = fav;
          }
          stage = 'pong';
          pingSentAt = process.hrtime.bigint();
          const payload = Buffer.alloc(8);
          payload.writeBigInt64BE(pingSentAt);
          socket.write(encodePacket(0x01, payload));
          result._partial = true;
          socket._kebabResult = result;
        } else if (stage === 'pong' && id === 0x01) {
          settled = true;
          clearTimeout(totalTimer);
          const result = socket._kebabResult || { online: true };
          delete result._partial;
          try {
            result.latencyMs = Math.max(0, Math.round(Number(process.hrtime.bigint() - pingSentAt) / 1e6));
          } catch { result.latencyMs = null; }
          try { socket.end(); } catch { /* noop */ }
          setTimeout(() => { try { socket.destroy(); } catch { /* noop */ } }, 250).unref?.();
          resolve(result);
        }
      } catch (err) {
        fail(err);
      }
    }

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.on('timeout', () => fail(new Error('Timed out.')));
    socket.on('error', (err) => fail(new Error(connectionHint(err))));
    socket.on('close', () => {
      if (!settled) fail(new Error('Connection closed.'));
    });
    socket.connect(port, host, () => {
      try {
        socket.write(encodePacket(0x00, Buffer.concat([
          encodeVarInt(-1),
          encodeString(host),
          (() => { const b = Buffer.alloc(2); b.writeUInt16BE(port); return b; })(),
          encodeVarInt(1)
        ])));
        socket.write(encodePacket(0x00));
      } catch (err) {
        fail(err);
      }
    });
    reader.push(Buffer.alloc(0));
    socket.on('data', (chunk) => {
      try { reader.push(chunk); }
      catch (err) { fail(err); }
    });
  });
}

function connectionHint(err) {
  const code = (err && err.code) || '';
  if (code === 'ENOTFOUND') return 'Host not found.';
  if (code === 'ECONNREFUSED') return 'Connection refused (offline?).';
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'Host unreachable.';
  return (err && err.message) || 'Ping failed.';
}

async function pingServer(address) {
  const { host, port } = parseAddress(address);
  const target = await resolveTarget(host, port);
  return pingOnce(target.host, target.port);
}

module.exports = { pingServer, cleanMotd, parseAddress };
