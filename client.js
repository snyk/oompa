'use strict';

const EventEmitter = require('events');
const Client = require('ws');
const uuid = require('uuid').v4;

const CLOSE_ABNORMAL = 1006;
const SERVER_SHUTTING_OFF = 1000;
const NO_SERVER = Symbol('@@oompa/no-server');

class OompaClient extends EventEmitter {
  constructor(url, methods, reconnectInterval) {
    super();
    methods = methods || {};
    if (reconnectInterval === undefined) {
      reconnectInterval = 1000;
    }
    this._pending = {};
    this._url = url;
    this._setupMethods(methods);
    this._setupConnection();
    this.reconnectInterval = reconnectInterval;
    if (reconnectInterval !== NO_SERVER) {
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
    let reconnecting = false;
    this.emit('host-closed');
    let client;
    const reconAgent = setInterval(() => {
      this._setupConnection();
      if (client) {
        client.close();
      }
      client = (new Client(this._url)).once('error', err => {
        this.emit('reconnect-failed');
      }).once('open', () => {
        clearInterval(reconAgent);
        this.client = client;
        this.start();
        this.emit('reconnected');
        Object.keys(this._pending).forEach(id =>
          this.sling(this._pending[id]));
      });
    }, this.reconnectInterval);
  }

  start() {
    this.client.once('open', this._resolver);
    this.client.once('close', code => {
      if (code === CLOSE_ABNORMAL || code === SERVER_SHUTTING_OFF) {
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
      this._pending[id] = {type, payload, id};
      this.once(`OK:${id}`, ok => {
        delete this._pending[id];
        resolve(ok.payload);
      });
      this.once(`ERR:${id}`, err => {
        delete this._pending[id];
        reject(err.error);
      });
      this.sling({type, payload, id});
    }));
  }

  sling(request) {
    this.client.send(JSON.stringify(request));
  }

  handleMessage(message) {
    const type = message.type;
    this.emit(`${type}:${message.id}`, message);
  }

  ping(timeout) {
    return new Promise((resolve, reject) => {
      const timeoutError = setTimeout(() =>
        reject(new Error('Timeout error')), timeout);
      this.dispatch('$OOMPA/PING').then(res => {
        clearTimeout(timeoutError);
        resolve(res);
      }).catch(reject);
    });
  }

  close() {
    this.client.close();
  }
}

OompaClient.NO_SERVER = NO_SERVER;

module.exports = OompaClient;