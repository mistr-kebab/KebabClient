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
  // servers.dat on disk is uncompressed NBT.
  return Buffer.concat([Buffer.from([TAG_COMPOUND]), nbtName(''), rootPayload]);
}

module.exports = { buildServersDat };
