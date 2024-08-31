import { h } from "preact";
import { useState, useEffect } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

let repeat = (els, n) => Array.from({ length: n }, () => els).flat();

export default function VideoSources({ height = 200, selected = null, onSelect = console.log }) {
  const [devices, setDevices] = useState([]);
  const [screenDevice, setScreenDevice] = useState(null);

  useEffect(() => {
    getUserMedia().then(setDevices);
  }, [setDevices]);

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
      <div class="top-0 position-sticky bg-dark p-2 pt-3 d-flex align-items-center">
        <h1 class="h5 m-0">Video Sources</span>
        <button onClick=${() => getUserMedia().then(setDevices)} class="btn btn-sm btn-outline-info fw-semibold ms-3">Refresh</button>
        <button onClick=${() => onSelect(null)} class="btn btn-sm btn-outline-warning fw-semibold ms-3">Deselect</button>
        <button hidden onClick=${() =>
          getDisplayMedia()
            .then(setScreenDevice)
            .catch(() => setScreenDevice(null))} class="btn btn-sm btn-outline-info fw-semibold ms-3">
          Share Screen
        </button>
      </div>
      <div>
        ${devices
          .concat([screenDevice])
          .filter((el) => el && el.stream)
          .map(
            (device) => html`
              <div
                onClick=${() => onSelect(device)}
                class=${[
                  "d-inline-block",
                  "cursor-pointer",
                  "bg-black",
                  "m-2",
                  selected && selected?.deviceId === device?.deviceId && "selected",
                ]
                  .filter(Boolean)
                  .join(" ")}>
                <video class="d-block" playsinline autoplay disablePictureInPicture srcObject=${device.stream} height=${height} />
                <small class="d-block text-center p-1 fw-semibold">${device.label}</small>
              </div>
            `
          )}
      </div>

    </div>
  `;
}

export async function getUserMedia() {
  await navigator.mediaDevices.getUserMedia({ video: true }); // request access to video
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter((device) => device.kind === "videoinput");
  for (const device of videoDevices) { // assign stream to each device
    device.stream = await navigator.mediaDevices.getUserMedia({ video: device });
  }
  return videoDevices;
}

export async function getDisplayMedia() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  return { stream, label: "Window" };
}
