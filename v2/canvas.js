import { Show, createEffect, onCleanup } from "solid-js";
import html from "solid-js/html";
import { POSITION_LAYOUT, TEXT_LAYOUT, textScaleCqw } from "./model.js";

export function Video(props) {
  let element;
  createEffect(() => {
    if (element) element.srcObject = props.source?.stream ?? null;
  });
  onCleanup(() => {
    if (element) element.srcObject = null;
  });
  return html`<video ref=${node => element = node} autoplay playsinline muted disablepictureinpicture></video>`;
}

function PlainText(props) {
  let element;
  let pasted = false;
  let pasteRequest = 0;
  let focusRequest = 0;
  let disposed = false;

  createEffect(() => {
    const value = props.value ?? "";
    if (element && document.activeElement !== element && element.innerText !== value) element.innerText = value;
  });

  createEffect(() => {
    const requested = props.focusRequested;
    const editable = props.editable;
    const request = ++focusRequest;
    if (!requested || !editable || !element) return;
    queueMicrotask(() => {
      if (!disposed && request === focusRequest && props.focusRequested && element.isConnected) element.focus();
    });
  });

  const input = event => {
    const fromPaste = event.inputType === "insertFromPaste" || pasted;
    pasted = false;
    pasteRequest++;
    props.onInput?.(event.currentTarget.innerText, { pasted: fromPaste });
  };

  const paste = () => {
    const request = ++pasteRequest;
    pasted = true;
    queueMicrotask(() => {
      if (request === pasteRequest) pasted = false;
    });
  };

  const blur = event => {
    event.currentTarget.innerText = props.value ?? "";
    props.onBlur?.(event);
  };
  onCleanup(() => {
    disposed = true;
    focusRequest++;
    pasteRequest++;
  });

  return html`
    <div class="canvas-text"
      ref=${node => element = node}
      contenteditable=${() => props.editable ? "plaintext-only" : "false"}
      role=${() => props.editable ? "textbox" : undefined}
      aria-label=${() => props.editable ? props.label : undefined}
      aria-multiline=${() => props.editable ? "true" : undefined}
      spellcheck=${() => props.editable}
      onPaste=${paste}
      onInput=${input}
      onFocus=${event => props.onFocus?.(event)}
      onBlur=${blur}></div>
  `;
}

export function OutputCanvas(props) {
  let copyElement;
  let textElement;
  let measureRequest = 0;
  let disposed = false;
  const composition = () => props.composition;
  const hasVideo = () => Boolean(props.source?.stream && composition().videoMode !== "off");
  const hasCopy = () => Boolean(composition().text || composition().attribution);
  const position = () => POSITION_LAYOUT[composition().textPosition] ?? POSITION_LAYOUT["center-center"];
  const verticalRegion = () => composition().textPosition.split("-")[0];
  const style = () => ({
    "--aspect": `${composition().width} / ${composition().height}`,
    "--aspect-number": composition().width / composition().height,
    "--font-cqw": `${textScaleCqw(composition())}cqw`,
    "--line-height": TEXT_LAYOUT.lineHeight,
    "--safe-x": `${TEXT_LAYOUT.safeX * 100}%`,
    "--safe-top": `${TEXT_LAYOUT.safeTop * 100}%`,
    "--safe-bottom": `${TEXT_LAYOUT.safeBottom * 100}%`,
    "--copy-x": position()[0],
    "--copy-y": position()[1],
    "--text-align": position()[2]
  });

  createEffect(() => {
    composition().text;
    composition().textRows;
    composition().width;
    composition().height;
    const request = ++measureRequest;
    if (!props.measureOverflow || !props.onOverflow) return;
    queueMicrotask(() => {
      if (disposed || request !== measureRequest || !copyElement?.isConnected || !textElement?.isConnected) return;
      const copy = copyElement.getBoundingClientRect();
      const text = textElement.getBoundingClientRect();
      props.onOverflow(text.height > copy.height + 0.5 || text.width > copy.width + 0.5);
    });
  });
  onCleanup(() => {
    disposed = true;
    measureRequest++;
  });

  return html`
    <div class="canvas"
      classList=${() => ({ "has-video": hasVideo(), [`video-${composition().videoMode}`]: hasVideo() })}
      style=${style}>
      <${Show} when=${hasVideo}><${Video} source=${() => props.source} /><//>
      <${Show} when=${() => hasVideo() && hasCopy()}>
        <div class=${() => `scrim scrim-${verticalRegion()}`}></div>
      <//>
      <div class="canvas-copy" ref=${node => copyElement = node}>
        <div ref=${node => textElement = node}>
          <${PlainText}
            value=${() => composition().text}
            editable=${() => props.editable}
            label=${() => props.editorLabel}
            focusRequested=${() => props.focusRequested}
            onInput=${(value, meta) => props.onTextInput?.(value, meta)}
            onFocus=${event => props.onTextFocus?.(event)}
            onBlur=${event => props.onTextBlur?.(event)} />
        </div>
      </div>
      <div class="attribution">${() => composition().attribution}</div>
    </div>
  `;
}
