'use strict';

const TAG_END = 0;
const TAG_BYTE = 1;
const TAG_STRING = 8;
const TAG_LIST = 9;
const TAG_COMPOUND = 10;

function u16be(n) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(n, 0);
  return buf;
}

function i32be(n) {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(n, 0);
  return buf;
}

function nbtName(name) {
  const bytes = Buffer.from(String(name ?? ''), 'utf8');
  return Buffer.concat([u16be(bytes.length), bytes]);
}

function stringPayload(value) {
  const bytes = Buffer.from(String(value ?? ''), 'utf8');
  return Buffer.concat([u16be(bytes.length), bytes]);
}

function taggedString(name, value) {
  return Buffer.concat([Buffer.from([TAG_STRING]), nbtName(name), stringPayload(value)]);
}

function taggedByte(name, value) {
  return Buffer.concat([Buffer.from([TAG_BYTE]), nbtName(name), Buffer.from([value ? 1 : 0])]);
}

function serverCompound(server) {
  return Buffer.concat([
    taggedString('name', server.name),
    taggedString('ip', server.ip),
    taggedByte('acceptTextures', true),
    taggedByte('hidden', false),
    Buffer.from([TAG_END])
  ]);
}

function buildServersDat(servers) {
  const list = Array.isArray(servers) ? servers : [];
  const listPayload = Buffer.concat([
    Buffer.from([TAG_COMPOUND]),
    i32be(list.length),
    ...list.map(serverCompound)
  ]);
  const rootPayload = Buffer.concat([
    Buffer.from([TAG_LIST]),
    nbtName('servers'),
    listPayload,
    Buffer.from([TAG_END])
  ]);
  return Buffer.concat([Buffer.from([TAG_COMPOUND]), nbtName(''), rootPayload]);
}

function createReader(buf) {
  let off = 0;
  function need(n) {
    if (off + n > buf.length) throw new Error('Truncated NBT data.');
  }
  function u8() { need(1); return buf[off++]; }
  function u16() { need(2); const v = buf.readUInt16BE(off); off += 2; return v; }
  function i32() { need(4); const v = buf.readInt32BE(off); off += 4; return v; }
  function bytes(n) { need(n); const v = buf.subarray(off, off + n); off += n; return v; }
  function readString() { return bytes(u16()).toString('utf8'); }
  function skipPayload(type) {
    if (type === 1) off += 1;
    else if (type === 2) off += 2;
    else if (type === 3 || type === 5) off += 4;
    else if (type === 4 || type === 6) off += 8;
    else if (type === 7) off += i32();
    else if (type === 8) off += u16();
    else if (type === 9) {
      const elem = u8();
      const len = i32();
      for (let i = 0; i < len; i++) skipPayload(elem);
    } else if (type === 10) {
      for (;;) {
        const t = u8();
        if (t === TAG_END) break;
        off += u16();
        skipPayload(t);
      }
    } else if (type === 11) off += i32() * 4;
    else if (type === 12) off += i32() * 8;
    else throw new Error(`Unknown NBT tag: ${type}`);
    need(0);
  }
  function readPayload(type) {
    if (type === 1) return u8();
    if (type === 8) return readString();
    if (type === 9) {
      const elem = u8();
      const len = i32();
      const out = [];
      for (let i = 0; i < len; i++) {
        out.push(elem === TAG_COMPOUND ? readCompound() : (skipPayload(elem), null));
      }
      return out;
    }
    if (type === 10) return readCompound();
    skipPayload(type);
    return null;
  }
  function readCompound() {
    const obj = {};
    for (;;) {
      const t = u8();
      if (t === TAG_END) break;
      const name = readString();
      obj[name] = readPayload(t);
    }
    return obj;
  }
  return { u8, readString, readCompound };
}

function parseServersDat(buf) {
  try {
    if (!Buffer.isBuffer(buf) || !buf.length) return [];
    const r = createReader(buf);
    if (r.u8() !== TAG_COMPOUND) return [];
    r.readString();
    const root = r.readCompound();
    const list = root && root.servers;
    if (!Array.isArray(list)) return [];
    return list
      .filter((e) => e && typeof e.name === 'string' && typeof e.ip === 'string')
      .map((e) => ({ name: e.name, ip: e.ip }));
  } catch {
    return [];
  }
}

module.exports = { buildServersDat, parseServersDat };
