'use strict';

const EventEmitter = require('events');
const Client = require('ws');
const uuid = require('uuid').v4;

class SliteClient extends EventEmitter {
  constructor(url, methods, autoInit) {
    super();
    methods = methods || {};
    if (autoInit === undefined) {
      autoInit = true;
    }
    this._resolver = null;
    this._setupMethods(methods);
    this._opened = new Promise(resolve => this._resolver = resolve);
    if (autoInit) {
      this.client = new Client(url);
      this.start();
    }
  }

  _setupMethods(methods) {
    Object.keys(methods).forEach(method => {
      const opts = methods[method];
      this[method] = (function () {
        return this.dispatch(opts.type,
                             opts.factory.apply(null, Array.from(arguments)));
      }).bind(this);
    });
  }

  start() {
    this.client.once('open', this._resolver);
    this.client.on('error', err => this.emit('error', err));
    this.client.on('message',
                   message => this.handleMessage(JSON.parse(message)));
  }

  dispatch(type, payload) {
    return this._opened.then(() => new Promise((resolve, reject) => {
      const id = uuid();
      this.once(`OK:${id}`, ok => resolve(ok.payload));
      this.once(`ERR:${id}`, err => reject(err.error));
      this.client.send(JSON.stringify({type, payload, id}));
    }));
  }

  handleMessage(message) {
    const type = message.type;
    this.emit(`${type}:${message.id}`, message);
  }
}

module.exports = SliteClient;