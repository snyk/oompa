import test from 'ava';
import request from 'request';
import EventEmitter from 'events';
import Server from '.';
import Client from './client';

const serverApp = {
  ADD: ({x, y}) => Promise.resolve(x + y), 
  SUB: ({x, y}) => Promise.resolve(x - y), 
  MUL: ({x, y}) => Promise.resolve(x * y), 
  DIV: ({x, y}) => Promise[y ? 'resolve' : 'reject'](x / y), 
};

const clientMethods = {
  add: { type: 'ADD', factory: (x, y) => ({x, y}) },
  sub: { type: 'SUB', factory: (x, y) => ({x, y}) },
  mul: { type: 'MUL', factory: (x, y) => ({x, y}) },
  div: { type: 'DIV', factory: (x, y) => ({x, y}) },
};

let server;
let client;

const wsMock = new EventEmitter();
const wsClientMock = new EventEmitter();
const httpServerMock = {
  listen(_port, cb) { cb() },
};

test.before(async t => {
  server = new Server(serverApp);
  delete server.server;
  delete server._httpServer;
  server._httpServer = httpServerMock;
  server.server = wsMock;
  await server.listen();

  client = new Client(null, clientMethods, false);
  client.client = wsClientMock;
  client.start();
  wsClientMock.emit('open');
});

test.afterEach(() => wsClientMock.send = null);

test('Setup successful', t => {
  t.truthy(client);
  t.truthy(server);
});

test.cb('Error propagation', t => {
  client.once('error', err => {
    t.is(err, 'meow');
    t.end();
  });

  wsClientMock.emit('error', 'meow');
});

test.cb('Message handling [success]', t=> {
  client.once('OK:0', message => {
    t.is(message.payload, 'meow');
    t.end();
  });

  wsClientMock.emit('message', JSON.stringify({
    type: 'OK',
    id: 0,
    payload: 'meow',
  }));
});

test.cb('Message handling [failure]', t=> {
  client.once('ERR:0', message => {
    t.is(message.error, 'meow');
    t.end();
  });

  wsClientMock.emit('message', JSON.stringify({
    type: 'ERR',
    id: 0,
    error: 'meow',
  }));
});

test.serial('Message dispatch [success]', async t => {
  wsClientMock.send = wsClientMock.emit.bind(wsClientMock, 'message');
  const res = await client.dispatch('OK', 5);
  t.is(res, 5);
});

test.serial('Message dispatch [failure]', async t => {
  wsClientMock.send = wsClientMock.emit.bind(wsClientMock, 'message');
  try {
    await client.dispatch('ERR', 5);
    t.fail('Should fail here');
  } catch (err) {
    t.is(err, undefined);
  }
});

test.serial('Proxy dispatch', async t => {
  wsClientMock.send = message => {
    const msg = JSON.parse(message);
    wsClientMock.emit('message', JSON.stringify({
      type: 'OK',
      id: msg.id,
      payload: msg.type + msg.payload.x + msg.payload.y,
    }));
  }
  let res = await client.add(1, 2);
  t.is(res, 'ADD12');
  res = await client.sub(1, 2);
  t.is(res, 'SUB12');
  res = await client.mul(1, 2);
  t.is(res, 'MUL12');
  res = await client.div(1, 2);
  t.is(res, 'DIV12');
});

test('Connection events', t => {
  t.plan(2);
  const connection = new EventEmitter();
  server.once('connection', () => t.pass('Connection emitted'));
  server.once('terminated', () => t.pass('Termination emitted'));
  wsMock.emit('connection', connection);
  connection.emit('close');
});

test('Unknown command', t => {
  t.plan(3);
  const connection = new EventEmitter();
  connection.send = message => {
    const msg = JSON.parse(message);
    t.is(msg.type, 'ERR');
    t.is(msg.id, 0);
    t.is(msg.error, 'Unknown request type: "MEOW"');
  };
  wsMock.emit('connection', connection);
  connection.emit('message', JSON.stringify({
    type: 'MEOW',
    id: 0,
  }));
});


test.cb('Known command [success]', t => {
  const connection = new EventEmitter();
  connection.send = message => {
    const msg = JSON.parse(message);
    t.is(msg.type, 'OK');
    t.is(msg.id, 0);
    t.is(msg.payload, 3);
    t.end();
  };
  wsMock.emit('connection', connection);
  connection.emit('message', JSON.stringify({
    type: 'ADD',
    id: 0,
    payload: {
      x: 1,
      y: 2,
    },
  }));
});

test.cb('Known command [failure]', t => {
  const connection = new EventEmitter();
  connection.send = message => {
    const msg = JSON.parse(message);
    t.is(msg.type, 'ERR');
    t.is(msg.id, 0);
    t.is(msg.error, null);
    t.end();
  };
  wsMock.emit('connection', connection);
  connection.emit('message', JSON.stringify({
    type: 'DIV',
    id: 0,
    payload: {
      x: 1,
      y: 0,
    },
  }));
});

test.cb('Stale success', t => {
  const connection = new EventEmitter();
  connection.readyState = 'CLOSED';
  connection.OPEN = 'OPEN';
  server.once('stale', msg => {
    t.is(msg.type, 'OK');
    t.is(msg.id, 0);
    t.is(msg.payload, 3);
    t.end();
  });
  wsMock.emit('connection', connection);
  connection.emit('message', JSON.stringify({
    type: 'ADD',
    id: 0,
    payload: {
      x: 1,
      y: 2,
    },
  }));
});

const sleep = interval =>
  new Promise(resolve => setTimeout(resolve, interval));

test('System test', async t => {
  let isHealthy = true;
  const server = new Server(serverApp,
    () => isHealthy ? Promise.resolve() : Promise.reject(new Error('meow')));
  await server.listen(45623);
  const client = new Client('ws://localhost:45623', clientMethods);
  t.is(await client.add(3, 5), 8);
  try {
    await client.div(3, 0);
    t.fail('Should fail...');
  } catch (err) {
    t.is(err, null);
  }
  await new Promise(resolve => {
    server.on('error', err => t.is(err.message, 'meow'));
    request('http://localhost:45623', (err, resp, body) => {
      t.is(body, 'ok');
      t.is(resp.statusCode, 200);
      isHealthy = false;
      request('http://localhost:45623', (err, resp, body) => {
        t.is(body, 'error');
        t.is(resp.statusCode, 500);
        resolve();
      });
    });
  });
  await new Promise(resolve => {
    client.once('host-closed', resolve);
    server.close();
  });
  await new Promise(resolve => {
    client.once('reconnect-failed', resolve);
  });
  const nServer = new Server(serverApp);
  await nServer.listen(45623);
  await new Promise(resolve => {
    client.once('reconnected', resolve);
  });
  nServer.use((req, next) => {
    req.payload.x = 5;
    req.payload.y = 5;
    return next(req);
  });
  nServer.use(req => {
    return req.payload.x * req.payload.y;
  });
  t.is(await client.add(3, 5), 25);
});