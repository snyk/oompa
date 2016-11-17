const EventEmitter = require('events');
const express = require('express');
const { json } = require('body-parser');
const compression = require('compression');

class OompaServer extends EventEmitter {
  constructor(appSchema,
              healthcheck=(() => Promise.resolve(true)),
              middlewares=[]) {
    super();
    this._middlewareChain = [];
    this._healthcheck = healthcheck;
    this._appSchema = appSchema;
    this.app = this._getBaseApp(middlewares);
    this._api = express.Router();
    this._setupApi(appSchema);
  }

  listen(...args) {
    this._apiRoute();
    this._server = this.app.listen(...args);
    return this._server;
  }

  close(...args) {
    return this._server.close(...args);
  }

  api(middleware) {
    this._middlewareChain.push(middleware);
    return this;
  }

  _getBaseApp(middlewares) {
    const app = express();
    app.use(compression());
    app.use(json({ limit: '50mb' }));
    for (const mid of middlewares) {
      app.use(mid);
    }
    app.get('/healthcheck', (req, res) => {
      return this._healthcheck()
        .then(val => res.json(val))
        .catch(err => res.status((err && err.code) || 500).json(err));
    });
    return app;
  }

  _handleError(res, err) {
    this.emit('reply', {
      type: 'ERR',
      err,
    });
    return res.status((err && err.code) || 500).json((err instanceof Error) ? {
      message: err.message,
    } : err);
  }

  _handleResult(res, payload) {
    this.emit('reply', {
      type: 'OK',
      payload,
    });
    return res.status(200).json(payload);
  }

  _apiRoute() {
    this._api.post('/', req => {
      const { request, OK, ERR } = req;
      if (request.type in this._appSchema) {
        const chain = this._middlewareChain.concat([
          req => this._appSchema[request.type](req.payload),
        ]).map((mid, i) => (req) => Promise.resolve(mid(req, chain[i + 1])));
        return Promise
          .resolve(request)
          .then(chain[0])
          .then(OK)
          .catch(ERR);
      }
      return ERR(new Error(`Unknown request type ${request.type}`));
    });
  }

  _setupApi() {
    this.app.use('/api/:type', (req, res, next) => {
      const payload = req.body;
      const type = req.params.type;
      const request = { type, payload };
      this.emit('request', request);
      req.request = request;
      req.OK = result => this._handleResult(res, result);
      req.ERR = err => this._handleError(res, err);
      next();
    }, this._api);
  }
}

module.exports = OompaServer;
