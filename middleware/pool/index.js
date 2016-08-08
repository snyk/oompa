const PromisePool = require('./promise-pool');

module.exports = (concurrency=10, maxQueued=30) => {
  const requestPool = new PromisePool(concurrency, maxQueued);
  return (request, next) => requestPool.run(() => next(request));
};
