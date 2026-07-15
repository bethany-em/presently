import { createSignal } from "solid-js";

const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function createHistory({ snapshot, apply, limit = 50 }) {
  const past = [];
  const future = [];
  const [revision, setRevision] = createSignal(0);
  let transaction;

  const notify = () => setRevision(value => value + 1);
  const record = (label, before, after) => {
    if (equal(before, after)) return false;
    past.push({ label, before, after });
    if (past.length > limit) past.shift();
    future.length = 0;
    notify();
    return true;
  };

  const commit = () => {
    if (!transaction) return false;
    const { label, before, dirty } = transaction;
    transaction = undefined;
    if (!dirty) return false;
    const changed = record(label, before, snapshot());
    if (!changed) notify();
    return changed;
  };

  const begin = label => {
    commit();
    transaction = { label, before: snapshot(), dirty: false };
  };

  const touch = () => {
    if (!transaction || transaction.dirty) return;
    transaction.dirty = true;
    notify();
  };

  const run = (label, change) => {
    commit();
    const before = snapshot();
    const result = change();
    record(label, before, snapshot());
    return result;
  };

  const undo = () => {
    commit();
    const command = past.pop();
    if (!command) return false;
    future.push(command);
    apply(command.before);
    notify();
    return true;
  };

  const redo = () => {
    commit();
    const command = future.pop();
    if (!command) return false;
    past.push(command);
    apply(command.after);
    notify();
    return true;
  };

  const clear = () => {
    past.length = 0;
    future.length = 0;
    transaction = undefined;
    notify();
  };

  return {
    begin,
    touch,
    commit,
    run,
    undo,
    redo,
    clear,
    canUndo() {
      revision();
      return past.length > 0 || Boolean(transaction?.dirty);
    },
    canRedo() {
      revision();
      return !transaction?.dirty && future.length > 0;
    },
    undoLabel() {
      revision();
      return transaction?.dirty ? transaction.label : past.at(-1)?.label;
    },
    redoLabel() {
      revision();
      return future.at(-1)?.label;
    }
  };
}
