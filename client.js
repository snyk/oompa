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
    this.on('clear', clearInterval);
    if (this.drainInterval) {
      this._agent = setInterval(() => {
        const pendingIdsSnapshot = new Set(Object.keys(this._pending));
        const staleClient = this.client;
        this.client = null;
        this.attemptReconnect(true);
        if (!pendingIdsSnapshot.size && staleClient) {
          return staleClient.close(GOING_AWAY);
        }
        Array.from(pendingIdsSnapshot).forEach(id => {
          this.once(`REPLY:${id}`, () => {
            pendingIdsSnapshot.delete(id);
            if (!pendingIdsSnapshot.size) {
              staleClient.close(GOING_AWAY);
            }
          });
        });
      }, this.drainInterval);
    }
  }

  _setupOptions(options) {
    options = options || {};
    const clone = Object.assign({}, options);
    if (clone.noServer === undefined) clone.noServer = false;
    if (clone.reconnectInterval === undefined) clone.reconnectInterval = 1000;
    if (clone.timeout === undefined) clone.timeout = 10000;
    if (clone.attempts === undefined) clone.attempts = 3;
    if (clone.drainInterval === undefined) clone.drainInterval = null;
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

  attemptReconnect(ignorePending) {
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
        if (!ignorePending) {
          Object.keys(this._pending).forEach(id =>
            this.sling(this._pending[id]));
        }
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
        try {
          this.sling(request);
        } catch (e) { /* fail silently while there are attempts */ }
      } else {
        this.emit('clear', timeoutAgent);
        this.emit(`TIMEOUT:${request.id}`);
        reject(new Error('Timeout error'));
      }
    }, this.timeout);
    return timeoutAgent;
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
    this.emit(`REPLY:${message.id}`, message);
    this.emit(`${type}:${message.id}`, message);
  }

  ping(timeout) {
    this.emit('request');
    return new Promise((resolve, reject) => {
      const timeoutError = setTimeout(() => {
        this.emit('PING-TIMEOUT');
        reject(new Error('Timeout error'));
      }, timeout);
      this.dispatch('$OOMPA/PING').then(res => {
        clearTimeout(timeoutError);
        resolve(res);
      }).catch(reject);
    });
  }

  close() {
    if (this._agent) {
      clearInterval(this._agent);
    }
    this.client.close(GOING_AWAY);
  }
}

module.exports = OompaClient;