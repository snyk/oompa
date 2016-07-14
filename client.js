'use strict';

const EventEmitter = require('events');
const Client = require('ws');
const uuid = require('uuid').v4;

const CLOSE_ABNORMAL = 1006;
const SERVER_SHUTTING_OFF = 1000;
const GOING_AWAY = 1001;

class OompaClient extends EventEmitter {
  constructor(url, methods, options) {
    super();
    this._pending = {};
    this._url = url;
    this._stats = {
      timeouts: 0,
      requests: 0,
    };
    this._setupMethods(methods);
    this._setupOptions(options);
    this._setupConnection();
    this._setupEvents();
    if (!this.noServer) {
      this.client = new Client(url);
      this.start();
    }
  }

  _setupEvents() {
    this.on('timeout', () => this._stats.timeouts++);
    this.on('request', () => this._stats.requests++);
    this.on('clear', clearInterval);
    this._agent = setInterval(() => {
      if (this._stats.requests &&
          this._stats.timeouts / this._stats.requests > this.tolerance.ratio) {
        this.client.close();
        this.attemptReconnect();
      } else {
        this._stats.timeouts = 0;
        this._stats.requests = 0;
      }
    }, this.tolerance.interval);
  }

  _setupOptions(options) {
    options = options || {};
    const clone = Object.assign({}, options);
    if (clone.noServer === undefined) clone.noServer = false;
    if (clone.reconnectInterval === undefined) clone.reconnectInterval = 1000;
    if (clone.timeout === undefined) clone.timeout = 10000;
    if (clone.attempts === undefined) clone.attempts = 3;
    if (clone.tolerance === undefined) clone.tolerance = {};
    if (clone.tolerance.ratio === undefined) clone.tolerance.ratio = 0.05;
    if (clone.tolerance.interval === undefined) clone.tolerance.interval = 10000;
    Object.assign(this, clone);
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
    methods = methods || {};
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
      this.emit('host-closed');
      if (code === CLOSE_ABNORMAL || code === SERVER_SHUTTING_OFF) {
        this.attemptReconnect();
      }
    });
    this.client.on('error', err => this.emit('error', err));
    this.client.on('message',
                   message => this.handleMessage(JSON.parse(message)));
  }

  _getTimeoutAgent(request, reject) {
    let attempts = this.attempts - 1;
    const timeoutAgent = setInterval(() => {
      if (attempts) {
        attempts--;
        this.sling(request);
      } else {
        this.emit('clear', timeoutAgent);
        this.emit('timeout');
        reject(new Error('Timeout error'));
      }
    }, this.timeout);
    const cancel = () => {
      this.emit('clear', timeoutAgent)
      this.removeListener('host-closed', cancel);
    };
    this.once('host-closed', cancel);
  }

  dispatch(type, payload) {
    return this._opened.then(() => new Promise((resolve, reject) => {
      this.emit('request');
      const id = uuid();
      const timeoutAgent = this._getTimeoutAgent({type, payload, id}, reject);
      this._pending[id] = {type, payload, id};
      this.once(`OK:${id}`, ok => {
        delete this._pending[id];
        this.emit('clear', timeoutAgent)
        resolve(ok.payload);
      });
      this.once(`ERR:${id}`, err => {
        delete this._pending[id];
        this.emit('clear', timeoutAgent)
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
    this.emit('request');
    return new Promise((resolve, reject) => {
      const timeoutError = setTimeout(() => {
        this.emit('timeout');
        reject(new Error('Timeout error'));
      }, timeout);
      this.dispatch('$OOMPA/PING').then(res => {
        clearTimeout(timeoutError);
        resolve(res);
      }).catch(reject);
    });
  }

  close() {
    clearInterval(this._agent);
    this.client.close(GOING_AWAY);
  }
}

module.exports = OompaClient;