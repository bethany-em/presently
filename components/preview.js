import { h } from "preact";
import { useState, useRef, useEffect } from "preact/hooks";
import htm from "htm";
const html = htm.bind(h);

export default function Preview({ deck, slide, videoSource, height = 300, width = 400 }) {
  const presentationObject = slide?.length >= 2 && deck?.[slide[0]]?.[slide[1]];
  const slideObject = slide?.length === 4 && deck?.[slide[0]]?.[slide[1]]?.[slide[2]]?.[slide[3]];

  const stagePreviewRef = useRef(null);
  const audiencePreviewRef = useRef(null);

  const [stageWindow, setStageWindow] = useState(null);
  const [audienceWindow, setAudienceWindow] = useState(null);
  const [showFullVideo, setShowFullVideo] = useState(false);

  const presentationIndex = slide?.[1];
  const slideIndex = slide?.[3];

  useEffect(() => {
    const message = { deck, slide, presentationObject, slideObject, showFullVideo, videoDeviceId: null };
    if (stageWindow) {
      stageWindow.postMessage(message);
    }
    if (audienceWindow) {
      audienceWindow.postMessage({ ...message, videoDeviceId: videoSource?.deviceId });
    }
  }, [audienceWindow, stageWindow, deck, slide, slideObject, presentationObject, showFullVideo, videoSource]);

  useEffect(() => {
    const message = { deck, slide, presentationObject, slideObject, showFullVideo, videoDeviceId: null };
    if (stagePreviewRef.current) {
      stagePreviewRef.current.contentWindow.postMessage(message, "*");
    }
    if (audiencePreviewRef.current) {
      audiencePreviewRef.current.contentWindow.postMessage({ ...message, videoDeviceId: videoSource?.deviceId }, "*");
    }
  }, [audiencePreviewRef, stagePreviewRef, deck, slide, slideObject, presentationObject, showFullVideo, videoSource]);

  return html`
    <div class="p-2 d-flex align-items-center justify-content-between shadow">
      <h1 class="fs-3 mb-0">Preview</h1>
      <div class="form-check form-check-inline form-switch m-0">
        <label class="fw-semibold small cursor-pointer" for="showFullVideoToggle">Fit Video</label>
        <input
          class="form-check-input  cursor-pointer"
          type="checkbox"
          role="switch"
          id="showFullVideoToggle"
          checked=${showFullVideo}
          onChange=${() => setShowFullVideo(!showFullVideo)} />
      </div>
    </div>

    <div class="px-2 pt-4">
      <div class="d-flex align-items-center mb-1">
        <h1 class="h5 mb-0 me-2">Stage</h1>
        <button
          class="btn btn-sm btn-outline-warning fw-bold"
          onClick=${() => setStageWindow(open("view.html?title=Stage", "StageView", "width=400,height=300"))}>
          Open
        </button>
      </div>
      <iframe ref=${stagePreviewRef} src="view.html" height=${height} width=${width} />

      <hr />

        <div class="d-flex align-items-center mb-1">
          <h1 class="h5 mb-0 me-2">Audience</h1>
          <button
            class="btn btn-sm btn-outline-warning fw-bold"
            onClick=${() =>
              setAudienceWindow(open("view.html?title=Audience", "AudienceView", "width=400,height=300"))}>
            Open
          </button>
        </div>
        <iframe ref=${audiencePreviewRef} src="view.html" height=${height} width=${width} />
    </div>
  `;
}
