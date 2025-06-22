import { h } from "preact";
import { useEffect, useState, useLayoutEffect, useRef } from "preact/hooks";
import Sortable from "sortable";
import htm from "htm";
import Presentation from "./presentation.js";

const html = htm.bind(h);

const scrollToSelector = (selector) => {
  document.querySelector(selector)?.scrollIntoView({
    behavior: "auto",
    block: "center",
    inline: "center",
  });
};

export default function Deck({ deck, selected, onSelect = () => {}, onChange = () => {} }) {
  const { title, presentations } = deck;
  const [editable, setEditable] = useState(false);
  const ref = useRef(null);
  const sortContainer = `deck-sort-container`;
  const sortGroup = `deck-sort-group`;
  const selectedPresentation = selected?.length >= 2 && deck?.[selected[0]]?.[selected[1]];
  const selectedSlide = selected?.length === 4 && deck?.[selected[0]]?.[selected[1]]?.[selected[2]]?.[selected[3]];

  const uniqueSlideTitles = Array.from(
    new Set(
      presentations
        .map((presentation) => presentation.slides.map((slide) => slide.title))
        .flat()
        .filter(Boolean)
    )
  ).sort();

  useLayoutEffect(() => {
    if (ref.current) {
      const sortable = new Sortable(ref.current, {
        draggable: `.${sortGroup}`,
        handle: ".presentation-draggable-handle",
        classes: {
          mirror: "d-none",
        },
      });
      sortable.on("drag:stopped", handleReorder);
      return () => sortable.destroy();
    }
  }, [presentations, handleReorder, onChange]);

  function handleReorder() {
    const presentationElements = ref.current.querySelectorAll(`.${sortGroup}`);
    const newPresentations = Array.from(presentationElements).map((presentationElement) => {
      const order = parseInt(presentationElement.getAttribute("data-order"));
      return presentations[order];
    });
    const newSelectedIndex = newPresentations.findIndex((presentation) => presentation === selectedPresentation);
    onSelect(["presentations", newSelectedIndex, selected[2], selected[3]]);
    onChange("deck", "presentations", newPresentations);
  }

  function handleAdd() {
    const newPresentation = { title: "", attribution: "", slides: [], id: crypto.randomUUID() };
    const newPresentations = presentations.concat([newPresentation]);
    onChange("deck", "presentations", newPresentations);
  }

  function handleRemove(index) {
    const newPresentations = presentations.filter((_, i) => i !== index);
    if (selectedPresentation) {
      if (selected[1] === index) {
        onSelect([]);
      }
      else  {
        const newSelectedIndex = newPresentations.findIndex((presentation) => presentation === selectedPresentation);
        onSelect(["presentations", newSelectedIndex, selected[2], selected[3]]);
      }
    }
    onChange("deck", "presentations", newPresentations);
  }

  async function handleImport(ev) {
    ev.preventDefault();
    if (!ev.target.files.length) return;
    const file = ev.target.files[0];
    const data = await file.text();
    const importedDeck = JSON.parse(data);
    onChange("deck", "id", crypto.randomUUID());
    onChange("deck", "title", importedDeck.title);
    onChange("deck", "presentations", importedDeck.presentations);
    ev.target.value = "";
  }

  function handleExport() {
    const data = JSON.stringify(deck, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${deck.title}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    const onKeyUp = (ev) => {
      if (editable || !ev.target.hasAttribute('data-order')) return;
      switch (ev.key) {
        case "Escape":
          onSelect([]);
          break;
        case "ArrowRight":
          if (selected?.length === 4) {
            const slideIndex = selected[3];
            const presentationIndex = selected[1];
            const numSlides = deck.presentations[presentationIndex].slides.length;
            const nextSlideIndex = (slideIndex + 1) % numSlides;
            onSelect(["presentations", presentationIndex, "slides", nextSlideIndex]);
            setTimeout(() => scrollToSelector(".selected"), 100);
          } else {
            onSelect(["presentations", 0, "slides", 0]);
            setTimeout(() => scrollToSelector(".selected"), 100);
          }
          break;
        case "ArrowLeft":
          if (selected?.length === 4) {
            const slideIndex = selected[3];
            const presentationIndex = selected[1];
            const numSlides = deck.presentations[presentationIndex].slides.length;
            const nextSlideIndex = (slideIndex + numSlides - 1) % numSlides;
            onSelect(["presentations", presentationIndex, "slides", nextSlideIndex]);
            setTimeout(() => scrollToSelector(".selected"), 100);
          } else {
            onSelect(["presentations", 0, "slides", 0]);
            setTimeout(() => scrollToSelector(".selected"), 100);
          }
          break;
        case "ArrowDown":
          if (selected?.length === 4) {
            const presentationIndex = selected[1];
            const numPresentations = deck.presentations.length;
            const nextPresentationIndex = (presentationIndex + 1) % numPresentations;
            onSelect(["presentations", nextPresentationIndex, "slides", 0]);
            setTimeout(() => scrollToSelector(".selected"), 100);
          } else {
            onSelect(["presentations", 0, "slides", 0]);
            setTimeout(() => scrollToSelector(".selected"), 100);
          }
          break;
        case "ArrowUp":
          if (selected?.length === 4) {
            const presentationIndex = selected[1];
            const numPresentations = deck.presentations.length;
            const nextPresentationIndex = (presentationIndex + numPresentations - 1) % numPresentations;
            onSelect(["presentations", nextPresentationIndex, "slides", 0]);
            setTimeout(() => scrollToSelector(".selected"), 100);
          } else {
            onSelect(["presentations", 0, "slides", 0]);
            setTimeout(() => scrollToSelector(".selected"), 100);
          }
          break;
      }
    };
    window.addEventListener("keydown", onKeyUp);
    return () => window.removeEventListener("keydown", onKeyUp);
  }, [deck, selected, onSelect, editable]);

  return html`
    <div class="d-flex align-items-center justify-content-between p-1 top-0 position-sticky z-2 bg-dark shadow">
      <input
        value=${title}
        class="bg-transparent text-light border-0 fw-semibold fs-3 flex-grow-1 me-3"
        onChange=${(ev) => onChange("deck", "title", ev.target.value)}
        placeholder="Enter Title" />
      <div class="d-flex align-items-center m-0">
        ${editable && html`
          <input type="file" class="visually-hidden" id="importDeck" accept="application/json" onChange=${handleImport} />
          <label for="importDeck" class="btn btn-sm btn-dark fw-semibold me-1">Import Deck</button>
          <button class="btn btn-sm btn-dark fw-semibold me-1" onClick=${handleExport}>Export Deck</button>
          <button class="btn btn-sm btn-dark fw-semibold me-1" onClick=${handleAdd}>Add Presentation</button>
        `}
        <div class="form-check form-check-inline form-switch m-0 me-2 ms-1">
          <label class="fw-semibold small  cursor-pointer" for="editModeToggle">Edit Mode</label>
          <input
            class="form-check-input  cursor-pointer"
            type="checkbox"
            role="switch"
            id="editModeToggle"
            checked=${editable}
            onChange=${(ev) => setEditable(ev.target.checked)} />
        </div>
      </div>
    </div>

    <div ref=${ref} class=${[sortContainer, "position-relative"].join(" ")}>
      ${presentations.map(
        (presentation, index) =>
          html`<div class=${sortGroup} data-order=${index} key=${presentation.id}>
            <${Presentation}
              deck=${deck}
              presentation=${presentation}
              editable=${editable}
              setEditable=${setEditable}
              selected=${selected}
              onRemove=${() => confirm(`Please confirm you wish to remove ${presentation.title}`) && handleRemove(index)}
              onSelect=${(el) => onSelect(["presentations", index].concat(el))}
              onChange=${(el, key, value) => onChange(["presentations", index].concat(el), key, value)} />
          </div>`
      )}
    </div>

    <datalist id="slide-titles">${uniqueSlideTitles.map((title) => html`<option value=${title} />`)}</datalist>
  `;
}
