'use strict';

class ChangeTracker {
  constructor() {
    this.seen = new Set();
    this.seeded = false;
  }

  newItems(items, getId) {
    const fresh = items.filter(item => !this.seen.has(getId(item)));
    for (const item of items) this.seen.add(getId(item));
    const shouldEmit = this.seeded && fresh.length > 0;
    this.seeded = true;
    return shouldEmit ? fresh : [];
  }

  reset() {
    this.seen.clear();
    this.seeded = false;
  }
}

module.exports = ChangeTracker;
