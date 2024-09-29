import { h } from "preact";
import { useState, useEffect } from "preact/hooks";
import htm from "htm";
import { defaultDeck } from "./example.js";
import Deck from "./deck.js";
import VideoSources from "./video-sources.js";
import Preview from "./preview.js";

const html = htm.bind(h);

let initalDeck = defaultDeck;

// localStorage.removeItem("deck");
const localStorageDeck = localStorage.getItem("deck");
if (localStorageDeck) {
  try {
    const parsedDeck = JSON.parse(localStorageDeck);
    if (parsedDeck) {
      initalDeck = parsedDeck;
    }
  } catch (e) {
    console.error(e);
  }
}

function assignIds(deck) {
  deck.id = crypto.randomUUID();
  deck.presentations.forEach((presentation) => {
    presentation.id = crypto.randomUUID();
    presentation.slides.forEach((slide) => {
      slide.id = crypto.randomUUID();
    });
  });
  return deck;
}

initalDeck = assignIds(initalDeck);

export default function App() {
  const [deck, setDeck] = useState(initalDeck);
  const [selectedSlide, setSelectedSlide] = useState(null);
  const [selectedVideoSource, setSelectedVideoSource] = useState(null);

  useEffect(() => {
    localStorage.setItem("deck", JSON.stringify(deck));
  }, [deck]);

  function handleChange(el, key, value) {
    let clone = structuredClone(deck);

    if (el === "deck") {
      clone[key] = value;
    } else if (Array.isArray(el)) {
      console.log(el, key, value);
      let current = null;
      while (el.length > 0) {
        current = current ? current[el.shift()] : clone[el.shift()];
      }
      current[key] = value;
    }
    setDeck(clone);
  }

  console.log(deck);

  return html`
    <div class="row g-0 h-100">
      <div class="col-xl-9 d-flex flex-column">
        <div
          class="flex-grow-1 border-bottom border-secondary overflow-auto position-relative"
          style="max-height: 70vh">
          <${Deck} deck=${deck} selected=${selectedSlide} onSelect=${setSelectedSlide}  onChange=${handleChange} width=${480} height=${270} />
        </div>
        <${VideoSources} selected=${selectedVideoSource} onSelect=${setSelectedVideoSource} />
      </div>
      <div class="col-xl-3 border-start border-secondary">
        <${Preview} deck=${deck} slide=${selectedSlide} videoSource=${selectedVideoSource} width=${480} height=${270} />
      </div>
    </div>
  `;
}
