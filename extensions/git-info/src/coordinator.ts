/**
 * Serializes refreshes: explicit ones queue behind whatever is running,
 * background ones are dropped entirely while anything is queued or running
 * so pollers and event bursts coalesce instead of piling up.
 */
export function makeRefreshCoordinator() {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;

  const enqueue = (task: () => Promise<void>) => {
    pending += 1;
    const run = tail.then(task).finally(() => {
      pending -= 1;
    });
    tail = run.catch(() => {});
    return run;
  };

  return {
    run: enqueue,
    runIfIdle: (task: () => Promise<void>) =>
      pending > 0 ? Promise.resolve() : enqueue(task),
    isIdle: () => pending === 0,
  };
}
