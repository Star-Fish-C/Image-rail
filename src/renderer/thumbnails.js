// Two bounded requests, with separate vertical-board and horizontal-lane visibility.
class ThumbnailLoader {
  constructor(board, api, onLaneVisible = () => {}) {
    this.api = api;
    this.entries = new Map();
    this.lanes = new Map();
    this.visibleLanes = new Map();
    this.preloadWidth = Math.max(board.clientWidth, 640);
    this.queue = [];
    this.running = 0;
    this.nextLease = 0;
    this.session = crypto.randomUUID();
    this.boardObserver = new IntersectionObserver((changes) => {
      for (const change of changes) {
        this.visibleLanes.set(change.target, change.isIntersecting);
        if (change.isIntersecting) onLaneVisible(change.target);
        for (const entry of this.entries.values()) {
          if (entry.lane === change.target) { entry.vertical = change.isIntersecting; this.update(entry); }
        }
      }
    }, { root: board, rootMargin: `${Math.max(board.clientHeight, 640)}px 0px` });
  }
  observe(card, img, projectPath, relativePath) {
    const lane = card.closest('.track-lane');
    if (!lane) return;
    const entry = { card, img, lane, projectPath, relativePath, vertical: this.visibleLanes.get(lane) || false, horizontal: false, generation: 0 };
    this.entries.set(card, entry);
    if (!this.lanes.has(lane)) {
      const observer = new IntersectionObserver((changes) => {
        for (const change of changes) {
          const entry = this.entries.get(change.target);
          if (entry) { entry.horizontal = change.isIntersecting; this.update(entry); }
        }
      }, { root: lane, rootMargin: `0px ${this.preloadWidth}px` });
      this.lanes.set(lane, observer);
      this.boardObserver.observe(lane);
    }
    this.lanes.get(lane).observe(card);
  }
  wanted(entry) {
    return entry.card.isConnected && entry.vertical && entry.horizontal && !entry.card.closest('.track.collapsed');
  }
  release(entry) {
    entry.generation += 1;
    entry.img.removeAttribute('src');
    if (entry.lease) this.api.releaseImageThumbnails([entry.lease]).catch(() => {});
    entry.lease = null;
    entry.loaded = false;
    entry.card.dataset.thumbnail = 'loading';
  }
  update(entry) {
    if (!this.wanted(entry)) { if (entry.loaded || entry.lease) this.release(entry); return; }
    if (entry.queued || entry.loading || entry.loaded || entry.failed) return;
    entry.queued = true;
    this.queue.push(entry);
    this.pump();
  }
  refresh() {
    for (const [card, entry] of this.entries) {
      if (!card.isConnected) {
        this.release(entry);
        this.lanes.get(entry.lane)?.unobserve(card);
        this.entries.delete(card);
      } else this.update(entry);
    }
    for (const [lane, observer] of this.lanes) {
      if (!lane.isConnected) {
        observer.disconnect(); this.lanes.delete(lane);
        this.boardObserver.unobserve(lane); this.visibleLanes.delete(lane);
      }
    }
  }
  retry(card) {
    const entry = this.entries.get(card);
    if (!entry) return;
    entry.failed = false;
    this.update(entry);
  }
  clear() {
    this.boardObserver.disconnect();
    for (const observer of this.lanes.values()) observer.disconnect();
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear(); this.lanes.clear(); this.visibleLanes.clear(); this.queue = [];
  }
  async load(entry) {
    const generation = ++entry.generation;
    const lease = `${this.session}-${++this.nextLease}`;
    entry.loading = true;
    entry.card.dataset.thumbnail = 'loading';
    try {
      const result = await this.api.getImageThumbnail({ projectPath: entry.projectPath, relativePath: entry.relativePath, leaseId: lease });
      if (generation !== entry.generation || !this.wanted(entry)) {
        await this.api.releaseImageThumbnails([lease]);
        return;
      }
      entry.lease = lease;
      entry.img.src = this.api.fileUrlFromPath(result.cachePath);
      await entry.img.decode();
      if (generation !== entry.generation || !this.wanted(entry)) { this.release(entry); return; }
      entry.loaded = true;
      entry.card.dataset.thumbnail = 'ready';
    } catch (error) {
      this.api.releaseImageThumbnails([lease]).catch(() => {});
      if (generation === entry.generation) {
        entry.failed = true;
        entry.card.dataset.thumbnail = 'error';
        entry.card.querySelector('.thumbnail-retry').title = String(error);
      }
    } finally {
      entry.loading = false;
      this.running -= 1;
      // Entries that scrolled away and back while a request completed can retry now.
      this.update(entry);
      this.pump();
    }
  }
  pump() {
    while (this.running < 2 && this.queue.length) {
      const entry = this.queue.shift();
      entry.queued = false;
      if (!this.wanted(entry)) continue;
      this.running += 1;
      this.load(entry);
    }
  }
}
