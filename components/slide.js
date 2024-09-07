import { h } from "preact";
import { useRef } from "preact/hooks";
import htm from "htm";
import Editor from "./editor.js";
import { getColor } from "../services/colors.js";

const html = htm.bind(h);

export default function Slide({
  slide,
  order,
  width = 300,
  height = 200,
  editable,
  selected,
  sortGroup = "",
  onRemove = () => {},
  onSelect = () => {},
  onChange = () => {},
}) {
  const { title, content } = slide;
  const editorRef = useRef(null);

  return html`
    <div
      class=${["position-relative m-2 visible-hover-parent", selected && "selected", sortGroup].join(" ")}
      data-order=${order}>
      ${editable &&
      html`<div class="position-absolute top-0 start-0 w-100 d-flex justify-content-between visible-hover-child">
        <button class="btn btn-sm text-info slide-draggable-handle">
          <i class="bi bi-arrows-move"></i>
        </button>
        <button class="btn btn-sm text-danger" onClick=${onRemove}>
          <i class="bi bi-x-lg"></i>
        </button>
      </div>`}
      <div
        ref=${editorRef}
        class=${[
          "bg-black fw-semibold text-light d-inline-flex flex-wrap align-items-center justify-content-center text-center text-pre-wrap overflow-hidden",
          !editable && "cursor-pointer",
        ]
          .filter(Boolean)
          .join(" ")}
        style=${{ width, height, fontSize: 0.075 * height }}
        onClick=${() => (editable ? editorRef.current?.querySelector('[data-editable]')?.focus?.() : onSelect({ title, content }))}
        onDblClick=${() => editable && onSelect({ title, content })}>
        <${Editor}
          readonly=${!editable}
          value=${content}
          onChange=${(value) => onChange("content", value)} />
      </div>

      <div class="d-flex" style=${{ backgroundColor: title ? getColor(title) : "#111" }}>
        <input
          class="d-block w-100 text-light border-0 text-center bg-transparent"
          onInput=${(ev) => onChange("title", ev.target.value)}
          value=${title}
          list="slide-titles" />
        ${title &&
        html`<button
          class="btn btn-sm bg-transparent py-0 text-light opacity-50"
          onClick=${() => onChange("title", "")}>
          <i class="bi bi-x-lg"></i>
        </button>`}
      </div>
    </div>
  `;
}
