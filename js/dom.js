// Tiny DOM helpers. All text goes through textContent, never innerHTML,
// so nothing stored or imported can ever be interpreted as markup.
const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(el, attrs, children) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const h = (tag, attrs, ...children) => apply(document.createElement(tag), attrs, children);
export const svg = (tag, attrs, ...children) => apply(document.createElementNS(SVG_NS, tag), attrs, children);
export const $ = (sel, root = document) => root.querySelector(sel);
