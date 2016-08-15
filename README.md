# oompa
A tiny pick-me-app for express-based, stateless, microservices.

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
- `new OompaServer(appSchema, healthcheck, middlewares)` - the first 2 parameters are discussed above, and `middlewares` is an array of `express` middleware to inject.
- `listen(port)` - Start listening @`port`.
- `close()` - Close both HTTP and WebSockets servers, returns a promise resolved when both are closed.
- `api(middleware)` - see [middleware](#middleware) section below.

#### Server events
- `reply(Reply r)`: emitted when a reply is ready to be sent. A reply has a type (`OK|ERR`) an `id` correlating to its request and `payload` or `error`.
- `request({type, payload})`: emitted every time a request is made.

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
  .on('reply',
      ({type}) => logger.debug(`[${type}] for request`))
  .listen(PORT).then(() => logger.info(`Listening on port ${PORT}`));
```

### Client
The Oompa client is actually very lean. You can use it in one of two forms:

#### Lean usage
```js
const OompaClient = require('snyk-oompa/client');
const client = new OompaClient('http://localhost:9000');

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
- `constructor(url, methods)` - Create a new client with server @ `url`, and the specified `methods`
- `ping(timeout)` - Check for the server's health. Wait for `timeout` ms until auto-rejecting.

#### Client events

- `error`: emitted by propagation from the underlying socket
- `request`: emitted when a request is made
- `reply`: emitted when server reply is available
- `reply:err`: emitted when server reply is available, and is an error
- `reply:ok`: emitted when server reply is available, and is not an error

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
server.api(cacheMiddleware);

server
  .listen(PORT).then(() => logger.info(`Listening on port ${PORT}`));
```
