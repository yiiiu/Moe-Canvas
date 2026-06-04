function getClipboardText(event) {
  return event?.clipboardData?.getData("text/plain") || "";
}

function insertTextAtSelection(target, text) {
  const selection = target.ownerDocument?.getSelection?.();
  if (!selection || selection.rangeCount === 0) {
    target.append(document.createTextNode(text));
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();

  const textNode = target.ownerDocument.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.setEndAfter(textNode);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function bindPlainTextPaste(target) {
  if (!target || target.__plainTextPasteBound) return;
  target.__plainTextPasteBound = true;

  target.addEventListener("paste", (event) => {
    const text = getClipboardText(event);
    if (!text) return;

    event.preventDefault();
    insertTextAtSelection(target, text);
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: text }));
  });
}