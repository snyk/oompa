import test from 'ava';
import request from 'request';
import sleep from 'then-sleep';
import EventEmitter from 'events';
import Server from '.';
import Client from './client';

const serverApp = {
  ADD: ({x, y}) => Promise.resolve(x + y),
  SUB: ({x, y}) => Promise.resolve(x - y),
  MUL: ({x, y}) => Promise.resolve(x * y),
  DIV: ({x, y}) => (y ? Promise.resolve(x / y) :
                        Promise.reject(new Error('Zero div'))),
  SLEEP: () => sleep(500),
};

const clientMethods = {
  add: { type: 'ADD', factory: (x, y) => ({x, y}) },
  sub: { type: 'SUB', factory: (x, y) => ({x, y}) },
  mul: { type: 'MUL', factory: (x, y) => ({x, y}) },
  div: { type: 'DIV', factory: (x, y) => ({x, y}) },
  sleep: { type: 'SLEEP', factory: () => null },
};

const eventOf = (emitter, event) =>
  new Promise(resolve => emitter.once(event, resolve));

let server;
let client;
let _serverPort = 45610;
const getPort = () => _serverPort++;

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

  client = new Client(null, clientMethods, {
    noServer: true,
  });
  client.client = wsClientMock;
  client.start();
  wsClientMock.emit('open');
});

test.beforeEach(t => {
  t.context.port = getPort();
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
    t.is(msg.error, 'Error: Zero div');
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

test('[System] Trivial usage', async t => {
  const server = new Server(serverApp);
  await server.listen(t.context.port);
  const client = new Client(`ws://localhost:${t.context.port}`, clientMethods);
  t.is(await client.add(3, 5), 8);
  try {
    await client.div(3, 0);
    t.fail('Should fail...');
  } catch (err) {
    t.is(err, 'Error: Zero div');
  }
});

test('[System] Drain interval test', async t => {
  const server = new Server(serverApp);
  await server.listen(t.context.port);
  const client = new Client(`ws://localhost:${t.context.port}`, clientMethods, {
    drainInterval: 100,
  });
  const task = client.sleep();
  await new Promise(resolve => client.once('reconnected', resolve));
  t.is(await client.add(2, 4), 6);
  await task;
  await new Promise(resolve => client.once('reconnected', resolve));
  client.close();
});

test('[System] Timeout test', async t => {
  const server = new Server(serverApp);
  await server.listen(t.context.port);
  const client = new Client(`ws://localhost:${t.context.port}`, clientMethods, {
    attempts: 2,
    reconnectInterval: 100,
    timeout: 200,
  });
  try {
    await client.sleep();
    t.fail('Should have timed out');
  } catch (err) {
    t.is(err.message, 'Timeout error');
  }
});

test('[System] Healthcheck test', async t => {
  let isHealthy = true;
  const healthCheck = () => isHealthy ? Promise.resolve() : Promise.reject(new Error('meow'));
  const server = new Server(serverApp, healthCheck);
  await server.listen(t.context.port);
  const client = new Client(`ws://localhost:${t.context.port}`, clientMethods);
  await new Promise(resolve => {
    server.on('error', err => t.is(err.message, 'meow'));
    request(`http://localhost:${t.context.port}`, (err, resp, body) => {
      t.is(body, 'ok');
      t.is(resp.statusCode, 200);
      client.ping(100).then(() => {
        isHealthy = false;
        request(`http://localhost:${t.context.port}`, (err, resp, body) => {
          t.is(body, 'error');
          t.is(resp.statusCode, 500);
          client.ping(100)
            .then(() => t.fail('Should fail'))
            .catch(err => {
              t.is(err, 'Error: meow');
            }).then(resolve);
        });
      });
    });
  });
});

test('[System] Server close and reconnect', async t => {
  const PORT = t.context.port;
  const URL = `ws://localhost:${PORT}`;
  const server = new Server(serverApp);
  await server.listen(PORT);
  const client = new Client(URL, clientMethods, {
    reconnectInterval: 100,
  });
  await eventOf(client, 'ready');
  client.on('error', () => null);
  await new Promise(resolve => {
    client.once('host-closed', resolve);
    server.close();
  });
  await eventOf(client, 'reconnecting');
  await eventOf(client, 'reconnect-failed');
  const nServer = new Server(serverApp);
  await nServer.listen(PORT);
  await eventOf(client, 'reconnected');
  const sleeper = client.sleep();
  await new Promise(resolve => {
    client.once('host-closed', resolve);
    nServer.close();
  });
  const lServer = new Server(serverApp);
  // Using middleware here to shortcut sleep
  lServer.use(req => 5);
  await lServer.listen(PORT);
  await eventOf(client, 'reconnected');
  t.is(await sleeper, 5);
});

test('[System] Middleware test', async t => {
  const server = new Server(serverApp);
  await server.listen(t.context.port);
  const client = new Client(`ws://localhost:${t.context.port}`, clientMethods);
  server.use((req, next) => {
    req.payload.x = 5;
    req.payload.y = 5;
    return next(req);
  });
  server.use(req => {
    return req.payload.x * req.payload.y;
  });
  t.is(await client.add(3, 5), 25);
});

test('[System] Disconnect hook test', async t => {
  const PORT = t.context.port;
  const url = proto => `${proto}://localhost:${PORT}`;
  const server = new Server(serverApp);
  await server.listen(PORT);
  const client = new Client(url('ws'), clientMethods, {
    reconnectInterval: 100,
  });
  await new Promise(resolve => {
    request(url('http') + '/disconnect', (err, resp, body) => {
      t.is(body, 'ok');
      t.is(resp.statusCode, 200);
      resolve();
    });
  });
  await eventOf(client, 'reconnected');
});

test('[System] Client .close test', async t => {
  const server = new Server(serverApp);
  await server.listen(t.context.port);
  const client = new Client(`ws://localhost:${t.context.port}`, clientMethods);
  t.is(await client.add(3, 5), 8);
  client.close();
  try {
    await client.add(2, 3);
    t.fail('Should fail.');
  } catch (e) {
    t.pass('Client closed');
  }
});

test('[System] Push events test', async t => {
  const connections = [];
  const server = new Server(serverApp);
  server.on('connection', connections.push.bind(connections));
  await server.listen(t.context.port);
  const client1 = new Client(`ws://localhost:${t.context.port}`, clientMethods);
  await new Promise(resolve => server.once('connection', resolve));
  const client2 = new Client(`ws://localhost:${t.context.port}`, clientMethods);
  await new Promise(resolve => server.once('connection', resolve));
  let state1 = 0;
  let state2 = 0;
  client1.on('foo', () => state1++);
  client2.on('foo', () => state2++);
  server.push('foo');
  server.push('foo', null, connections[0]);
  server.push('foo', null, connections);
  await sleep(100);
  t.is(state1, 3);
  t.is(state2, 2);
});
