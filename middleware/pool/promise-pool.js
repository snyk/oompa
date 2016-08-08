const EventEmitter = require('events');

class PromisePool extends EventEmitter {
  constructor(concurrency=10, maxQueued=30) {
    super();
    this._concurrent = concurrency;
    this._maxQueued = maxQueued;
    this._queued = 0;
    this._active = new Set();
    this.on('done', p => {
      this._active.delete(p);
    });
  }

  wrap(factory) {
    return () => this.run(factory);
  }

  run(factory) {
    if (this._active.size < this._concurrent) {
      const p = factory().then(result => {
        this.emit('done', p);
        return result;
      }).catch(err => {
        this.emit('done', p);
        throw err;
      });
      this._active.add(p);
      return p;
    }

    if (this._queued < this._maxQueued) {
      this._queued++;
      return new Promise((resolve, reject) => {
        this.once('done', () => {
          this._queued--;
          this.run(factory).then(resolve).catch(reject);
        });
      });
    }

    return Promise.reject(new Error('Queue size exceeded'));
  }
}

module.exports = PromisePool;
