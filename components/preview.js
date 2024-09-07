import { h } from "preact";
import { useState, useRef, useEffect } from "preact/hooks";
import htm from "htm";
const html = htm.bind(h);

export default function Preview({ deck, slide, videoSource, height = 270, width = 480 }) {
  const presentationObject = slide?.length >= 2 && deck?.[slide[0]]?.[slide[1]];
  const slideObject = slide?.length === 4 && deck?.[slide[0]]?.[slide[1]]?.[slide[2]]?.[slide[3]];

  const stagePreviewRef = useRef(null);
  const audiencePreviewRef = useRef(null);

  const [stageWindow, setStageWindow] = useState(null);
  const [audienceWindow, setAudienceWindow] = useState(null);
  const [showFullVideo, setShowFullVideo] = useState(false);
  const [showAudienceVideo, setShowAudienceVideo] = useState(true);
  const [showStageVideo, setShowStageVideo] = useState(false);

  const presentationIndex = slide?.[1];
  const slideIndex = slide?.[3];

  useEffect(() => {
    const viewState = { deck, slide, presentationObject, slideObject, showFullVideo, videoSource };
    const stageViewState = showStageVideo ? viewState : { ...viewState, videoSource: null };
    const audienceViewState = showAudienceVideo ? viewState : { ...viewState, videoSource: null };

    // preload view state
    if (stageWindow) stageWindow.viewState = stageViewState;
    stageWindow?.setViewState?.(stageViewState);
    stagePreviewRef.current?.contentWindow?.setViewState?.(stageViewState);

    if (audienceWindow) audienceWindow.viewState = audienceViewState;
    audienceWindow?.setViewState?.(audienceViewState);
    audiencePreviewRef?.current?.contentWindow?.setViewState?.(audienceViewState);
  }, [
    audienceWindow,
    stageWindow,
    audiencePreviewRef,
    stagePreviewRef,
    deck,
    slide,
    slideObject,
    presentationObject,
    showFullVideo,
    videoSource,
    showStageVideo,
    showAudienceVideo,
  ]);

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
      <div class="d-flex align-items-center justify-content-between mb-1" style=${{ width }}>
        <div class="d-flex">
          <h1 class="h5 mb-0 me-2">Stage</h1>
          <button
            class="btn btn-sm btn-outline-warning fw-bold"
            onClick=${() =>
              setStageWindow(open("view.html?title=Stage", "StageView", `width=${width},height=${height}`))}>
            Open/Sync
          </button>
        </div>

        <div class="form-check form-check-inline form-switch m-0">
          <label class="fw-semibold small cursor-pointer" for="showStageVideo">Video</label>
          <input
            class="form-check-input cursor-pointer"
            type="checkbox"
            role="switch"
            id="showStageVideo"
            checked=${showStageVideo}
            onChange=${() => setShowStageVideo(!showStageVideo)} />
        </div>
      </div>
      <iframe ref=${stagePreviewRef} src="view.html" height=${height} width=${width} />

      <hr />
      <div class="d-flex align-items-center justify-content-between mb-1" style=${{ width }}>
        <div class="d-flex">
          <h1 class="h5 mb-0 me-2">Audience</h1>
          <button
            class="btn btn-sm btn-outline-warning fw-bold"
            onClick=${() =>
              setAudienceWindow(open("view.html?title=Audience", "AudienceView", `width=${width},height=${height}`))}>
            Open/Sync
          </button>
        </div>

        <div class="form-check form-check-inline form-switch m-0">
          <label class="fw-semibold small cursor-pointer" for="showAudienceVideo">Video</label>
          <input
            class="form-check-input cursor-pointer"
            type="checkbox"
            role="switch"
            id="showAudienceVideo"
            checked=${showAudienceVideo}
            onChange=${() => setShowAudienceVideo(!showAudienceVideo)} />
        </div>
      </div>
      <iframe ref=${audiencePreviewRef} src="view.html" height=${height} width=${width} />
    </div>
  `;
}
