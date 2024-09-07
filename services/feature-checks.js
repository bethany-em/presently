export function supportsPlaintextEditables() {
  const div = document.createElement("div");
  div.setAttribute("contenteditable", "PLAINTEXT-ONLY");
  return div.contentEditable === "plaintext-only";
}
