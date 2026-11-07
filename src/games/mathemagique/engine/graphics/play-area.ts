/**
 * Géométrie de l'écran de Math Workshop. La zone de jeu de l'original fait 576×432, centrée dans un écran noir de 640×480
 * (engine.md §4) : seul le présentateur du navigateur ajoute la bordure et la mise à l'échelle.
 */

export const PLAY_WIDTH = 576;
export const PLAY_HEIGHT = 432;

export const SCREEN_WIDTH = 640;
export const SCREEN_HEIGHT = 480;
export const PLAY_ORIGIN_X = (SCREEN_WIDTH - PLAY_WIDTH) / 2;
export const PLAY_ORIGIN_Y = (SCREEN_HEIGHT - PLAY_HEIGHT) / 2;
