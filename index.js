const EventEmitter = require('events');
const http = require('http');
const Server = require('ws').Server;

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

class SliteServer extends EventEmitter {
  constructor(app, healthcheck=() => Promise.resolve(true)) {
    super();
    this._middlewareChain = [];
    this._app = app;
    this._httpServer = this.getBaseServer(healthcheck);
    this.tasks = new WeakMap();
    this.server = new Server({server: this._httpServer});
  }

  getBaseServer(healthcheck) {
    return http.createServer((req,res) => {
      res.setHeader('Content-Type', 'text/html');
      return healthcheck()
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

  passResult(request) {
    return result => this.replyWith(request, OK(request.id, result));
  }

  passError(request) {
    return error => this.replyWith(request, ERR(request.id, error));
  }

  onConnection(con) {
    this.emit('connection', con);
    con.on('close', () => this.emit('terminated', con));
    con.on('message', message => {
      const request = JSON.parse(message);
      this.tasks.set(request, con);
      this.handleRequest(request);
    });
  }

  replyWith(request, reply) {
    this.emit('reply', reply);
    const con = this.tasks.get(request);
    if (con.readyState === con.OPEN) {
      con.send(JSON.stringify(reply));
    } else {
      this.emit('stale', reply);
    }
  }

  handleUnknownRequest(request) {
    this.replyWith(request,
      ERR(request.id, `Unknown request type: "${request.type}"`)
    );
  }

  appCall(request, factory) {
    return factory(request.payload);
  }

  handleRequest(request) {
    if (request.type in this._app) {
      const chain = this._middlewareChain.concat([
        req => this.appCall(req, this._app[req.type])
      ]).map((mid, i) => (req) => mid(req, chain[i + 1]));
      return Promise
        .resolve(request)
        .then(chain[0])
        .then(this.passResult(request))
        .catch(this.passError(request));
    }
    return this.handleUnknownRequest(request);
  }

  use(middleware) {
    this._middlewareChain.push(middleware);
  }
}

module.exports = SliteServer;