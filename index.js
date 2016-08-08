const EventEmitter = require('events');
const http = require('http');
const Server = require('ws').Server;

const DISCONNECT_CODE = '/disconnect';
const START_SYM = Symbol('@@start');

const ERR = (id, error) => ({
  type: 'ERR',
  id,
  error,
});

const OK = (id, payload) => ({
  type: 'OK',
  id,
  payload,
});

const PUSH = (event, payload) => ({
  type: 'PUSH',
  event,
  payload,
});

const BROADCAST = Symbol('@@broadcast');

class OompaServer extends EventEmitter {
  constructor(app, healthcheck=() => Promise.resolve(true)) {
    super();
    this._middlewareChain = [];
    this._app = app;
    this._healthcheck = healthcheck;
    this._httpServer = this.getBaseServer();
    this.server = new Server({server: this._httpServer});
  }

  getBaseServer() {
    return http.createServer((req,res) => {
      res.setHeader('Content-Type', 'text/html');
      if (req.url.startsWith(DISCONNECT_CODE)) {
        this.server.clients.forEach(client => client.close());
        res.writeHead(200, {'Content-Type': 'text/plain'});
        return res.end('ok');
      }
      return this._healthcheck()
        .then(() => {
          res.writeHead(200, {'Content-Type': 'text/plain'});
          res.end('ok');
        }).catch(err => {
          this.emit('error', err);
          res.writeHead(500, {'Content-Type': 'text/plain'});
          res.end('error');
        });
    });
  }

  listen(port) {
    return new Promise(resolve => {
      this.server.on('connection', con => this.onConnection(con));
      this._httpServer.listen(port, resolve);
    });
  }

  close() {
    return new Promise(resolve =>
      this.server.close(() => this._httpServer.close(resolve)));
  }

  passResult(con, request) {
    return result => this.replyWith(con, request, OK(request.id, result));
  }

  passError(con, request) {
    return error => {
      if (error instanceof Error) {
        error = error.toString();
      }
      return this.replyWith(con, request, ERR(request.id, error));
    };
  }

  onConnection(con) {
    this.emit('connection', con);
    con.on('close', () => this.emit('terminated', con));
    con.on('message', message => {
      const request = JSON.parse(message);
      request[START_SYM] = new Date();
      this.handleRequest(request, con);
    });
  }

  push(eventType, eventData, scope=BROADCAST) {
    const e = PUSH(eventType, eventData);
    if (scope === BROADCAST) {
      scope = this.server.clients;
    }
    if (Array.isArray(scope)) {
      scope.forEach(con => this.sendTo(con, e));
    } else {
      this.sendTo(scope, e);
    }
  }

  sendTo(con, data) {
    if (con.readyState === con.OPEN) {
      con.send(JSON.stringify(data));
    } else {
      this.emit('stale', data);
    }
  }

  replyWith(con, request, reply) {
    this.emit('reply', reply, (new Date()) - request[START_SYM]);
    this.sendTo(con, reply);
  }

  handleUnknownRequest(con, request) {
    this.replyWith(con, request,
      ERR(request.id, `Unknown request type: "${request.type}"`)
    );
  }

  appCall(request, factory) {
    return factory(request.payload);
  }

  handleRequest(request, con) {
    this.emit('request', request);
    if (request.type in this._app) {
      const chain = this._middlewareChain.concat([
        req => this.appCall(req, this._app[req.type])
      ]).map((mid, i) => (req) => mid(req, chain[i + 1]));
      return Promise
        .resolve(request)
        .then(chain[0])
        .then(this.passResult(con, request))
        .catch(this.passError(con, request));
    }
    if (request.type === '$OOMPA/PING') {
      return this._healthcheck()
        .then(this.passResult(con, request))
        .catch(this.passError(con, request));
    }
    return this.handleUnknownRequest(con, request);
  }

  use(middleware) {
    this._middlewareChain.push(middleware);
  }
}

OompaServer.BROADCAST = BROADCAST;

module.exports = OompaServer;
