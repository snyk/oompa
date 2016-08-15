'use strict';

const EventEmitter = require('events');
const request = require('request');

class OompaClient extends EventEmitter {
  constructor(url, methods) {
    super();
    this._url = url;
    this._setupMethods(methods);
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

  dispatch(type, payload) {
    this.emit('request');
    return new Promise((resolve, reject) => request.post({
      url: `${this._url}/api/${type}`,
      json: true,
      body: payload,
    }, (err, res, body) => {
      if (err) {
        this.emit('error', err);
        return reject(err);
      }
      this.emit('reply', body);
      if (res.statusCode !== 200) {
        this.emit('reply:err', body);
        return reject(body);
      }
      this.emit('reply:ok', body);
      return resolve(body);
    }));
  }

  ping(timeout) {
    this.emit('request');
    const timeoutPromise = new Promise((resolve, reject) =>
      setTimeout(() => reject(new Error('Timeout error')), timeout));
    const pingPromise = new Promise((resolve, reject) =>
      request(`${this._url}/healthcheck`, (err, res) => {
        if (err || res.statusCode !== 200) {
          return reject(err);
        }
        return resolve();
      }));
    return Promise.race([timeoutPromise, pingPromise]);
  }
}

module.exports = OompaClient;
