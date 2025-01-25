import { h } from "preact";
import { useState, useEffect } from "preact/hooks";
import htm from "htm";
import { getUserMedia, getDisplayMedia } from "../services/media.js";

const html = htm.bind(h);

export default function VideoSources({ height = 200, selected = null, onSelect = console.log }) {
  const [devices, setDevices] = useState([]);
  const [hiddenDevices, setHiddenDevices] = useState([]);
  const [screenDevice, setScreenDevice] = useState(null);
  const addHiddenDevice = device => setHiddenDevices(devices => devices.concat(device))
  const shareScreen = () => getDisplayMedia().then(setScreenDevice).catch(() => setScreenDevice(null));
  const refreshDevices = () => getUserMedia().then(devices => { setHiddenDevices([]); setDevices(devices); })

  useEffect(() => {
    getUserMedia().then(setDevices);
  }, [setDevices]);

  // deselect screen device when it ends
  useEffect(() => {
    if (screenDevice?.stream) {
      const endedCallback = () => {
        if (selected === screenDevice) onSelect(null);
        setScreenDevice(null);
      };
      const videoTrack = screenDevice.stream.getVideoTracks()?.[0];
      videoTrack?.addEventListener("ended", endedCallback);
      return () => videoTrack?.removeEventListener("ended", endedCallback);
    }
  }, [selected, screenDevice, setScreenDevice]);

  return html`
    <div style=${{ maxHeight: height + 125 }} class="overflow-auto position-relative">
      <div class="top-0 position-sticky bg-dark p-2 pt-3 d-flex align-items-center z-1">
        <h1 class="h5 m-0">Video Sources</span>
        <button onClick=${shareScreen} class="btn btn-sm btn-outline-warning fw-semibold ms-3">
          Share Screen
        </button>
        <button onClick=${refreshDevices} class="btn btn-sm btn-outline-info fw-semibold ms-3">Refresh</button>
      </div>
      <div>
        ${[screenDevice]
      .concat(devices)
      .filter((device) => device?.stream && !hiddenDevices.includes(device.deviceId))
      .map(
        (device, deviceIndex) => html`
            <div
                onClick=${() => onSelect(selected !== device ? device : null)}
                class=${[
            "position-relative",
            "visible-hover-parent",
            "d-inline-block",
            "cursor-pointer",
            "bg-black",
            "m-2",
            selected && selected === device && "selected",
          ]
            .filter(Boolean)
            .join(" ")}>
                <video class="d-block" playsinline autoplay muted disablePictureInPicture srcObject=${device.stream} height=${height} />
                <small class="d-block text-center p-1 fw-semibold">${device.label || `Video Source ${deviceIndex}`}</small>
                <div class="position-absolute top-0 start-0 w-100 d-flex justify-content-end visible-hover-child">
                  <button class="btn btn-sm text-info slide-draggable-handle" hidden>
                    <i class="bi bi-arrows-move"></i>
                  </button>
                  <button class="btn btn-sm text-warning" onClick=${() => addHiddenDevice(device.deviceId)}>
                    <i class="bi bi-x-lg"></i>
                  </button>
                </div>
              </div>
            `
      )}
      </div>
    </div>
  `;
}
