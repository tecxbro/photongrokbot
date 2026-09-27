// Theme is saved card data. Local/demo queries only select a preview palette.
const initial = JSON.parse(document.getElementById('card-data')?.textContent || '{}');
const preview = location.pathname.startsWith('/demo/') ? new URLSearchParams(location.search).get('theme') : null;
export let cardTheme;
export const matrixPalette = {};
const palettes = {
  dark: { off: 25, on: 255, background: '#000000' },
  light: { off: 240, on: 25, background: '#ffffff' },
};
export function setCardTheme(value) {
  const selected = ['light', 'dark'].includes(preview) ? preview : value;
  const next = selected === 'light' ? 'light' : 'dark';
  if (next === cardTheme) return;
  cardTheme = next;
  document.documentElement.dataset.cardTheme = cardTheme;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', cardTheme);
  Object.assign(matrixPalette, palettes[cardTheme]);
  window.dispatchEvent(new CustomEvent('cardthemechange', { detail: { theme: cardTheme } }));
}
setCardTheme(preview ?? initial.content?.theme);
