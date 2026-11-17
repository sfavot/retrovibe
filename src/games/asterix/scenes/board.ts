import type { Hy8 } from "../../../engine/infogrames/data/hy8";
import type { Picture } from "../../../engine/infogrames/data/mcg";
import { screenRank, squareVisible } from "../game/rules";
import type { Player } from "../game/state";
import type { Runtime, Script } from "./runtime";

/**
 * Écran de jeu à 9 cases (`docs/asterix/engine.md` §9.3) : trois bandes de 66 pixels, panneau fixe à droite (portrait,
 * dé, marbre de route, carte). Seul le pion du joueur courant y est dessiné.
 */

/** Hauteur d'une bande du plateau. */
const BAND = 0x42;
/** Largeur de la zone qui défile (le panneau droit ne bouge pas). */
const BOARD_WIDTH = 0xfb;
/** Sprites de `m43sa.hy8`. */
export const SPRITE_PAWN = 0;
export const SPRITE_ARROW = 13;
export const SPRITE_CROSS = 14;
export const SPRITE_CHECK = 15;
const SPRITE_DOOR = 16;
/** Dé : coin haut gauche en (273, 88) ; face `d` fixe = sprite `2(d − 1) + 1`, image en mouvement = sprite `2d`. */
export const DIE_X = 0x111;
export const DIE_Y = 0x58;

/** Portraits `M43SB00{perso}.hy8` des joueurs (`DS:642f + 5j`), chargés par la boucle de partie. */
export class Board {
  /** `DS:69dc` : image affichée par le dernier dessin, que le défilement fait sortir. */
  private shown: Picture | null = null;
  private readonly portraits = new Map<number, Hy8>();

  constructor(private readonly rt: Runtime) {}

  get player(): Player {
    return this.rt.game.players[this.rt.game.current];
  }

  *loadPortraits(): Script {
    for (const { character } of this.rt.game.players) {
      this.portraits.set(character, yield* this.rt.load(this.rt.ctx.resources.hy8(`M43SB00${character}.hy8`)));
    }
  }

  /** Image de fond pour la rangée du haut : `M01DA0{nn}.mcg`, ou la variante « banquet final » quand le joueur a tous ses objets. */
  private backgroundName(): string {
    const { game } = this.rt;
    const top = game.topRow;
    if (this.player.objectCount >= game.objectsRequired && (top === 0 || top === 16 || top === 17)) {
      return top === 0 ? "M01DA020.mcg" : `M01DA0${top + 2}.mcg`;
    }
    return `M01DA0${String(top).padStart(2, "0")}.mcg`;
  }

  /** Couleurs 123 à 125 du pion (`DS:1d4b`), porte de prison, portrait et dé : le panneau et le décor du joueur courant. */
  private decorate(): void {
    const { rt, player } = this;
    rt.ctx.palette.colors.set(rt.tables.pawnColors[player.character], 123 * 3);
    if (player.inPrison) {
      const centre = rt.tables.pawnCenters[player.pos];
      rt.sprite(rt.boardSprites, SPRITE_DOOR, centre.x - 0x20, centre.y + screenRank(rt.game.topRow, player.pos) * BAND - 0x28);
    }
    const portrait = this.portraits.get(player.character);
    if (portrait) rt.sprite(portrait, 0, 0x104, 0x1b);
    rt.sprite(rt.boardSprites, (rt.game.die - 1) * 2 + 1, DIE_X, DIE_Y);
  }

  /**
   * `1d24:0618` : affiche le plateau pour la rangée `DS:6493`. Même rangée que la dernière fois : simple rechargement ;
   * une ou deux rangées plus bas : défilement ; sinon fondu au noir, chargement, fondu d'entrée.
   */
  *show(): Script {
    const { rt } = this;
    const { session, game } = rt;
    const picture = yield* rt.load(rt.ctx.resources.picture(this.backgroundName()));
    const previous = session.shownRow;
    if (previous !== game.topRow || previous === -1) {
      // `DS:19e1` (machine rapide) vaut 1 : le plateau défile.
      if (previous !== -1 && this.shown && (previous + 1 === game.topRow || previous + 2 === game.topRow)) {
        yield* this.scroll(picture, (game.topRow - previous) * BAND);
      } else {
        yield* rt.fadeOut();
        rt.draw(picture, 1);
        yield* rt.fadeIn();
      }
    }
    rt.draw(picture);
    session.shownRow = game.topRow;
    this.shown = picture;
    this.decorate();
  }

  /**
   * `1d24:038d` : défilement de 66 ou 132 pixels par pas de 2, sur 251 pixels de large. L'ancienne image est d'abord
   * réaffichée avec le panneau du joueur courant ; Échap ou un bouton coupe le défilement.
   */
  private *scroll(next: Picture, distance: number): Script {
    const { rt } = this;
    const { work } = rt.ctx.surface;
    rt.draw(this.shown!);
    this.decorate();
    yield;
    const old = work.slice();
    for (let offset = 2; offset <= distance; offset += 2) {
      rt.copyRect(old, 0, offset, 0, 0, BOARD_WIDTH, 199 - offset);
      rt.copyRect(next.pixels, 0, 199 - distance, 0, 199 - offset, BOARD_WIDTH, offset);
      if (rt.buttonHeld || rt.ctx.input.pressed("skip")) break;
      yield;
    }
  }

  /**
   * `1d24:1c6e` : dessine le pion du joueur courant et le dé. Si la case du pion n'est plus affichée, le plateau est
   * d'abord recalé (une rangée plus haut ou plus bas si elle est voisine, sinon sur la rangée du pion).
   */
  *drawPawn(yOffset = 0): Script {
    const { rt, player } = this;
    const { game } = rt;
    if (!squareVisible(game.topRow, player.pos)) {
      if (squareVisible(game.topRow, player.pos + 3)) game.topRow = game.topRow < 1 ? game.topRow + 17 : game.topRow - 1;
      else if (squareVisible(game.topRow, player.pos - 3)) game.topRow = (game.topRow + 1) % 18;
      else game.topRow = Math.floor(player.pos / 3);
      yield* rt.cleanup();
      yield* this.show();
      rt.commit();
    }
    this.pawn(yOffset);
  }

  /** Le pion (sprite 0, centré sur le point de la table `DS:1ded`) puis le dé à sa face courante. */
  pawn(yOffset = 0): void {
    const { rt, player } = this;
    const rank = screenRank(rt.game.topRow, player.pos);
    const centre = rt.tables.pawnCenters[player.pos];
    rt.sprite(rt.boardSprites, SPRITE_PAWN, centre.x - 0x20, centre.y + rank * BAND - 0x28 + yOffset);
    // Cases 24 et 38 : un morceau du décor repasse devant le bas du pion (`1481:07c3`, rectangle restauré du fond).
    const { background } = rt.ctx.surface;
    if (player.pos === 0x17) rt.copyRect(background, 0xda, rank * BAND + 0x27, 0xda, rank * BAND + 0x27, 0xf0 - 0xda + 1, 7);
    else if (player.pos === 0x25) rt.copyRect(background, 0x88, rank * BAND + 0x1f, 0x88, rank * BAND + 0x1f, 0x9f - 0x88 + 1, 7);
    rt.sprite(rt.boardSprites, (rt.game.die - 1) * 2 + 1, DIE_X, DIE_Y);
  }

  /** Rang à l'écran (0, 1 ou 2) de la case du joueur courant. */
  get rank(): number {
    return screenRank(this.rt.game.topRow, this.player.pos);
  }
}
