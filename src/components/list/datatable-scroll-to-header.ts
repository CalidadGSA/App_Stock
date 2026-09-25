/** Vuelve la grilla al tope (cabecera visible) sin usar scrollIntoView sobre thead sticky. */
export function scrollDatatableToHeader(root: HTMLElement | null) {
  if (!root) return;

  const resetScrolls = () => {
    root.querySelectorAll<HTMLElement>('.datatable-rows-scroll').forEach((el) => {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    });
  };

  resetScrolls();

  // Anclar al section/toolbar (fuera del scroll de filas). El thead sticky
  // desfazaba ~1 fila si se usaba scrollIntoView sobre él.
  const anchor =
    root.querySelector<HTMLElement>('[data-datatable-scroll-anchor]') ?? root;
  anchor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Tras el paint (p. ej. cuando terminó el loading y montó la tabla).
  requestAnimationFrame(() => {
    resetScrolls();
    requestAnimationFrame(resetScrolls);
  });
}
