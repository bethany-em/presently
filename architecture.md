# Simpler Architecture for Presently

## Executive Summary

This document proposes a layered architectural simplification for the Presently presentation app. The current codebase has high cognitive load from path-based selection, duplicated logic, and mixed patterns. We propose a **selection model change** plus **five service extractions** to dramatically reduce complexity.

---

## Architecture Diagrams

### Current Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                    App                                       │
│  state: { deck, selected=["presentations", 0, "slides", 3] }               │
│  handleChange(el, key, value) → mutates path, clones deck                  │
└─────────────────────────────────────────────────────────────────────────────┘
                    │                              │
                    │ deck, selected               │ handleChange (path mutation)
                    ▼                              ▼
┌──────────────────────────────┐    ┌──────────────────────────────────────────┐
│            Deck              │    │  Props drilled through 3 levels:         │
│  wraps: onChange(p,i,el)     │    │  deck, selected, onChange, onSelect,     │
│  wraps: onSelect(p,i,el)     │    │  editable, setEditable, setDeck          │
└──────────────────────────────┘    └──────────────────────────────────────────┘
         │
         │ ["presentations", index].concat(el)  ← PATH WRAPPING
         ▼
┌──────────────────────────────┐
│        Presentation          │
│  wraps: onChange(s,i,el)     │
│  wraps: onSelect(s,i)        │
│  direct setDeck usage ╳      │  ← INCONSISTENT UPDATE PATH
└──────────────────────────────┘
         │
         │ ["slides", index]  ← MORE PATH WRAPPING
         ▼
┌──────────────────────────────┐
│           Slide              │
│  onChange(key, value)        │
│  final path arrives here     │
└──────────────────────────────┘

Problems:
• Path concatenation at every level
• Magic numbers (4=slide, 2=presentation)
• Direct setDeck bypasses handleChange
• selected?.length === 4 checks scattered
```

### Proposed Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                    App                                       │
│  state: { deck, selected={ presentationIndex: 0, slideIndex: 3 } }         │
│  updateDeck(key, value)                                                     │
│  updatePresentation(id, key, value)                                         │
│  updateSlide(id, key, value)                                                │
└─────────────────────────────────────────────────────────────────────────────┘
         │              │                  │                │
         │ deck         │ updateSlide      │ selected       │ updatePresentation
         ▼              ▼                  ▼                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Deck                                             │
│  createNavigator(deck, selected, setSelected)                                │
│  useSortable(ref, { items, onReorder, ... })                                 │
└──────────────────────────────────────────────────────────────────────────────┘
         │
         │ updateSlide, updatePresentation, setSelected (NO WRAPPING)
         ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                           Presentation                                        │
│  useSortable(ref, { items, onReorder, ... })                                 │
│  trySplitContent(content) → slides or null                                   │
└──────────────────────────────────────────────────────────────────────────────┘
         │
         │ updateSlide(slide.id, key, value), setSelected({ ...selected, slideIndex })
         ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Slide                                            │
│  selected={selected.slideIndex === index}                                    │
│  onChange=(key, value) => updateSlide(slide.id, key, value)                  │
└──────────────────────────────────────────────────────────────────────────────┘

Improvements:
• No path wrapping - functions called directly with IDs
• No magic numbers - { presentationIndex, slideIndex } is self-documenting
• Single update path through update* functions
• Navigation extracted to service
```

### Service Module Dependencies

```
                    ┌─────────────────┐
                    │      App        │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐   ┌────────────────┐   ┌───────────────┐
│   Deck.js     │   │ Presentation.js │   │   Preview.js  │
└───────┬───────┘   └───────┬────────┘   └───────┬───────┘
        │                   │                    │
        │    ┌──────────────┼──────────────┐     │
        │    │              │              │     │
        ▼    ▼              ▼              ▼     ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ navigation.js│  │slideParser.js│  │  viewSync.js │
│              │  │              │  │              │
│nextSlide()   │  │parseAttrib() │  │syncToView()  │
│prevSlide()   │  │detectSect()  │  │createViewSt()│
│nextPres()    │  │generateSlides│  │              │
│prevPres()    │  │trySplit()    │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
        │
        ▼
┌──────────────────┐
│useSortable.js    │
│                  │
│ - Setup Sortable │
│ - Handle reorder │
│ - Remap selection│
└──────────────────┘
```

### Selection Model Comparison

```
CURRENT: Path Array
═══════════════════

   ["presentations", 0, "slides", 3]
    └──── key ────┘└i┘└─ key ─┘└i┘

   Access:     deck["presentations"][0]["slides"][3]
   Check:      selected?.length === 4
   Navigate:   [...selected.slice(0,3), (selected[3]+1) % len]
   Problem:    Magic numbers, path mutation, fragile


PROPOSED: Index Object
═══════════════════════

   { presentationIndex: 0, slideIndex: 3 }
     └─────── readable keys ────────┘

   Access:     deck.presentations[sel.presentationIndex].slides[sel.slideIndex]
   Check:      selected?.slideIndex !== undefined
   Navigate:   { ...selected, slideIndex: (selected.slideIndex + 1) % len }
   Tradeoff:   Must remap indices on reorder
```

### Update Pattern Comparison

```
CURRENT: Generic handleChange with Path Mutation
════════════════════════════════════════════════

   Component                    App.handleChange
   ─────────                    ────────────────
   Slide:     onChange(key, val)
                    ↓
   Pres:      onChange(["slides", i], key, val)     // wrap path
                    ↓
   Deck:      onChange(["presentations", pi, "slides", si], key, val)  // wrap again
                    ↓
   App:       handleChange(path, key, val) {
                while (path.length > 0) {
                  current = current[path.shift()]    // MUTATES PATH!
                }
                current[key] = value
              }


PROPOSED: Specific Update Functions
════════════════════════════════════

   Component                    App Function
   ─────────                    ────────────
   Slide:     updateSlide(slide.id, key, val)      ──→  function updateSlide(id, key, val) {
                                                              const clone = structuredClone(deck);
                                                              for (p of clone.presentations) {
                                                                const s = p.slides.find(s => s.id === id);
                                                                if (s) { s[key] = val; break; }
                                                              }
                                                              return clone;
                                                            }

   Pres:      updatePresentation(p.id, key, val)   ──→  similar pattern

   Deck:      updateDeck(key, val)                 ──→  setDeck(d => ({ ...d, [key]: val }))

Benefits:
• Intention-revealing names
• No path construction
• No mutation
• Consistent pattern
```

---

## Problem Analysis

### Current Architecture Pain Points

| Problem | Location | Cognitive Load |
|---------|----------|----------------|
| Path array selection | `["presentations", 0, "slides", 3]` | Must understand magic numbers (2=presentation, 4=slide) |
| Path mutation | `handleChange` uses `.shift()` | Side effects, hard to trace |
| 60-line keyboard handler | deck.js:103-164 | Duplicated logic for each arrow key |
| Duplicate drag-drop | deck.js + presentation.js | Same Sortable setup in two files |
| 48-line slide splitting | presentation.js:57-104 | Inline regex, chunking, DOM updates |
| Mixed update patterns | `setDeck` bypasses `onChange` | Inconsistency, debugging difficulty |

### Mental Model Required Today

To understand the codebase, you must hold in your head:
1. Path arrays: `["presentations", index, "slides", index]`
2. Magic numbers: `length === 4` means slide, `length === 2` means presentation
3. Callback wrapping: each level concatenates to paths
4. Mutable path operations in `handleChange`
5. Two different update patterns (`onChange` vs direct `setDeck`)

---

## Proposed Architecture

### Core Change: Simplified Selection Model

**Replace path arrays with a simple object:**

```javascript
// Current
selected = ["presentations", 0, "slides", 3]

// Proposed
selected = { presentationIndex: 0, slideIndex: 3 }
```

**Why this is simpler:**

| Operation | Current | Proposed |
|-----------|---------|----------|
| Check if slide selected | `selected?.length === 4` | `selected?.slideIndex !== undefined` |
| Access selected slide | `deck[selected[0]][selected[1]][selected[2]][selected[3]]` | `deck.presentations[selected.presentationIndex].slides[selected.slideIndex]` |
| Navigate next slide | `["presentations", selected[1], "slides", (selected[3] + 1) % len]` | `{ ...selected, slideIndex: (selected.slideIndex + 1) % len }` |
| Select first slide | `["presentations", 0, "slides", 0]` | `{ presentationIndex: 0, slideIndex: 0 }` |

**Trade-off:** Index-based selection doesn't survive reordering automatically. Solution: during reorder, remap the index:

```javascript
// When presentations are reordered
const oldIndex = selected.presentationIndex;
const newIndex = orderMap.indexOf(oldIndex); // where did old item move to?
setSelected({ ...selected, presentationIndex: newIndex });
```

---

## Layer 1: Service Modules

### 1.1 Navigation Service

**Extract keyboard navigation logic to `services/navigation.js`:**

```javascript
// services/navigation.js

function scrollSelected() {
  document.querySelector(".selected")?.scrollIntoView({
    behavior: "auto",
    block: "center",
    inline: "center",
  });
}

export function createNavigator(deck, selected, setSelected) {
  const pCount = deck.presentations.length;

  const current = selected && {
    pIndex: selected.presentationIndex,
    sIndex: selected.slideIndex,
    sCount: deck.presentations[selected.presentationIndex].slides.length
  };

  return {
    nextSlide() {
      if (!current) return setSelected({ presentationIndex: 0, slideIndex: 0 });
      const next = (current.sIndex + 1) % current.sCount;
      setSelected({ ...selected, slideIndex: next });
      setTimeout(scrollSelected, 100);
    },

    prevSlide() {
      if (!current) return setSelected({ presentationIndex: 0, slideIndex: 0 });
      const prev = (current.sIndex + current.sCount - 1) % current.sCount;
      setSelected({ ...selected, slideIndex: prev });
      setTimeout(scrollSelected, 100);
    },

    nextPresentation() {
      if (!current) return setSelected({ presentationIndex: 0, slideIndex: 0 });
      const next = (current.pIndex + 1) % pCount;
      setSelected({ presentationIndex: next, slideIndex: 0 });
      setTimeout(scrollSelected, 100);
    },

    prevPresentation() {
      if (!current) return setSelected({ presentationIndex: 0, slideIndex: 0 });
      const prev = (current.pIndex + pCount - 1) % pCount;
      setSelected({ presentationIndex: prev, slideIndex: 0 });
      setTimeout(scrollSelected, 100);
    },

    deselect() {
      setSelected(null);
    }
  };
}
```

**Usage in deck.js:**

```javascript
// Before: 60 lines of switch statement
// After: 10 lines

useEffect(() => {
  if (editable) return;

  const nav = createNavigator(deck, selected, onSelect);

  const handler = (ev) => {
    if (!ev.target.hasAttribute('data-order')) return;
    switch (ev.key) {
      case "ArrowRight": nav.nextSlide(); break;
      case "ArrowLeft": nav.prevSlide(); break;
      case "ArrowDown": nav.nextPresentation(); break;
      case "ArrowUp": nav.prevPresentation(); break;
      case "Escape": nav.deselect(); break;
    }
  };

  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, [deck, selected, editable, onSelect]);
```

**Impact:** Reduces deck.js by ~50 lines, makes navigation testable.

---

### 1.2 Sortable Hook

**Extract drag-and-drop to `hooks/useSortable.js`:**

```javascript
// hooks/useSortable.js
import { useLayoutEffect } from "preact/hooks";
import Sortable from "sortable";

export function useSortable(ref, { items, onReorder, handle, itemClass, getSelectedIndex, onReselect }) {
  useLayoutEffect(() => {
    if (!ref.current) return;

    const sortable = new Sortable(ref.current, {
      draggable: `.${itemClass}`,
      handle: `.${handle}`,
      classes: { mirror: "d-none" },
    });

    sortable.on("drag:stopped", () => {
      const elements = ref.current.querySelectorAll(`.${itemClass}`);
      const orderMap = Array.from(elements).map(el => parseInt(el.dataset.order));
      const newItems = orderMap.map(i => items[i]);

      // Remap selection if needed
      if (getSelectedIndex && onReselect) {
        const oldIndex = getSelectedIndex();
        const newIndex = orderMap.indexOf(oldIndex);
        if (newIndex !== oldIndex && newIndex >= 0) {
          onReselect(newIndex);
        }
      }

      onReorder(newItems);
    });

    return () => sortable.destroy();
  }, [items, onReorder]);
}
```

**Usage in deck.js:**

```javascript
useSortable(ref, {
  items: presentations,
  onReorder: (new) => updateDeck("presentations", new),
  handle: ".presentation-draggable-handle",
  itemClass: sortGroup,
  getSelectedIndex: () => selected?.presentationIndex,
  onReselect: (newIdx) => setSelected({ ...selected, presentationIndex: newIdx })
});
```

**Usage in presentation.js:**

```javascript
useSortable(ref, {
  items: slides,
  onReorder: (new) => updatePresentation(presentation.id, "slides", new),
  handle: ".slide-draggable-handle",
  itemClass: sortGroup,
  getSelectedIndex: () => selected?.slideIndex,
  onReselect: (newIdx) => setSelected({ ...selected, slideIndex: newIdx })
});
```

**Impact:** Eliminates ~30 lines of duplicate code per component.

---

### 1.3 Slide Parser Service

**Extract slide splitting to `services/slideParser.js`:**

```javascript
// services/slideParser.js

const SECTION_PATTERNS = [
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

export function parseAttribution(content) {
  const lines = content.split('\n');
  let attrIndex = lines.findIndex(line => /song #/i.test(line));

  // Handle case where attribution has preceding content
  if (attrIndex >= 2 && lines[attrIndex - 1].trim() && !lines[attrIndex - 2].trim()) {
    attrIndex--;
  }

  return {
    content: lines.slice(0, attrIndex).join('\n'),
    attribution: attrIndex >= 0 ? lines.slice(attrIndex).join('\n') : ""
  };
}

export function detectSections(content) {
  return SECTION_PATTERNS
    .flatMap(pattern => [...content.matchAll(pattern)])
    .filter(Boolean)
    .sort((a, b) => a.index - b.index)
    .map((match, i, matches) => ({
      title: match[0].trim(),
      content: content.slice(match.index + match[0].length, matches[i + 1]?.index || content.length).trim()
    }));
}

function chunkLines(lines, size) {
  const chunks = [];
  for (let i = 0; i < lines.length; i += size) {
    chunks.push(lines.slice(i, i + size));
  }
  return chunks;
}

export function generateSlides(sections) {
  return sections.flatMap(section => {
    const lines = section.content.split("\n").filter(l => l.trim());
    const size = lines.length % 5 === 0 ? 5 : lines.length % 3 === 0 ? 3 : 4;
    return chunkLines(lines, size).map(chunk => ({
      title: section.title,
      content: chunk.join("\n"),
      id: crypto.randomUUID()
    }));
  });
}

export function trySplitContent(content) {
  const { content: main, attribution } = parseAttribution(content);
  const sections = detectSections(main);

  if (sections.length === 0) {
    return null;
  }

  return {
    attribution,
    slides: generateSlides(sections)
  };
}
```

**Usage in presentation.js:**

```javascript
import { trySplitContent } from "../services/slideParser.js";

function handleChangeSlide(index, key, value) {
  if (key === "content") {
    const split = trySplitContent(value);

    if (split && confirm("Split into multiple slides?")) {
      updatePresentation(presentation.id, "attribution", split.attribution);
      const newSlides = [...slides];
      newSlides.splice(index, 1, ...split.slides);
      updatePresentation(presentation.id, "slides", newSlides);
      return;
    }
  }

  updateSlide(slides[index].id, key, value);
}
```

**Impact:** Reduces handleChangeSlide from 48 lines to ~10 lines.

---

### 1.4 View Sync Helper

**Extract preview sync to `services/viewSync.js`:**

```javascript
// services/viewSync.js

export function syncToView(windowRef, iframeRef, state) {
  if (windowRef) windowRef.viewState = state;
  windowRef?.setViewState?.(state);
  iframeRef?.current?.contentWindow?.setViewState?.(state);
}

export function createViewState(deck, slide, presentationObject, slideObject, showFullVideo, videoSource) {
  return { deck, slide, presentationObject, slideObject, showFullVideo, videoSource };
}
```

**Usage in preview.js:**

```javascript
import { syncToView, createViewState } from "../services/viewSync.js";

useEffect(() => {
  const base = createViewState(deck, slide, presentationObject, slideObject, showFullVideo, videoSource);

  syncToView(stageWindow, stagePreviewRef, showStageVideo ? base : { ...base, videoSource: null });
  syncToView(audienceWindow, audiencePreviewRef, showAudienceVideo ? base : { ...base, videoSource: null });
}, [/* deps */]);
```

**Impact:** Reduces preview.js sync logic from ~20 lines to ~5 lines.

---

### 1.5 Update Functions

**Replace generic `handleChange` with specific functions in app.js:**

```javascript
// Current (app.js:48-63)
function handleChange(el, key, value) {
  setDeck(deck => {
    let clone = structuredClone(deck);
    if (el === "deck") {
      clone[key] = value;
    } else if (Array.isArray(el)) {
      let current = null;
      while (el.length > 0) {
        current = current ? current[el.shift()] : clone[el.shift()];
      }
      current[key] = value;
    }
    return clone;
  });
}

// Proposed
function updateDeck(key, value) {
  setDeck(deck => ({ ...deck, [key]: value }));
}

function updatePresentation(presentationId, key, value) {
  setDeck(deck => {
    const clone = structuredClone(deck);
    const p = clone.presentations.find(p => p.id === presentationId);
    if (p) p[key] = value;
    return clone;
  });
}

function updateSlide(slideId, key, value) {
  setDeck(deck => {
    const clone = structuredClone(deck);
    for (const p of clone.presentations) {
      const s = p.slides.find(s => s.id === slideId);
      if (s) { s[key] = value; break; }
    }
    return clone;
  });
}

function reorderPresentationSlides(presentationId, newSlides) {
  setDeck(deck => {
    const clone = structuredClone(deck);
    const p = clone.presentations.find(p => p.id === presentationId);
    if (p) p.slides = newSlides;
    return clone;
  });
}
```

**Impact:** Removes path mutation, makes updates intention-revealing.

---

## Layer 2: Component Simplification

### 2.1 Fix Direct setDeck Usage

**Current (presentation.js:108-114):**
```javascript
function handleAddPresentation(ev) {
  setDeck(deck => {
    let clone = structuredClone(deck);
    // ... bypasses onChange
  });
}
```

**Fixed:**
```javascript
function handleAddPresentation() {
  const newPresentation = { title: "New Presentation", slides: [], attribution: "", id: crypto.randomUUID() };
  const insertIndex = deck.presentations.indexOf(presentation) + 1;
  const newPresentations = [
    ...deck.presentations.slice(0, insertIndex),
    newPresentation,
    ...deck.presentations.slice(insertIndex)
  ];
  updateDeck("presentations", newPresentations);
}
```

---

### 2.2 Simplified Prop Signatures

**Current Slide props:**
```javascript
<Slide
  slide=${slide}
  order=${index}
  width=${width}
  height=${height}
  editable=${editable}
  setEditable=${setEditable}
  selected=${selectedSlide === slide}
  sortGroup=${sortGroup}
  onRemove=${...}
  onSelect=${...}
  onChange=${...}
/>
```

**With new architecture:**
```javascript
<Slide
  slide=${slide}
  index=${index}
  presentationId=${presentation.id}
  editable=${editable}
  selected=${selected?.slideId === slide.id}
  onSelect=${() => setSelected({ slideId: slide.id })}
  onChange=${(key, value) => updateSlide(slide.id, key, value)}
/>
```

Less prop drilling, more direct operations.

---

## Files Summary

| File | Action | Lines Changed |
|------|--------|---------------|
| `services/navigation.js` | **New** | ~40 lines |
| `hooks/useSortable.js` | **New** | ~30 lines |
| `services/slideParser.js` | **New** | ~60 lines |
| `services/viewSync.js` | **New** | ~15 lines |
| `components/app.js` | Modify | ~30 lines (replace handleChange) |
| `components/deck.js` | Modify | -50 lines (keyboard), -30 lines (sortable) |
| `components/presentation.js` | Modify | -40 lines (slide splitting), -30 lines (sortable) |
| `components/preview.js` | Modify | -15 lines (sync helper) |
| `components/slide.js` | Modify | Minor prop changes |

**Net impact:** ~150 lines of new utility code, ~200+ lines removed from components, significantly clearer architecture.

---

## Mental Model After Changes

To understand the codebase, you need to know:

1. **Selection**: `{ presentationIndex, slideIndex }` - simple object
2. **Updates**: `updateSlide(id, key, value)` - intention-revealing functions
3. **Navigation**: `nav.nextSlide()`, `nav.prevSlide()` - service methods
4. **Drag-drop**: `useSortable(ref, options)` - single hook
5. **Slide splitting**: `trySplitContent(content)` - pure function

No more magic numbers, path mutation, or callback wrapping.

---

## Alternative Considered: ID-Based Selection

Storing selection as `{ slideId: "uuid" }` was considered but rejected because:

**Pros:**
- Selection survives reordering automatically
- More semantic

**Cons:**
- Requires `findById` helper for every access
- Navigation requires finding index first
- More lookup overhead

**Decision:** Index-based with reorder remapping is simpler for this app's navigation-heavy use case.

---

## Alternative Considered: Preact Signals

Using `@preact/signals` would eliminate prop drilling entirely:

```javascript
// signals/app.js
export const deck = signal(initialDeck);
export const selected = signal(null);

// In any component
import { deck, selected } from "./signals/app.js";
const slide = useSignalEffect(() => {
  const sel = selected.value;
  return sel && deck.value.presentations[sel.presentationIndex].slides[sel.slideIndex];
});
```

**Pros:** No prop drilling, automatic reactivity
**Cons:** New dependency, different mental model

**Decision:** Keep as optional enhancement, not core to this architecture.

---

## Migration Path

### Phase 1: Add Services (No Breaking Changes)
1. Create `services/navigation.js`
2. Create `hooks/useSortable.js`
3. Create `services/slideParser.js`
4. Create `services/viewSync.js`
5. Refactor components to use them

### Phase 2: Change Selection Model
1. Update `app.js` state shape
2. Update `deck.js`, `presentation.js`, `preview.js` for new selection
3. Update keyboard navigation

### Phase 3: Update Props
1. Replace path-based `onChange` with specific update functions
2. Simplify component prop signatures
3. Remove `setDeck` direct usage

Each phase is independently deployable and testable.

---

## Verification

1. **Functional testing:**
   - Create/edit/delete presentations and slides
   - Drag-drop reorder (presentations and slides)
   - Keyboard navigation (arrows, escape)
   - Slide splitting with song lyrics
   - Preview windows sync

2. **Regression checks:**
   - All existing functionality works identically
   - No console errors
   - localStorage persistence works

3. **Code quality:**
   - No magic numbers
   - No path mutation
   - Consistent update patterns
   - Testable service functions
