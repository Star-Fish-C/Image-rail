(function (root) {
  class SaveController {
    constructor(write) {
      this.write = write;
      this.revision = 0;
      this.savedRevision = 0;
      this.pending = null;
    }
    markDirty() { this.revision += 1; }
    get dirty() { return this.revision !== this.savedRevision; }
    reset() {
      if (this.pending) throw new Error('保存仍在进行');
      this.revision = this.savedRevision = 0;
    }
    flush() {
      if (this.pending) return this.pending;
      const drain = async () => {
        while (this.dirty) {
          const revision = this.revision;
          await this.write();
          this.savedRevision = revision;
        }
      };
      this.pending = drain().finally(() => { this.pending = null; });
      return this.pending;
    }
  }
  if (typeof module !== 'undefined') module.exports = { SaveController };
  else root.SaveController = SaveController;
})(globalThis);
