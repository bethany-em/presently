import { h } from "preact";
import { useState, useEffect } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

export default function View() {
  const [state, setState] = useState(window.viewState || {
    slide: null,
    slideObject: null,
    presentationObject: null,
    showFullVideo: false,
    videoSource: null,
  });
  const { slide, slideObject, presentationObject, showFullVideo, videoSource } = state;
  const slideIndex = slide?.[3];

  useEffect(() => {
    // initialize view state on load
    window.viewState && setState(window.viewState);

    // register view state listener
    window.setViewState = setState;
    return () => window.setViewState = null;
  }, [setState]);

  return html`
    ${slideObject &&
    html`<div
      class=${[
        "text-white position-absolute bottom-0 left-0 d-flex justify-content-center w-100 z-1 text-pre-wrap text-center fw-semibold h-100 text-shadow bg-gradient-dark",
        videoSource?.stream ? "align-items-end" : "align-items-center",
      ].join(" ")}
      style=${{
        fontSize: "6.5vh",
        padding: "5vh",
      }}>
      ${slideObject.content}
    </div>`}
    ${presentationObject?.attribution &&
    slideIndex === 0 &&
    html`<div
      class="position-absolute bottom-0 left-0 w-100 z-1 text-white text-pre-wrap opacity-25"
      style=${{ fontSize: "1.5vh", padding: "1vh" }}>
      ${presentationObject.attribution}
    </div>`}
    ${videoSource?.stream &&
    html`<video
      class=${[
        "h-100 w-100 position-absolute object-position-top",
        showFullVideo ? "object-fit-contain" : "object-fit-cover",
      ].join(" ")}
      autoplay
      playsinline
      muted
      disablePictureInPicture       
      srcObject=${videoSource?.stream} />`}
  `;
}
