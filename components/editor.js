import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

export default function Editor({ value, onChange, readonly, ...rest }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) {
      // only update the value if the user is not currently focused/typing (prevents losing cursor position)
      if (document.activeElement !== ref.current) {
        ref.current.innerText = value;
      }

      // update the value when unfocused (removes formatting)
      const onBlur = () => (ref.current.innerText = value);
      ref.current.addEventListener("blur", onBlur);
      return () => ref.current.removeEventListener("blur", onBlur);
    }
  }, [value]);

  return html`<div
    ref=${ref}
    data-editable
    onInput=${(ev) => onChange(ev.target.innerText)}
    contenteditable=${readonly ? "false" : "true"}
    ...${rest} />`;
}
