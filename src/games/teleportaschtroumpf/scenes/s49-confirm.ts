import { encodeCp437 } from "../../../data/cp437";
import { parseConfirmationTexts } from "../data/text";
import { measureText, type PfnFont } from "../data/font";
import type { Mcg } from "../data/mcg";
import type { Voc } from "../data/voc";
import { Menu, paletteHighlight } from "../engine/menu";
import { voiceName } from "../engine/paths";
import type { Scene, SceneContext } from "../engine/scene";
import { HOVER_COLOR, ScreenSnapshot } from "./common/choice";
import { CLICK_SOUND } from "./setup/common";
import { TEXT_COLOR, loadDefaultFont, wrapText } from "./common/text";

/** Messages dont le texte est déjà dessiné dans l'image (`S49_07T` OUI, `S49_08T` NON, `S49_12T`) : rien n'est redessiné. */
const TEXT_IN_IMAGE = new Set([6, 7, 11]);

/** Boîte de texte (`1823:000c`) : lignes de 190 px au plus, centrées dans 195 px à partir de x = 85, 20 px par ligne dès y = 10. */
export const TEXT_MAX_WIDTH = 0xbe;
const TEXT_BOX_LEFT = 0x55;
const TEXT_BOX_WIDTH = 0xc3;
const TEXT_TOP = 10;
const TEXT_LINE_HEIGHT = 20;

/** Entrée de palette du texte « Oui » (124) ; « Non » est la suivante (125). */
const PALETTE_YES = 124;

/**
 * S49 : confirmation Oui / Non (engine.md §1.5, `1823:000c(n)`).
 *
 * - reçoit : `n`, le numéro du message (0 à 11 ; clé `S49_(n+1)T` de `s49a.dat`) : 0 à 5 = abandon du Schtroumpf Costaud,
 *   Gourmand, Farceur, Bricoleur, Poète, Grognon (S46), 8 = tous (inutilisé), 9 = quitter (un joueur), 10 = quitter le jeu
 *   (S07 et S46) ;
 * - rend : `onDone(ctx, yes)` avec `yes` vrai (Oui) ou faux (Non) ;
 * - écran suivant : aucun imposé. Le rappel décide (`replace` pour aller ailleurs, `pop` si l'écran a été empilé par
 *   `askConfirmation(…, "push")` au-dessus d'un écran à reprendre) ;
 * - fonds et sons : `s49a001d.mcg`, `s49a.dat`, voix d'entrée `s49v%03dt.voc` (n + 1), voix d'aide `s49v007t.voc` (Oui) et
 *   `s49v008t.voc` (Non).
 *
 * Gauche / droite choisissent Oui / Non sans rebouclage (Oui au départ), clic gauche ou Espace valide l'élément choisi,
 * clic droit ou Entrée dit son nom. Échap n'a pas d'effet (l'original l'ignore).
 */
export function createConfirmScene(n: number, onDone: (ctx: SceneContext, yes: boolean) => void): Scene {
  return new ConfirmScene(n, onDone);
}

class ConfirmScene implements Scene {
  readonly step = 1;
  private mcg!: Mcg;
  private font!: PfnFont;
  private lines: Uint8Array[] = [];
  private entryVoice!: Voc;
  private done = false;
  private readonly snapshot = new ScreenSnapshot();
  private readonly menu = new Menu({
    axis: "horizontal",
    wrap: false,
    items: [{ voice: voiceName("s49v", 7) }, { voice: voiceName("s49v", 8) }],
    highlight: paletteHighlight(PALETTE_YES, HOVER_COLOR),
    changeSound: CLICK_SOUND,
    changeSoundIfIdle: true,
  });

  constructor(
    readonly n: number,
    private readonly onDone: (ctx: SceneContext, yes: boolean) => void,
  ) {
    if (!Number.isInteger(n) || n < 0 || n > 11) throw new RangeError(`S49 : message ${n} invalide (0 à 11)`);
  }

  async load(ctx: SceneContext): Promise<void> {
    const [mcg, font, texts, entryVoice] = await Promise.all([
      ctx.resources.mcg("s49a001d.mcg"),
      loadDefaultFont(ctx),
      ctx.resources.bytes("s49a.dat").then(parseConfirmationTexts),
      ctx.resources.voc(voiceName("s49v", this.n + 1)),
      this.menu.load(ctx),
    ]);
    this.mcg = mcg;
    this.font = font;
    this.entryVoice = entryVoice;
    const text = TEXT_IN_IMAGE.has(this.n) ? undefined : texts[`S49_${String(this.n + 1).padStart(2, "0")}T`];
    this.lines = text === undefined ? [] : wrapText(font, encodeCp437(text), TEXT_MAX_WIDTH);
  }

  enter(ctx: SceneContext): void {
    this.snapshot.take(ctx);
    ctx.palette.load(this.mcg.palette);
    ctx.surface.drawMcg(this.mcg);
    this.lines.forEach((line, i) => {
      const x = TEXT_BOX_LEFT + ((TEXT_BOX_WIDTH - measureText(this.font, line)) >> 1);
      ctx.surface.drawText(this.font, line, x, TEXT_TOP + i * TEXT_LINE_HEIGHT, TEXT_COLOR);
    });
    ctx.surface.commitBackground();
    ctx.fade.blackout();
    ctx.fade.in();
    this.menu.enter(ctx);
    ctx.voice.play(this.entryVoice);
    this.done = false;
  }

  update(ctx: SceneContext): void {
    // L'original attend la fin du fondu d'entrée avant de lire les entrées.
    if (this.done || ctx.fade.active) return;
    const event = this.menu.update(ctx);
    if (event?.kind === "validate") {
      this.done = true;
      ctx.voice.stop();
      this.onDone(ctx, event.index === 0);
    }
  }

  render(ctx: SceneContext): void {
    ctx.surface.restoreBackground();
  }

  exit(ctx: SceneContext): void {
    this.menu.exit(ctx);
    this.snapshot.restore(ctx);
  }
}
