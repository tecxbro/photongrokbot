// Custom assets are data-only snapshots validated by the publishing host.
export function loaderAnimation(loader) {
  if (!loader) {
    const animation = new globalThis.MatrixCardCore.Animation(globalThis.GROKBOT_SQUARE);
    animation.name = 'Grokbot'; animation.id = 'grokbot'; return animation;
  }
  if (loader.kind === 'static') {
    const cells = Float64Array.from(loader.cells, value => Number(value) / 4);
    return { id: loader.id, name: loader.name, columns: loader.columns, rows: loader.rows,
      sampleLoop: () => cells };
  }
  const animation = new globalThis.MatrixCardCore.Animation(loader);
  animation.name = loader.name; animation.id = loader.id; return animation;
}
