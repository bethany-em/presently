import { batch, createMemo, createSignal, onCleanup } from "solid-js";

export const stopStream = stream => stream?.getTracks().forEach(track => track.stop());

const previewConstraints = deviceId => ({
  video: deviceId ? {
    deviceId: { exact: deviceId },
    width: { ideal: 640 },
    height: { ideal: 360 },
    frameRate: { ideal: 15 }
  } : true,
  audio: false
});

const errorMessage = error => error?.message || String(error);

export function createMediaController({ mediaDevices, defer = queueMicrotask }) {
  const [cameras, setCameras] = createSignal([]);
  const [display, setDisplay] = createSignal(null);
  const [selectedKey, setSelectedKey] = createSignal(null);
  const [status, setStatus] = createSignal("");
  const pending = new Set();
  const endedStreams = new WeakSet();
  let cameraEpoch = 0;
  let sourceEpoch = 0;
  let disposed = false;
  let started = false;

  const sources = createMemo(() => display() ? [display(), ...cameras()] : cameras());
  const selected = createMemo(() => sources().find(source => source.key === selectedKey()) ?? null);
  const stopPending = stream => {
    pending.delete(stream);
    stopStream(stream);
  };
  const acquire = async promise => {
    const stream = await promise;
    if (disposed) {
      stopStream(stream);
      throw new Error("Media controller disposed");
    }
    pending.add(stream);
    return stream;
  };
  const adopt = stream => pending.delete(stream);

  const removeExact = (record, message = "") => {
    if (!record) return false;
    const current = record.kind === "display"
      ? display()?.stream === record.stream
      : cameras().some(camera => camera.stream === record.stream);
    if (!current) return false;
    const wasSelected = selected()?.stream === record.stream;
    batch(() => {
      if (record.kind === "display") setDisplay(null);
      else setCameras(items => items.filter(item => item.stream !== record.stream));
      if (wasSelected) setSelectedKey(null);
      if (message) setStatus(message);
    });
    return true;
  };

  const watch = record => {
    const onEnded = () => {
      endedStreams.add(record.stream);
      pending.delete(record.stream);
      const active = selected()?.stream === record.stream;
      removeExact(record, active ? "The active source ended." : "");
    };
    record.stream.getTracks().forEach(track => track.addEventListener?.("ended", onEnded, { once: true }));
    return record;
  };

  const cameraKey = (device, index, counts) => {
    const base = device.deviceId ? `camera:${device.deviceId}` : `camera:anonymous:${index + 1}`;
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    return count ? `${base}:${count + 1}` : base;
  };

  const refreshCameras = async () => {
    if (disposed) return false;
    const devices = mediaDevices();
    if (!devices?.getUserMedia || !devices?.enumerateDevices) {
      setStatus("Camera access requires the HTTPS Caddy URL.");
      return false;
    }
    const epoch = ++cameraEpoch;
    setStatus("Requesting camera permission…");
    const acquired = [];
    try {
      const probe = await acquire(devices.getUserMedia({ video: true, audio: false }));
      stopPending(probe);
      if (disposed || epoch !== cameraEpoch) return false;

      const listed = (await devices.enumerateDevices()).filter(device => device.kind === "videoinput");
      const counts = new Map();
      const results = await Promise.allSettled(listed.map(async (device, index) => {
        const key = cameraKey(device, index, counts);
        const stream = await acquire(devices.getUserMedia(previewConstraints(device.deviceId)));
        acquired.push(stream);
        return watch({
          key,
          deviceId: device.deviceId,
          kind: "camera",
          label: device.label || `Camera ${index + 1}`,
          stream
        });
      }));
      const resolved = results.filter(result => result.status === "fulfilled").map(result => result.value);
      const next = resolved.filter(record => !endedStreams.has(record.stream));
      resolved.filter(record => endedStreams.has(record.stream)).forEach(record => stopPending(record.stream));
      const failures = results.length - next.length;

      if (disposed || epoch !== cameraEpoch) {
        acquired.forEach(stopPending);
        return false;
      }
      if (listed.length && !next.length) {
        acquired.forEach(stopPending);
        setStatus("No cameras were available.");
        return false;
      }

      const previous = cameras();
      next.forEach(item => adopt(item.stream));
      batch(() => {
        setCameras(next);
        if (selectedKey()?.startsWith("camera:") && !next.some(item => item.key === selectedKey())) setSelectedKey(null);
        setStatus(next.length
          ? (failures ? `${failures} camera${failures === 1 ? "" : "s"} unavailable.` : "")
          : "No cameras found.");
      });
      previous
        .filter(item => !next.some(nextItem => nextItem.stream === item.stream))
        .forEach(item => stopStream(item.stream));
      return true;
    } catch (error) {
      acquired.forEach(stopPending);
      if (!disposed && epoch === cameraEpoch) setStatus(`Camera unavailable: ${errorMessage(error)}`);
      return false;
    }
  };

  const shareDisplay = async () => {
    if (disposed) return false;
    const devices = mediaDevices();
    if (!devices?.getDisplayMedia) {
      setStatus("Screen sharing is unavailable in this browser.");
      return false;
    }
    const epoch = ++sourceEpoch;
    setStatus("Choose a screen or window…");
    let stream;
    try {
      stream = await acquire(devices.getDisplayMedia({ video: true, audio: false }));
      if (disposed || epoch !== sourceEpoch) {
        stopPending(stream);
        return false;
      }
      const next = { key: "display", kind: "display", label: "Shared display", stream };
      const previous = display();
      adopt(stream);
      batch(() => {
        setDisplay(next);
        setSelectedKey(next.key);
        setStatus("");
      });
      watch(next);
      if (previous?.stream !== stream) stopStream(previous?.stream);
      return true;
    } catch (error) {
      if (stream) stopPending(stream);
      if (!disposed && epoch === sourceEpoch) setStatus(`Screen share cancelled: ${errorMessage(error)}`);
      return false;
    }
  };

  const toggleSource = key => {
    if (disposed || !sources().some(source => source.key === key)) return false;
    sourceEpoch++;
    batch(() => {
      setSelectedKey(current => current === key ? null : key);
      setStatus("");
    });
    return true;
  };

  const clearSelection = () => {
    sourceEpoch++;
    batch(() => {
      setSelectedKey(null);
      setStatus("");
    });
  };

  const hideSource = key => {
    const record = sources().find(source => source.key === key);
    if (!record) return false;
    if (record.kind === "camera") cameraEpoch++;
    else sourceEpoch++;
    removeExact(record);
    stopStream(record.stream);
    return true;
  };

  const start = () => {
    if (started || disposed) return;
    started = true;
    defer(() => {
      if (!disposed) void refreshCameras();
    });
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cameraEpoch++;
    sourceEpoch++;
    const owned = [...cameras(), display()].filter(Boolean);
    batch(() => {
      setCameras([]);
      setDisplay(null);
      setSelectedKey(null);
    });
    owned.forEach(item => stopStream(item.stream));
    [...pending].forEach(stopPending);
  };

  onCleanup(dispose);
  return {
    cameras,
    display,
    sources,
    selectedKey,
    selected,
    status,
    start,
    refreshCameras,
    shareDisplay,
    toggleSource,
    hideSource,
    clearSelection,
    dispose
  };
}
