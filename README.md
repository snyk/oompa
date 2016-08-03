# oompa
A tiny pick-me-app for websocket-based, stateless, microservices.

## Installation

**Server (Node 6+)** `require('snyk-oompa')`

**Client (Node 4+)** `require('snyk-oompa/client')`

## Usage
### Server

The `snyk-oompa` library draws inspiration from [redux](https://github.com/reactjs/redux) in that it handles
typed *tasks* (called `actions` in redux).

The task types are defined in an object called *Application Schema*.

#### The Application Schema
This is an example schema that defines the `ADD` task, giving it a factory method.

```js
const appSchema = {
  // The factory method accepts the task payload as a parameter,
  // and should return a promise
  ADD: ({x, y}) => Promise.resolve(x + y)
};
```

#### The healthcheck
Every microservice should have a way to express health via HTTP (or so AWS says).
This is why the second parameter of the server's constructor should be a method that returns
a promise that is resolved when we know all is well, and rejected otherwise.

#### Server methods
- `listen(port)` - Start listening @`port`. Return a promise resolved when the server is ready.
- `close()` - Close both HTTP and WebSockets servers, returns a promise resolved when both are closed.
- `use(middleware)` - see [middleware](#middleware) section below.
- `push(eventType, eventData, scope)` - push an event of type `eventType` with payload `eventData` to all clients in `scope`. By default, `scope` is all connected clients, but it also accepts an array of connections, or a single connection object.

#### Server events
- `error(Error err)`: emitted when the healthcheck fails with error `err`.
- `connection(Connection con)`: emitted when `con` is connected to the server.
- `terminated(Connection con)`: emitted when `con` is disconnected from the server.
- `reply(Reply r)`: emitted when a reply is ready to be sent. A reply has a type (`OK|ERR`) an `id` correlating to its request and `payload` or `error`.
- `stale(Reply)`: emitted after the `reply` event, when finding no live connection to reply to.

#### An actual example

```js
const serverApp = {
  ADD: ({x, y}) => Promise.resolve(x + y),
  SUB: ({x, y}) => Promise.resolve(x - y),
  MUL: ({x, y}) => Promise.resolve(x * y),
  DIV: ({x, y}) => Promise[y ? 'resolve' : 'reject'](x / y),
};

function healthcheck() {
  return Promise.resolve(); // let's assume sunshine and rainbows
}

const server = new Server(serverApp, healthcheck);

server
  .on('connection',
      () => logger.info('Connection created'))
  .on('terminated',
      () => logger.info('Connection terminated'))
  .on('error',
      err => logger.error(err, 'Server error'))
  .on('reply',
      ({type, id}) => logger.debug(`[${type}] for request #${id}`))
  .on('stale',
      ({type, id}) => logger.warn(`[${type}] for stale request #${id}`))
  .listen(PORT).then(() => logger.info(`Listening on port ${PORT}`));
```

### Client
The Oompa client is actually very lean. You can use it in one of two forms:

#### Lean usage
```js
const OompaClient = require('snyk-oompa/client');
const client = new OompaClient('ws://localhost:9000');

// dispatch accepts the type and the payload of the task
client.dispatch('ADD', { x: 1, y: 6 }).then(result => {
  console.log(`${res} should be 7`);
});
```

#### Verbose Usage
```js
const OompaClient = require('snyk-oompa/client');
const clientMethods = {
  // [methodName]: {type: [taskType], factory: [methodParams -> taskPayload]}
  add: { type: 'ADD', factory: (x, y) => ({x, y}) },
  sub: { type: 'SUB', factory: (x, y) => ({x, y}) },
  mul: { type: 'MUL', factory: (x, y) => ({x, y}) },
  div: { type: 'DIV', factory: (x, y) => ({x, y}) },
};
const client = new OompaClient('ws://localhost:9000', clientMethods);

client.add(1, 2).then(...);
```

#### Client methods
- `constructor(url, methods, options)` - Create a new client with server @ `url`, the specified `methods`, with the following options:
  - `noServer:false` don't actually try to attempt to connect on init.
  - `reconnectInterval:1000` try to reconnect to a server after server CLOSE event every `reconnectInterval` ms.
  - `timeout:10000` disregard an attempt of request as a timeout after `timeout` ms.
  - `attempts:3` reject a request after `attempts` timeouts as a timeout error.
  - `drainInterval:null` if specified, attempt reconnect to server after every `drainInterval` ms.
- `ping(timeout)` - Check for the server's health. Wait for `timeout` ms until auto-rejecting.

#### Client events

- `error`: emitted by propagation from the underlying socket
- `host-closed`: emitted when the host is closed abnormally (attempts to reconnect every 1 second)
- `reconnect-failed`: emitted when an attempt to reconnect has failed
- `reconnected`: emitted when the last attempt to reconnect was successful
- `reconnecting`: emitted when the client is attempting to reconnect to the server
- `ready`: emitted when the client is initially connected to the server
- `OK:<TASK-ID>`: emitted when task <TASK-ID> received an OK reply from the server, with its payload
- `ERR:<TASK-ID>`: emitted when task <TASK-ID> received an ERR reply from the server, with its error
- **Server sent events:** the `OompaServer` can push events to any and all of its clients. They are treated just like any other event.

### Middleware
Normally, a server simply forwards the request payload to its factory. Sometimes, however, you'd rather
the request go through other steps before reaching the factory, if at all!

```js
const Server = require('snyk-oompa');

const cache = new Map();
function cacheMiddleware(request, next) {
  const type = request.type;
  const {x, y} = request.payload;
  const cacheUrl = `${type}/${x}/${y}`;
  if (cache.has(cacheUrl)) return cache.get(cacheUrl);
  return next(request).then(result => {
    cache.set(cacheUrl, result);
    return result;
  });
}

const serverApp = {
  ADD: ({x, y}) => Promise.resolve(x + y),
  SUB: ({x, y}) => Promise.resolve(x - y),
  MUL: ({x, y}) => Promise.resolve(x * y),
  DIV: ({x, y}) => Promise[y ? 'resolve' : 'reject'](x / y),
};

function healthcheck() {
  return Promise.resolve(); // let's assume sunshine and rainbows
}

const server = new Server(serverApp, healthcheck);
server.use(cacheMiddleware);

server
  .on('connection',
      () => logger.info('Connection created'))
  .on('terminated',
      () => logger.info('Connection terminated'))
  .on('error',
      err => logger.error(err, 'Server error'))
  .on('reply',
      ({type, id}) => logger.debug(`[${type}] for request #${id}`))
  .on('stale',
      ({type, id}) => logger.warn(`[${type}] for stale request #${id}`))
  .listen(PORT).then(() => logger.info(`Listening on port ${PORT}`));
```
