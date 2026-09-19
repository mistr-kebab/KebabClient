'use strict';

let emitFn = () => {};

function setEmitter(fn) {
  emitFn = fn;
}

function emit(channel, payload) {
  emitFn(channel, payload);
}

module.exports = { setEmitter, emit };
