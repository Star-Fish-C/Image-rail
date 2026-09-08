(function (root) {
  async function runSequentialImport(items, { cancelled, importOne, onSuccess, onProgress }) {
    const failures = [];
    let completed = 0, succeeded = 0;
    for (const item of items) {
      if (cancelled()) break;
      try {
        const result = await importOne(item);
        onSuccess(result);
        succeeded += 1;
      } catch (error) {
        failures.push({ name: item.name || item.url || '图片', error: String(error) });
      }
      completed += 1;
      onProgress(completed, items.length);
    }
    return { completed, succeeded, failures };
  }
  if (typeof module !== 'undefined') module.exports = { runSequentialImport };
  else root.runSequentialImport = runSequentialImport;
})(globalThis);
