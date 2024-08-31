import { h } from "preact";
import { useState, useEffect } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

export default function View() {
  const [stream, setStream] = useState(null);
  const [state, setState] = useState({
    slideObject: null,
    presentationObject: null,
    showFullVideo: false,
    videoDeviceId: null,
  });
  const { slide, slideObject, presentationObject, showFullVideo, videoDeviceId } = state;
  const presentationIndex = slide?.[1];
  const slideIndex = slide?.[3];


  useEffect(() => {
    if (videoDeviceId) {
      navigator.mediaDevices
        .getUserMedia({
          video: {
            deviceId: videoDeviceId,
          },
        })
        .then((stream) => {
          setStream(stream);
        });
    } else {
      setStream(null);
    }
  }, [videoDeviceId]);

  useEffect(() => {
    const onMessage = (event) => {
      console.log("message", event.data);
      setState(event.data);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [setState]);

  // console.log({ slideObject });

  return html`
    ${slideObject &&
    html`<div
      class=${[
        "text-white position-absolute bottom-0 left-0 d-flex justify-content-center w-100 z-1 text-pre-wrap text-center fw-semibold h-100 text-shadow bg-gradient-dark",
        stream ? "align-items-end" : "align-items-center",
      ].join(" ")}
      style=${{
        fontSize: "6vh",
        padding: "5vh"
      }}>
      ${slideObject.content}
    </div>`}
    ${presentationObject?.attribution &&
    slideIndex === 0 &&
    html` <div
      class="position-absolute bottom-0 left-0 w-100 z-1 text-white text-pre-wrap opacity-25"
      style=${{ fontSize: "1.5vh", padding: "1vh" }}>
      ${presentationObject.attribution}
    </div>`}
    ${stream &&
    html` <video
      class=${[
        "h-100 w-100 position-absolute object-position-top",
        showFullVideo ? "object-fit-contain" : "object-fit-cover",
      ].join(" ")}
      autoplay
      playsinline
      muted
      srcObject=${stream} />`}
  `;
}
