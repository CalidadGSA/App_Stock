/** Breve pausa para que React renderice la tabla de impresión antes de `window.print()`. */
export function esperarRenderImpresion(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}
