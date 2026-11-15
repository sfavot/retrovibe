/**
 * Crédits (`CREDITS.ITF`, 419e88), écran de `ui/itf-window.ts` : après le titre, si l'intro n'a pas été passée (43b17a → 419e88). Seule autre entrée
 * dans l'exe : le contrôle 10000 de `CNTRLPNL.ITF` (422fc9 rejoue logo, titre et crédits), panneau que la version Windows ne montre
 * pas ; le menu principal n'a pas de bouton Crédits.
 *
 * - `CR_WINDOW` (33005) : les lignes de `CREDITS.RES` montent (`drawCredits`, police `goalfont.PFT`) ; quand plus aucune n'est
 *   visible, la fenêtre se ferme d'elle-même comme si l'on cliquait « Terminé » (41a054).
 * - `CR_HANDS` (33004) : les mains qui applaudissent (`CREDITS.ANM`, état 1), une image par tour (41a36b).
 * - « Terminé » (33006) : bouton par défaut et d'annulation (450d44) ; Entrée et Échap ferment.
 */
import type { Font } from "../data/font";
import type { Itf } from "../data/itf";
import type { RenderAssets } from "../render/assets";
import { drawAnmImage } from "../render/anm-draw";
import { CREDITS_SCROLL, creditsStep, drawCredits } from "../render/front";
import { imageOfState, stateLength } from "../render/itf-draw";
import type { Surface } from "../render/surface";
import type { ItfScreen, ItfWindow, ItfWindowOptions } from "./itf-window";

export const CREDITS = { done: 33006, window: 33005, hands: 33004 } as const;
/** Police des crédits ([0x481050] : `goalfont.PFT`, 43b335). */
export const CREDITS_FONT = "GOALFONT.PFT";
/**
 * Durée d'un tour de la fenêtre (supposée : la cadence 43b6aa(3) des autres boucles du jeu). À ce rythme, `creditsStep` donne un pixel
 * par tour.
 */
export const CREDITS_TICK_MS = 48;

export class CreditsScreen implements ItfScreen<"done"> {
  scroll: number = CREDITS_SCROLL.start;
  readonly options: Omit<ItfWindowOptions, "choose" | "onClose">;
  /** Image courante des mains, dans leur état. */
  private hands = 0;
  private last: number | null = null;
  private nextTick = 0;
  private readonly font: Font | null;

  constructor(
    private readonly assets: RenderAssets,
    readonly itf: Itf,
    private readonly lines: readonly string[],
    heading: string,
  ) {
    this.font = assets.font(CREDITS_FONT);
    this.options = {
      title: heading,
      defaultId: CREDITS.done,
      cancelId: CREDITS.done,
      texts: () => this.texts(),
      frame: (now) => this.frame(now),
      decorate: (surface, win) => this.decorate(surface, win),
    };
  }

  action(id: number): "done" | undefined {
    return id === CREDITS.done ? "done" : undefined;
  }

  /** Texte complet des crédits pour les lecteurs d'écran (les marques de titre retirées). */
  texts(): string[] {
    return [this.lines.map((l) => l.replace(/^[-_]/, "").trim()).filter(Boolean).join(". ")];
  }

  /** Un tour : défilement (41a0a5) et mains (41a36b, une image par tour, en boucle). */
  advance(now: number): void {
    this.scroll += creditsStep(this.last === null ? null : now - this.last);
    this.last = now;
    const h = this.handImages();
    this.hands = (this.hands + 1) % Math.max(1, h?.count ?? 1);
  }

  /** Images des mains : `CREDITS.ANM`, état de la valeur de CR_HANDS. */
  private handImages(): { anm: NonNullable<ReturnType<RenderAssets["anm"]>>; first: number; count: number } | null {
    const anm = this.itf.anm ? this.assets.anm(this.itf.anm) : null;
    const first = anm ? imageOfState(anm, this.itf.controls.find((c) => c.id === CREDITS.hands)?.value ?? 1) : -1;
    return anm && first >= 0 ? { anm, first, count: stateLength(anm, first) } : null;
  }

  /** Horloge de l'hôte : un tour toutes les `CREDITS_TICK_MS`. */
  private frame(now: number): boolean {
    if (now < this.nextTick) return false;
    this.nextTick = Math.max(now, this.nextTick + CREDITS_TICK_MS);
    this.advance(now);
    return true;
  }

  /** Mains (41a36b) et lignes des crédits ; plus aucune ligne visible : fermeture comme « Terminé » (41a054). */
  private decorate(surface: Surface, win: ItfWindow): void {
    const h = this.handImages();
    const c = this.itf.controls.find((k) => k.id === CREDITS.hands);
    if (h && c && this.hands > 0) drawAnmImage(surface, this.assets, h.anm, h.first + this.hands, c.x + win.origin.dx + c.unknown12, c.y + win.origin.dy + c.unknown14);
    const r = win.rect(CREDITS.window);
    if (!r || !this.font) return;
    if (!drawCredits(surface, this.font, this.lines, r, this.scroll)) win.queue(CREDITS.done);
  }
}
