'use strict';

const EventEmitter = require('events');
const Client = require('ws');
const uuid = require('uuid').v4;

const CLOSE_ABNORMAL = 1006;

class SliteClient extends EventEmitter {
  constructor(url, methods, autoInit) {
    super();
    methods = methods || {};
    if (autoInit === undefined) {
      autoInit = true;
    }
    this._url = url;
    this._setupMethods(methods);
    this._setupConnection();
    if (autoInit) {
      this.client = new Client(url);
      this.start();
    }
  }

  _setupConnection() {
    if (this._resolver) {
      this.removeListener('reconnected', this._resolver);
    }
    this._resolver = null;
    this._opened = new Promise(resolve => this._resolver = resolve);
    this.once('reconnected', this._resolver);
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

  attemptReconnect() {
    this.emit('host-closed');
    const reconAgent = setInterval(() => {
      this._setupConnection();
      this.client = (new Client(this._url)).once('error', err => {
        this.emit('reconnect-failed');
        this.client = null;
      }).once('open', () => {
        clearInterval(reconAgent);
        this.start();
        this.emit('reconnected');
      });
    }, 1000);
  }

  start() {
    this.client.once('open', this._resolver);
    this.client.once('close', code => {
      if (code === CLOSE_ABNORMAL) {
        this.attemptReconnect();
      }
    });
    this.client.on('error', err => this.emit('error', err));
    this.client.on('message',
                   message => this.handleMessage(JSON.parse(message)));
  }

  dispatch(type, payload) {
    return this._opened.then(() => new Promise((resolve, reject) => {
      const id = uuid();
      this.once(`OK:${id}`, ok => resolve(ok.payload));
      this.once(`ERR:${id}`, err => reject(err.error));
      this.once('host-closed', () => reject(new Error('Connection to host terminated')))
      this.client.send(JSON.stringify({type, payload, id}));
    }));
  }

  handleMessage(message) {
    const type = message.type;
    this.emit(`${type}:${message.id}`, message);
  }
}

module.exports = SliteClient;