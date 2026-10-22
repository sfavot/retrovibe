import { measureText, type PfnFont } from "../data/font";
import type { Mcg } from "../data/mcg";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../data/mcg";
import type { Voc } from "../data/voc";
import { TICKS_PER_SECOND } from "../engine/clock";
import type { Scene, SceneContext } from "../engine/scene";

/** Fonds, polices, texte et musique de `154c:052e`. */
const BACKGROUND = "s52d001d.mcg";
const FONT_REGULAR = "s52d2.pfn";
const FONT_BOLD = "s52d3.pfn";
const TEXT_FILE = "s52dsphi.doc";
const MUSIC = "s52m002m.voc";

/** Couleurs de police : contour 0x7E (noir dans la palette de `s52d001d.mcg`), texte 0x7F (blanc). */
const OUTLINE_COLOR = 0x7e;
const TEXT_COLOR = 0x7f;
/** Page de 15 lignes de 12 px dès y = 14 (`154c:03e8`) ; seules les lignes d'écran 20 à 179 sont recopiées (`154c:046e`). */
export const FIRST_LINE_Y = 14;
export const LINE_HEIGHT = 12;
export const VISIBLE_LINES = 15;
const WINDOW_TOP = 20;
const WINDOW_BOTTOM = 180;
/** Fin : attente d'un clic au plus 200 s (`1f33:0279(200)`), puis fondu au noir de 64 pas (`1523:01fa(0x40)`). */
export const FINAL_WAIT_SECONDS = 200;
const FADE_OUT_STEPS = 64;

const AT = 0x40;
const CHAR_BOLD = 0x31;
const CHAR_PART_2 = 0x32;
const CHAR_PART_3 = 0x33;

/**
 * Lignes du fichier de texte (octets CP437) : séparées par CR, LF ou CRLF, comme l'original qui remplace ces octets par 0.
 * Une ligne vide reste une ligne.
 */
export function parseCreditsText(bytes: Uint8Array): Uint8Array[] {
  const lines: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    const code = bytes[i];
    if (code !== 0x0a && code !== 0x0d) continue;
    lines.push(bytes.subarray(start, i));
    if (code === 0x0d && bytes[i + 1] === 0x0a) i++;
    start = i + 1;
  }
  if (start < bytes.length) lines.push(bytes.subarray(start));
  return lines;
}

/** Une ligne commence par `@` suivi du chiffre `digit` (`@1` police grasse, `@2` et `@3` repères de défilement). */
function hasTag(line: Uint8Array, digit: number): boolean {
  return line[0] === AT && line[1] === digit;
}

const ONE_BYTE = Array.from({ length: 256 }, (_, code) => Uint8Array.of(code));
const NO_LINE = new Uint8Array(0);

type Phase = "fadeIn" | "intro" | "credits" | "final" | "fadeOut" | "done";

/**
 * S52 : générique de fin (engine.md §1.1, `154c:052e`).
 *
 * - reçoit : rien ;
 * - rend : `onDone(ctx)` une fois le fondu final terminé ;
 * - écran suivant (décidé par `flow.ts`) : sortie du jeu, `ctx.host.exit()` ;
 * - fonds, polices et sons : `s52d001d.mcg`, `s52d3.pfn` (lignes `@1`), `s52d2.pfn`, texte `s52dsphi.doc`, musique
 *   `s52m002m.voc` en boucle.
 *
 * Défilement : une page de 15 lignes centrées, avec contour, qui monte d'un pixel par tick (60 px/s) dans la fenêtre y 20 à
 * 179. Le texte se déroule jusqu'à la ligne `@2`, puis jusqu'à la ligne `@3` ; un clic (au relâchement) ou Échap saute à
 * la ligne repère suivante. À `@3`, la page reste fixe jusqu'à un clic (200 s au plus), puis fondu au noir.
 *
 * **Fichier absent** (repli défensif, `s52dsphi.doc` est dans les fichiers extraits) : le texte est vide, le fond et la
 * musique s'affichent puis la page finale attend un clic. Rien n'est inventé.
 */
export function createCreditsScene(onDone: (ctx: SceneContext) => void): Scene {
  return new CreditsScene(onDone);
}

class CreditsScene implements Scene {
  readonly step = 1;
  private mcg!: Mcg;
  private regular!: PfnFont;
  private bold!: PfnFont;
  private music!: Voc;
  private lines: Uint8Array[] = [];
  private phase: Phase = "fadeIn";
  /** Index de la ligne du haut de la page, et décalage en pixels (0 à 11) de la montée. */
  private top = 0;
  private offset = 0;
  private firstBatch = true;
  /** Clic / Échap : 0 repos, 1 enfoncé, 2 relâché (`cRam000365ff`). */
  private skip: 0 | 1 | 2 = 0;
  private finalSince = 0;

  constructor(private readonly onDone: (ctx: SceneContext) => void) {}

  async load(ctx: SceneContext): Promise<void> {
    const [mcg, regular, bold, music, text] = await Promise.all([
      ctx.resources.mcg(BACKGROUND),
      ctx.resources.pfn(FONT_REGULAR),
      ctx.resources.pfn(FONT_BOLD),
      ctx.resources.voc(MUSIC),
      // Repli défensif : fichier illisible, texte vide (voir l'en-tête).
      ctx.resources.bytes(TEXT_FILE).catch(() => new Uint8Array(0)),
    ]);
    this.mcg = mcg;
    this.regular = regular;
    this.bold = bold;
    this.music = music;
    this.lines = parseCreditsText(text);
  }

  enter(ctx: SceneContext): void {
    ctx.palette.load(this.mcg.palette);
    ctx.surface.drawMcg(this.mcg, { asBackground: true });
    ctx.fade.blackout();
    ctx.fade.in();
    ctx.voice.stop();
    ctx.voice.setMusic(this.music);
    this.phase = "fadeIn";
    this.top = 0;
    this.offset = 0;
    this.firstBatch = true;
    this.skip = 0;
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "fadeIn":
        if (ctx.fade.active) break;
        if (this.lines.length === 0) this.startFinal(ctx);
        else this.phase = "intro";
        break;
      case "intro":
      case "credits":
        this.scroll(ctx);
        break;
      case "final":
        if (ctx.input.anyJustPressed("validate", "skip") || ctx.clock.ticks - this.finalSince >= FINAL_WAIT_SECONDS * TICKS_PER_SECOND) {
          ctx.fade.out(FADE_OUT_STEPS);
          this.phase = "fadeOut";
        }
        break;
      case "fadeOut":
        if (ctx.fade.active) break;
        this.phase = "done";
        ctx.voice.setMusic(null);
        ctx.voice.stop();
        this.onDone(ctx);
        break;
      case "done":
        break;
    }
  }

  render(ctx: SceneContext): void {
    const { surface } = ctx;
    surface.restoreBackground();
    if (this.phase === "fadeIn" || this.lines.length === 0) return;
    for (let k = 0; k < VISIBLE_LINES; k++) {
      this.drawLine(ctx, this.lines[this.top + k] ?? NO_LINE, FIRST_LINE_Y + k * LINE_HEIGHT - this.offset);
    }
    // Hors de la fenêtre, l'écran garde le fond (l'original ne recopie que les lignes 20 à 179).
    surface.work.set(surface.background.subarray(0, WINDOW_TOP * SCREEN_WIDTH), 0);
    surface.work.set(surface.background.subarray(WINDOW_BOTTOM * SCREEN_WIDTH, SCREEN_HEIGHT * SCREEN_WIDTH), WINDOW_BOTTOM * SCREEN_WIDTH);
  }

  /** Un pixel de montée (`154c:046e`, 12 pixels par ligne) ; aux changements de ligne, test des repères `@2` / `@3`. */
  private scroll(ctx: SceneContext): void {
    const held = ctx.input.pressed("validate") || ctx.input.pressed("skip") || ctx.input.anyJustPressed("validate", "skip");
    if (held) this.skip = 1;
    else if (this.skip === 1) this.skip = 2;

    if (++this.offset < LINE_HEIGHT) return;
    this.offset = 0;
    this.top++;
    if (this.firstBatch) {
      // Le premier pas de 12 pixels précède la boucle de l'original, qui remet le drapeau à zéro.
      this.firstBatch = false;
      this.skip = 0;
    }
    this.checkMarkers(ctx);
  }

  private checkMarkers(ctx: SceneContext): void {
    for (;;) {
      const digit = this.phase === "intro" ? CHAR_PART_2 : CHAR_PART_3;
      const reached = this.top >= this.lines.length || hasTag(this.lines[this.top], digit);
      if (!reached && this.skip !== 2) return;
      if (!reached) {
        // Saut au repère suivant ; sans repère, on va à la fin du texte.
        const next = this.lines.findIndex((line, i) => i >= this.top && hasTag(line, digit));
        this.top = next < 0 ? this.lines.length : next;
      }
      this.skip = 0;
      if (this.phase === "intro") this.phase = "credits";
      else return this.startFinal(ctx);
    }
  }

  private startFinal(ctx: SceneContext): void {
    this.phase = "final";
    this.offset = 0;
    this.finalSince = ctx.clock.ticks;
  }

  /** `154c:0214` : ligne centrée sur 320 px, contour de 8 passes décalées de ±1 px (0x7E) puis texte (0x7F). */
  private drawLine(ctx: SceneContext, line: Uint8Array, y: number): void {
    let text = line;
    let bold = false;
    if (line[0] === AT) {
      const tag = line[1];
      if (tag === CHAR_BOLD) bold = true;
      if (tag === CHAR_BOLD || tag === CHAR_PART_2 || tag === CHAR_PART_3) text = line.subarray(2);
    }
    if (text.length === 0) return;
    const font = bold ? this.bold : this.regular;
    // Police grasse : chaque lettre avance d'un pixel de moins (`154c:0214` passe −1 à `154c:018b` et `154c:01c6`).
    const spacing = bold ? -1 : 0;
    let width = 0;
    for (const code of text) width += measureText(font, ONE_BYTE[code]) + spacing;
    const x = Math.trunc((SCREEN_WIDTH - width) / 2);
    for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
      this.drawSpaced(ctx, font, text, x + dx, y + dy, OUTLINE_COLOR, spacing);
    }
    this.drawSpaced(ctx, font, text, x, y, TEXT_COLOR, spacing);
  }

  private drawSpaced(ctx: SceneContext, font: PfnFont, text: Uint8Array, x: number, y: number, color: number, spacing: number): void {
    let pen = x;
    for (const code of text) {
      const one = ONE_BYTE[code];
      ctx.surface.drawText(font, one, pen, y, color);
      pen += measureText(font, one) + spacing;
    }
  }
}
