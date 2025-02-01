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
    const newSlides = Array.from(slideElements).map((slideElement) => {
      const order = parseInt(slideElement.getAttribute("data-order"));
      return slides[order];
    });
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

  function handleChangeSlide(index, key, value) {
    if (key === "content") {
      const lines = value.split('\n');
      let attributionIndex = lines.findIndex(line => /song #/i.test(line));
      if (
        attributionIndex >= 2 &&
        lines[attributionIndex - 1].trim().length > 0 &&
        lines[attributionIndex - 2].trim().length === 0) {
        attributionIndex --;
      }
      const newValue = lines.slice(0, attributionIndex).join('\n');
      const newAttribution = attributionIndex >= 0 ? lines.slice(attributionIndex).join('\n') : "";
      const patterns = [
        /^intro.*\d*.*$/gim,
        /^verse.*\d*.*$/gim,
        /^chorus.*\d*.*/gim,
        /^bridge.*\d*.*/gim,
        /^pre.*chorus.*\d*.*/gim,
        /^instrumental.*\d*.*/gim,
        /^interlude.*\d*.*/gim,
        /^outro.*\d*.*/gim,
        /^ending.*\d*.*/gim,
        /^vamp.*\d*.*/gim,
        /^tag.*\d*.*/gim,
      ];

      const sections = splitIntoSections(newValue, patterns);
      if (sections.length && confirm("Do you want to split this slide into multiple slides?")) {
        onChange([], "attribution", newAttribution);
        const sectionSlides = sections.reduce((acc, section) => {
          const lines = section.content.split("\n").filter(line => line.trim().length);
          const contentChunks = chunk(lines, lines.length % 5 === 0 ? 5 : lines.length % 3 === 0 ? 3 : 4);
          const slides = contentChunks.map((chunk) => ({
            title: section.title,
            content: chunk.join("\n"),
            id: crypto.randomUUID(),
          }));
          return acc.concat(slides);
        }, []);
        let newSlides = [...slides];
        newSlides.splice(index, 1, ...sectionSlides);
        onChange([], "slides", newSlides);
        return;
      }
    }

    onChange(["slides", index], key, value);
  }

  return html`
    <div class="hover-highlight">
      <div class="p-2 visible-hover-parent  position-sticky bg-dark top-0 z-3">
        <div onClick=${(ev) => {setCollapsed(!collapsed); setTimeout(() => ev?.target?.parentElement?.scrollIntoView?.(), 10)}} class="d-flex justify-content-between align-items-center py-2 w-100 cursor-pointer" >
          <div class="d-flex flex-grow-1">
            ${collapsed ? html`<i class="bi bi-caret-right me-2"></i>` : html`<i class="bi bi-caret-down me-2"></i>`}
            <input
              value=${title}
              class="bg-transparent text-light border-0 fw-semibold flex-grow-1"
              style="max-width: 800px"
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
                onChange=${(key, value) => handleChangeSlide(index, key, value)} />`
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

/**
 * Chunk an array into smaller arrays of a specified size
 * @param {any[]} arr 
 * @param {number} size
 * @returns {any[][]} Subarrays of the original array
 */
function chunk(arr, size) {
  let chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Split text into sections based on patterns
 * @param {string} text
 * @param {RegExp[]} patterns
 * @returns {{title: string, content: string}[]}
 */
function splitIntoSections(text, patterns) {
  return patterns
    .flatMap((pattern) => [...text.matchAll(pattern)])
    .filter(Boolean)
    .sort((a, b) => a.index - b.index)
    .map((match, index, matches) => ({
      title: match[0].trim(),
      content: text.slice(match.index + match[0].length, matches[index + 1]?.index || text.length).trim(),
    }));
}
