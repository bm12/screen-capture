/** @returns {[HTMLCanvasElement, CanvasRenderingContext2D]} */
export const createCanvasAndCtx = (options = {}) => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', options.ctx);

  return [canvas, ctx];
}

/**
 * @param {HTMLElement} parrent
 * @param {Array<HTMLElement>} childs
 */
export const appendAll = (parrent, childs) => {
  childs.forEach((elem) => {
    parrent.appendChild(elem);
  });
};

/**
 * @param {string} wraperSelector
 * @param {boolean} hide
 */
export const setErrorElHidden = (wraperSelector, hide) => {
  const errorMsgEl = document.querySelector(wraperSelector)?.querySelector('.error');

  if (errorMsgEl) errorMsgEl.hidden = hide;
};
