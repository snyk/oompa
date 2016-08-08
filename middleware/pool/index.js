const PromisePool = require('./promise-pool');

module.exports = (concurrency=10, maxQueued=30) => {
  const requestPool = new PromisePool(concurrency, maxQueued);
  const middleware = (request, next) => requestPool.run(() => next(request));
  middleware.pool = requestPool;
  return Object.freeze(middleware);
};
