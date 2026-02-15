# presently

A buildless presentation app built with Preact and htm.

## Getting Started

```bash
caddy run
```

---

## Development Guide: Buildless Preact with HTM

This project uses **Preact** with **htm** (Hyperscript Tagged Markup) to enable JSX-like syntax without any build step, bundler, or transpiler. Everything runs directly in the browser using ES Modules.

### Why Buildless?

- **No build configuration** - No webpack, vite, or babel needed
- **Instant development** - Changes refresh immediately without compilation
- **Simple deployment** - Just serve static files
- **Smaller bundle** - htm is <500 bytes gzipped with Preact

---

### Core Setup

#### 1. Import Map (in HTML)

Define module aliases in your HTML for clean imports:

```html
<script type="importmap">
{
  "imports": {
    "preact": "https://esm.sh/preact@10.23.2",
    "preact/hooks": "https://esm.sh/preact@10.23.2/hooks",
    "htm": "https://esm.sh/htm@3.1.1"
  }
}
</script>
```

#### 2. Entry Point Pattern

Every entry point (e.g., `main.js`) follows this pattern:

```js
import { h, render } from "preact";
import htm from "htm";
import App from "./components/app.js";

const html = htm.bind(h);
render(html`<${App} />`, document.getElementById("app"));
```

The key steps:
1. Import `h` (hyperscript function) from Preact
2. Import `htm` module
3. Bind htm to `h` creating the `html` template tag
4. Render your root component

#### 3. Component Pattern

Every component file uses this structure:

```js
import { h } from "preact";
import { useState, useEffect } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

export default function MyComponent({ prop1, prop2 }) {
  const [state, setState] = useState(null);

  return html`
    <div class="my-component">
      <h1>${prop1}</h1>
      <p>${state}</p>
    </div>
  `;
}
```

---

### HTM Syntax Reference

#### Components

Use `<${Component} />` syntax to embed component references:

```js
// Component with props
html`<${Header} title="Hello" subtitle=${dynamicValue} />`

// Component with children
html`<${Card}><p>Card content</p><//>`

// Self-closing (no children)
html`<${Button} onClick=${handleClick} />`
```

#### Props

```js
// String props (quotes optional for simple values)
html`<div class="container" id=main>...</div>`

// Dynamic props via interpolation
html`<div class=${className} style=${{ color: 'red' }}>...</div>`

// Boolean props
html`<input type="checkbox" checked=${isSelected} />`

// Spread props
html`<div ...${restProps}>...</div>`
```

#### Event Handlers

```js
// Inline arrow function
html`<button onClick=${() => setCount(count + 1)}>Click</button>`

// Named function reference
html`<form onSubmit=${handleSubmit}>...</form>`

// With stopPropagation
html`<div onClick=${(e) => { e.stopPropagation(); handleClick(); }}>...</div>`
```

#### Conditional Rendering

```js
// Ternary operator
${isVisible ? html`<span>Visible</span>` : html`<span>Hidden</span>`}

// Logical AND (for showing/hiding blocks)
${isLoading && html`<div class="spinner">Loading...</div>`}

// Complex conditionals
${items.length > 0 && html`
  <ul>
    ${items.map(item => html`<li key=${item.id}>${item.name}</li>`)}
  </ul>
`}
```

#### Lists and Mapping

```js
${items.map((item, index) => html`
  <div key=${item.id} data-index=${index}>
    ${item.name}
  </div>
`)}
```

Always include a `key` prop when rendering lists for efficient reconciliation.

#### Dynamic CSS Classes

```js
// Array with filter pattern (removes falsy values)
<div class=${[
  "base-class",
  isActive && "active",
  isDisabled && "disabled"
].filter(Boolean).join(" ")}>

// Simple ternary
<div class=${isOpen ? "open" : "closed"}>

// Template literal
<div class=`btn btn-${size} ${variant}`>
```

#### Styles

```js
// Object syntax (camelCase properties)
html`<div style=${{ fontSize: '16px', marginTop: '10px' }}>...</div>`

// String syntax
html`<div style="font-size: 16px; margin-top: 10px">...</div>`

// Dynamic values
html`<div style=${{ width: width + 'px', height: `${height}px` }}>...</div>`
```

#### Refs

```js
import { useRef } from "preact/hooks";

function MyComponent() {
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return html`<input ref=${inputRef} />`;
}
```

#### Fragments

Multiple root elements work naturally:

```js
return html`
  <h1>Title</h1>
  <p>Paragraph</p>
`;
```

---

### Key Differences from JSX

| JSX | HTM |
|-----|-----|
| `<Component />` | `<${Component} />` |
| `{...props}` | `...${props}` |
| `className` | `class` |
| `htmlFor` | `for` |
| Requires Babel | No build needed |
| Single root element | Multiple roots allowed |

---

### Project Structure

```
presently/
├── index.html          # Editor entry (with import map)
├── view.html           # Viewer entry
├── main.js             # Editor app bootstrap
├── view.js             # Viewer app bootstrap
├── components/
│   ├── app.js          # Main app component
│   ├── deck.js         # Deck container
│   ├── presentation.js # Presentation container
│   ├── slide.js        # Individual slide
│   ├── editor.js       # Contenteditable wrapper
│   ├── preview.js      # Multi-window preview
│   ├── view.js         # Presentation display
│   └── video-sources.js # Camera/screen capture
├── services/
│   ├── colors.js       # Color palette utilities
│   └── media.js        # Media device access
└── styles/
    └── *.css           # Stylesheets
```

---

### State Management

This project uses Preact's built-in `useState` hooks with a unidirectional data flow:

```js
function App() {
  const [deck, setDeck] = useState(initialDeck);
  const [selected, setSelected] = useState([]);

  // Handler for nested updates
  function handleChange(path, key, value) {
    const updated = structuredClone(deck);
    let target = updated;
    for (const segment of path) {
      target = target[segment];
    }
    target[key] = value;
    setDeck(updated);
  }

  return html`
    <${Deck}
      deck=${deck}
      selected=${selected}
      onChange=${handleChange}
      onSelect=${setSelected}
    />
  `;
}
```

---

### Dependencies

All dependencies are loaded via [esm.sh](https://esm.sh) CDN:

| Package | Version | Purpose |
|---------|---------|---------|
| preact | 10.23.2 | UI framework |
| htm | 3.1.1 | JSX-like templates without build |
| @shopify/draggable | 1.1.3 | Drag-and-drop sorting |
| bootstrap | 5.3.3 | CSS framework |
| bootstrap-icons | 1.11.3 | Icon font |

---

### Tips and Best Practices

1. **Always bind htm to h** - Every component file needs `const html = htm.bind(h)`
2. **Use key props** - Essential for list reconciliation
3. **Filter Boolean for classes** - `.filter(Boolean).join(" ")` pattern handles conditional classes cleanly
4. **Structured cloning** - Use `structuredClone()` for immutable state updates
5. **Event propagation** - Use `ev.stopPropagation()` to prevent event bubbling
5. **Optional chaining** - Use `?.` for safe property access in event handlers

---

### VS Code Setup

For syntax highlighting of htm templates:

1. Install the [lit-html extension](https://marketplace.visualstudio.com/items?itemName=bierner.lit-html)
2. Add to `.vscode/settings.json`:
```json
{
  "editor.quickSuggestions": {
    "other": true,
    "comments": false,
    "strings": true
  }
}
```

---

### Resources

- [Preact Documentation](https://preactjs.com/guide/v10/getting-started)
- [HTM GitHub](https://github.com/developit/htm)
- [ESM.sh CDN](https://esm.sh)
- [Tagged Templates MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals#Tagged_templates)