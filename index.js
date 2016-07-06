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
  constructor(app) {
    super();
    this._app = app;
    this.tasks = new WeakMap();
    this._httpServer = this.getBaseServer();
    this.server = new Server({server: this._httpServer});
  }

  getBaseServer() {
    return http.createServer((req,res) => {
      res.setHeader('Content-Type', 'text/html');
      res.writeHead(200, {'Content-Type': 'text/plain'});
      res.end('ok');
    });
  }

  listen(port) {
    return new Promise(resolve => {
      this.server.on('connection', con => this.onConnection(con));
      this._httpServer.listen(port, resolve);
    });
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
    return factory(request.payload)
      .then(this.passResult(request))
      .catch(this.passError(request));
  }

  handleRequest(request) {
    if (request.type in this._app) {
      return this.appCall(request, this._app[request.type]);
    }
    return this.handleUnknownRequest(request);
  }
}

module.exports = SliteServer;