/**
 * Générique à l'écran (`#credit1.crd`, `#credit2.crd` : lancé par une phrase de cinématique commençant par `#`). Réécriture de
 * `Credits` (engines/queen/credits.cpp, ScummVM, GPL v3 ou ultérieure) et de ses appels dans `Logic::update` et `Logic::displayRoom`
 * (`nextRoom`). Le fichier est lu par `data/credits.ts` en pages (ce qu'affiche un `.p`).
 *
 * Une page s'affiche d'un coup (une ligne de texte par `setText`) ; `.p N` la laisse N x 10 images, `.p 0` jusqu'au changement de pièce
 * (`nextRoom`) ; une fois toutes les pages montrées, le générique s'arrête. La police est unique (`.s` et `.b` n'ont pas d'effet à
 * l'écran, comme dans ScummVM).
 */

import type { Credits } from "../data/credits";
import type { Display } from "../render/display";
import { textWidth } from "../render/font";

/** Largeur d'une zone de la grille 3 x 3, et décalages des alignements (`Credits::update`). */
const LEFT_MARGIN = 8;
const CENTER_OFFSET = 54;
const RIGHT_OFFSET = 100;

export class CreditsRunner {
  running = true;
  private page = 0;
  /** Images restantes (> 0), 0 : prochaine page, -1 : jusqu'au changement de pièce. */
  private pause = 0;

  constructor(private readonly credits: Credits) {}

  /** `Credits::nextRoom` : la page qui attendait le changement de pièce s'efface. */
  nextRoom(display: Display): void {
    if (this.pause === -1) {
      this.pause = 0;
      display.clearTexts(0, 199);
    }
  }

  /** `Credits::update` : une fois par image. */
  update(display: Display): void {
    if (!this.running) return;
    if (this.pause > 0) {
      this.pause--;
      if (this.pause === 0) display.clearTexts(0, 199);
      return;
    }
    if (this.pause === -1) return;
    const page = this.credits.pages[this.page++];
    if (!page) {
      this.running = false;
      return;
    }
    for (const line of page.lines) {
      let x = line.zoneX + LEFT_MARGIN;
      if (line.align === "center") x = Math.max(LEFT_MARGIN, line.zoneX + CENTER_OFFSET - Math.trunc(textWidth(line.text) / 2));
      else if (line.align === "right") x = line.zoneX + RIGHT_OFFSET - textWidth(line.text);
      display.textCurrentColor(line.color);
      display.setText(x, line.y, line.text);
    }
    this.pause = page.pause;
  }
}
