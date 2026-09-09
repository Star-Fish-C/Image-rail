const UI_ICON_PATHS = {
  up: 'm4 10 4-4 4 4', down: 'm4 6 4 4 4-4', left: 'm10 4-4 4 4 4', right: 'm6 4 4 4-4 4',
  minus: 'M3 8h10', plus: 'M3 8h10M8 3v10', close: 'm4 4 8 8M12 4l-8 8',
  maximize: 'M3 3h10v10H3z', undo: 'M6 3 2 7l4 4M2 7h7a4 4 0 0 1 4 4',
  organize: 'M3 2h10v3H3zM3 8h10M3 12h10',
  info: 'M8 7v5M8 4h.01M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1',
  more: 'M3 8h.01M8 8h.01M13 8h.01'
};
function uiIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'ui-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', UI_ICON_PATHS[name]);
  svg.append(path);
  return svg;
}
function setButtonIcon(button, name) { button.replaceChildren(uiIcon(name)); }
