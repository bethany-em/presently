import { h } from "preact";
import { useState, useRef, useLayoutEffect } from "preact/hooks";
import Sortable from "sortable";
import htm from "htm";
import Slide from "./slide.js";

const html = htm.bind(h);

export default function Presentation({ deck, presentation, selected, editable, onChange, onSelect, onRemove }) {
  const ref = useRef(null);
  const [collapsed, setCollapsed] = useState(false);

  const { title, slides, attribution } = presentation;
  const presentationIndex = deck.presentations.indexOf(presentation);
  const sortContainer = `presentation-sort-container-${presentationIndex}`;
  const sortGroup = `presentation-sort-item-${presentationIndex}`;
  const selectedSlide = selected?.length === 4 && deck?.[selected[0]]?.[selected[1]]?.[selected[2]]?.[selected[3]];
  const height = 270;
  const width = 480;

  useLayoutEffect(() => {
    if (ref.current) {
      const sortable = new Sortable(ref.current, {
        draggable: `.${sortGroup}`,
        handle: ".slide-draggable-handle",
        classes: {
          mirror: "d-none",
        },
      });
      sortable.on("drag:stopped", handleReorderSlides);
      return () => sortable.destroy();
    }
  }, [slides, handleReorderSlides, onChange]);

  function handleReorderSlides() {
    const slideElements = ref.current.querySelectorAll(`.${sortGroup}`);
    console.log(slideElements)
    const newSlides = Array.from(slideElements).map((slideElement) => {
      const order = parseInt(slideElement.getAttribute("data-order"));
      return slides[order];
    });
    console.log(newSlides)
    const newSelectedIndex = newSlides.findIndex((slide) => slide === selectedSlide);
    onSelect(["slides", newSelectedIndex]);
    onChange([], "slides", newSlides);
  }

  function handleAddSlide() {
    const newSlide = { title: "", content: "", id: crypto.randomUUID() };
    const newSlides = slides.concat([newSlide]);
    onChange([], "slides", newSlides);
  }

  function handleRemoveSlide(index) {
    const newSlides = slides.filter((_, i) => i !== index);
    onChange([], "slides", newSlides);
  }

  return html`
    <div class=${`hover-highlight`}>
      <div class="p-2 visible-hover-parent">
        <div onClick=${() => setCollapsed(!collapsed)} class="d-flex justify-content-between align-items-center py-2 w-100 cursor-pointer">
          <div class="d-flex flex-grow-1">
            ${collapsed ? html`<i class="bi bi-caret-right me-2"></i>` : html`<i class="bi bi-caret-down me-2"></i>`}
            <input
              value=${title}
              class="bg-transparent text-light border-0 fw-semibold flex-grow-1"
              style="max-width: 500px"
              onClick=${(ev) => ev.stopPropagation()}
              placeholder="Enter Presentation Title"
              onChange=${(ev) => onChange([], "title", ev.target.value)} />
          </div>

          <button class="btn btn-sm btn-dark fw-semibold visible-hover-child presentation-draggable-handle me-1">Move</button>
          <button class="btn btn-sm btn-danger fw-semibold visible-hover-child" onClick=${onRemove}>Remove</button>
        </div>
      </div>
      <div class=${collapsed ? "d-none" : "d-block"}>
        <div ref=${ref} class=${`d-flex flex-wrap position-relative ${sortContainer}`}>
          ${slides.map(
            (slide, index) =>
              html`<${Slide}
                key=${`slide-${slide.id}`}
                order=${index}
                sortGroup=${sortGroup}
                editable=${editable}
                slide=${slide}
                width=${width}
                height=${height}
                selected=${selectedSlide === slide}
                onSelect=${() => onSelect(["slides", selectedSlide === slide ? null : index])}
                onRemove=${() => handleRemoveSlide(index)}
                onChange=${(key, value) => onChange(["slides", index], key, value)} />`
          )}
          ${editable &&
          html`<button class="btn btn-dark fw-semibold rounded-0 m-2" style=${{ width, height }} onClick=${handleAddSlide}>
            Add Slide
          </button>`}
        </div>
        <div class="p-2">
          <textarea
            value=${attribution}
            onInput=${(ev) => onChange([], "attribution", ev.target.value)}
            placeholder="Enter Attribution"
            class="bg-black small text-light border-0 p-1 w-100" />
        </div>
      </div>
    </div>
  `;
}
