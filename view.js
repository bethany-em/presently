import { h, render } from "preact";
import htm from "htm";
import View from "./components/view.js";

const html = htm.bind(h);
render(html`<${View} />`, window.view);
