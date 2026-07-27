import { createSignal, onCleanup } from "solid-js";

export function createOutputController(host) {
  const targets = new Map();
  const latest = new Map();
  const [openIds, setOpenIds] = createSignal([]);
  const [statuses, setStatuses] = createSignal({});
  let disposed = false;

  const setStatus = (id, message) => setStatuses(current => {
    const next = { ...current };
    if (message) next[id] = message;
    else delete next[id];
    return next;
  });
  const loseConnection = (id, target) => {
    if (targets.get(id) !== target) return;
    targets.delete(id);
    setStatus(id, "Output connection was lost. Open it again.");
  };
  const refresh = () => {
    for (const [id, target] of targets) {
      if (!target || host.isClosed(target)) targets.delete(id);
    }
    setOpenIds([...targets.keys()]);
  };
  const send = (target, payload) => {
    if (!target || host.isClosed(target)) return false;
    return host.send(target, payload);
  };
  const deliverLatest = (id, target) => {
    const view = latest.get(id);
    if (!view || send(target, view)) return true;
    loseConnection(id, target);
    refresh();
    return false;
  };
  const connect = (target, id) => {
    if (disposed || !latest.has(id)) return false;
    targets.set(id, target);
    if (!deliverLatest(id, target)) return false;
    setStatus(id, "");
    refresh();
    return true;
  };
  const disconnect = (target, id) => {
    if (targets.get(id) !== target) return false;
    targets.delete(id);
    refresh();
    return true;
  };
  const removeBridge = host.installControllerBridge(connect, disconnect);

  const publish = viewStates => {
    if (disposed) return;
    const nextIds = new Set(viewStates.map(view => view.screenId));
    for (const id of latest.keys()) {
      if (!nextIds.has(id)) latest.delete(id);
    }
    for (const view of viewStates) latest.set(view.screenId, view);
    for (const [id, target] of targets) {
      const view = latest.get(id);
      if (view && !send(target, view)) loseConnection(id, target);
    }
    refresh();
  };

  const open = screen => {
    if (disposed) return false;
    const existing = targets.get(screen.id);
    if (existing && !host.isClosed(existing)) {
      host.focus(existing);
      return deliverLatest(screen.id, existing);
    }
    const width = 1280;
    const height = Math.round(width * screen.height / screen.width);
    const target = host.open(
      `?screen=${encodeURIComponent(screen.id)}`,
      `Presently-${screen.id}`,
      `width=${width},height=${height}`
    );
    if (!target) {
      setStatus(screen.id, "Popup blocked. Allow popups, then try again.");
      return false;
    }
    targets.set(screen.id, target);
    setStatus(screen.id, "");
    refresh();
    return true;
  };

  const retire = id => {
    const target = targets.get(id);
    if (target && !host.isClosed(target)) host.close(target);
    targets.delete(id);
    latest.delete(id);
    setStatus(id, "");
    refresh();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    removeBridge?.();
    for (const target of targets.values()) {
      if (!host.isClosed(target)) host.close(target);
    }
    targets.clear();
    latest.clear();
    setOpenIds([]);
  };

  onCleanup(dispose);
  return {
    openIds,
    statusFor: id => statuses()[id] ?? "",
    open,
    retire,
    publish,
    dispose
  };
}

export function createViewerConnection(host, screenId, initialView, defer = queueMicrotask) {
  const [view, setView] = createSignal(initialView);
  let disconnect;
  let disposed = false;

  const removeReceiver = host.installViewerReceiver(payload => {
    if (!disposed && payload?.screenId === screenId) setView(payload);
  });
  const connect = () => {
    if (disposed || disconnect) return;
    disconnect = host.connectToOpener(screenId);
  };
  const leave = () => {
    disconnect?.();
    disconnect = undefined;
  };
  const removeLifecycle = host.installPageLifecycle(leave, connect);
  defer(() => {
    if (!disposed) connect();
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    leave();
    removeLifecycle?.();
    removeReceiver?.();
  };

  onCleanup(dispose);
  return { view, dispose };
}
