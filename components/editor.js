import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

export default function Editor({ value, onChange, readonly, ...rest }) {
  const ref = useRef(null);

  // only update the value if the user is not currently focused/typing (prevents losing cursor position)
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) {
      ref.current.innerText = value;
    }
  }, [value]);

  return html`<div
    ref=${ref}
    data-editable
    onInput=${(ev) => onChange(ev.target.innerText)}
    contenteditable=${readonly ? "false" : "plaintext-only"}
    ...${rest} />`;
}
