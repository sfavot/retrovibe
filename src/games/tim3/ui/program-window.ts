/**
 * « Programmer » une pièce : `PROG<type>.ITF` (ouverture 425147, procédure 424ab0, boutons 424ce1). La logique est celle de
 * `engine/program.ts` (`PartProgram`), inchangée ; ce fichier la dessine et la relie aux contrôles.
 *
 * - Aperçu dans PP_WINDOW (24001, rappels 4255b4 / 4256d9) : l'état du choix courant de `PROGPART.ANM`, en boucle, une image par
 *   passe (redessin seulement si l'état a plus de 2 images), à partir de l'image 1 ; origine = centre de la fenêtre moins (148, 93),
 *   découpé à (x, y + 6, l − 1, h − 8). Remis à zéro à chaque changement de choix.
 * - Pistolet laser (27) : compteur dans PP_WINDOW, fond de couleur 0x14 en (x + 6, y + 5, l − 10, h − 6), « %d » en `RMN8_40.PFT`,
 *   couleur 15, centré (0x300) dans (x + 2, y + 1, l, h).
 * - Refus (boîtes 71, ballon 4, 425975) : croix sur l'aperçu tant que la pièce chevauche, en 0x14 puis 0x0C décalée d'un pixel ;
 *   « Terminé » ouvre alors GENERIC (31342 / 31343, bouton 31344) et la fenêtre reste ouverte.
 * - Réglettes (425a46) : balle 87 (masse, élasticité, densité, friction : 0 à 10) et seau 108 (0 à 5), flèches ±1 sans boucler.
 * - PP_UP / PP_DOWN : choix précédent / suivant (compteur : plus / moins), répétés bouton tenu (genre 5).
 * - PP_HELP (24079, PROG87) lance `TIMHELP.EXE` (4169c8) : non porté, grisé.
 * - Échap (0xFE64) ferme sans appliquer (425455 sauté) : `PartProgram.cancel`.
 */
import { readItf, type Itf } from "../data/itf";
import { BUCKET_MAX, type BallSetting, type PartProgram } from "../engine/program";
import { drawAnmImage, imageCount, stateStart } from "../render/anm-draw";
import type { RenderAssets } from "../render/assets";
import type { Rect } from "../render/editor-overlay";
import { drawTextBox, imageOfState, itfText, stateLength } from "../render/itf-draw";
import { mapColor } from "../render/palette";
import type { Surface } from "../render/surface";
import { copy } from "../copy";
import { openItfWindow, type ItfWindowHandle, type ItfWindowOptions, type ItfHost, type ItfSlider } from "./itf-window";
import { genericDialog } from "./menus";

export const PROG = { done: 24004, down: 24003, up: 24002, window: 24001, help: 24079 } as const;
/** Réglettes : glissière, bouton, flèches gauche et droite (425a46, table sur id − 0x5de4). */
export const PROG_SLIDERS: Readonly<Record<BallSetting | "bucket", { slider: number; knob: number; left: number; right: number }>> = {
  mass: { slider: 24054, knob: 24064, left: 24056, right: 24057 },
  elasticity: { slider: 24045, knob: 24062, left: 24047, right: 24048 },
  density: { slider: 24036, knob: 24063, left: 24038, right: 24039 },
  friction: { slider: 24076, knob: 24077, left: 24075, right: 24078 },
  bucket: { slider: 24066, knob: 24073, left: 24067, right: 24068 },
};
const BALL_MAX = 10;
/** Refus de « Terminé » : boîte, ballon ; bouton « OK » (31344). */
const REFUSAL = { box: 31342, balloon: 31343, ok: 31344 } as const;
const PROGPART_ANM = "PROGPART.ANM";
const COUNTER_FONT = "RMN8_40.PFT";

/** Animation de l'aperçu (4255b4) : état de l'ANM, image courante. */
class Preview {
  first = -1;
  count = 0;
  frame = 0;

  constructor(private readonly assets: RenderAssets) {}

  reset(state: number | null): void {
    const anm = this.assets.anm(PROGPART_ANM);
    this.first = anm && state !== null ? imageOfState(anm, state) : -1;
    this.count = anm && this.first >= 0 ? stateLength(anm, this.first) : 0;
    this.frame = 0;
  }

  /** Une passe ; vrai s'il faut redessiner (plus de 2 images). */
  step(): boolean {
    if (this.count === 0) return false;
    this.frame = (this.frame + 1) % this.count;
    return this.count > 2;
  }

  draw(surface: Surface, r: Rect): void {
    const anm = this.assets.anm(PROGPART_ANM);
    if (!anm || this.first < 0 || this.first + this.frame >= imageCount(anm) || stateStart(anm, this.first) < 0) return;
    const clip = surface.setClip(r.x, r.y + 6, r.width - 1, r.height - 8);
    drawAnmImage(surface, this.assets, anm, this.first + this.frame, r.x + Math.trunc(r.width / 2) - 148, r.y + Math.trunc(r.height / 2) - 93);
    surface.restoreClip(clip);
  }
}

/** Croix rouge du refus (425975). */
function drawRefusal(surface: Surface, r: Rect): void {
  const { x, y, width: w, height: h } = r;
  const dark = mapColor(0x14);
  const red = mapColor(0x0c);
  surface.line(x + 7, y + 8, x + w - 6, y + h - 3, dark);
  surface.line(x + 7, y + h - 3, x + w - 6, y + 8, dark);
  surface.line(x + 7, y + 7, x + w - 6, y + h - 4, red);
  surface.line(x + 7, y + h - 4, x + w - 6, y + 7, red);
}

export interface ProgramWindowOptions {
  /** Nom de la pièce (titre pour les lecteurs d'écran). */
  title: string;
  program: PartProgram;
  /** « Terminé » accepté. */
  changed(): void;
  /** Refus de « Terminé » : message du jeu (GENERIC), la fenêtre reste ouverte. */
  refuse(text: string, ok: number): void;
}

/** Fenêtre sans DOM (tests, rendu) : ITF et options. */
export function programWindow(assets: RenderAssets, itf: Itf, o: ProgramWindowOptions): { itf: Itf; options: ItfWindowOptions; finished(): boolean } {
  const prog = o.program;
  const preview = new Preview(assets);
  const restart = (): void => {
    preview.reset(prog.choice ? prog.choice.preview : null);
    // 425147 : 4255b4(0) puis 4255b4(fenêtre) : l'aperçu part de l'image 1.
    preview.step();
  };
  restart();
  let finished = false;

  const drawWindow = (surface: Surface, r: Rect): void => {
    if (prog.kind === "counter") {
      surface.fillRect(r.x + 6, r.y + 5, r.width - 10, r.height - 6, mapColor(0x14));
      const font = assets.font(COUNTER_FONT);
      if (font) drawTextBox(surface, font, String(prog.counter), { x: r.x + 2, y: r.y + 1, width: r.width, height: r.height }, { mode: 0, color: 15, flags: 0x300, font: COUNTER_FONT });
    } else preview.draw(surface, r);
    if (!prog.fits) drawRefusal(surface, r);
  };

  const sliders: ItfSlider[] = [];
  const steps: Record<number, () => void> = {};
  const present = new Set(itf.controls.map((c) => c.id));
  const addSlider = (key: BallSetting | "bucket", label: string, max: number, value: () => number, set: (v: number) => void): void => {
    const ids = PROG_SLIDERS[key];
    if (!present.has(ids.slider) || !present.has(ids.knob)) return;
    sliders.push({ slider: ids.slider, knob: ids.knob, max, label, value, set, page: 1 });
    steps[ids.left] = () => set(Math.max(0, value() - 1));
    steps[ids.right] = () => set(Math.min(max, value() + 1));
  };
  if (prog.kind === "ball") {
    const labels: Record<BallSetting, number> = { mass: 31335, elasticity: 31336, density: 31337, friction: 31341 };
    for (const key of ["mass", "elasticity", "density", "friction"] as const) {
      addSlider(key, itfText(assets, labels[key]), BALL_MAX, () => prog.ball[key], (v) => prog.setBall(key, v));
    }
  }
  if (prog.kind === "bucket") {
    addSlider("bucket", copy.programBucket, BUCKET_MAX, () => prog.bucket, (v) => {
      prog.setBucket(v);
      restart();
    });
  }

  const counter = prog.kind === "counter";
  const labels: Record<number, string> = { [PROG.up]: counter ? copy.programMore : copy.programPrevious, [PROG.down]: counter ? copy.programLess : copy.programNext, [PROG.help]: copy.help };
  for (const s of sliders) {
    const key = (Object.keys(PROG_SLIDERS) as (BallSetting | "bucket")[]).find((k) => PROG_SLIDERS[k].slider === s.slider)!;
    labels[PROG_SLIDERS[key].left] = copy.programSliderLess(s.label);
    labels[PROG_SLIDERS[key].right] = copy.programSliderMore(s.label);
  }

  return {
    itf,
    finished: () => finished,
    options: {
      title: o.title,
      state: { disabled: [PROG.help], draw: { [PROG.window]: drawWindow } },
      defaultId: PROG.done,
      labels,
      sliders,
      tick: () => prog.kind !== "counter" && preview.step(),
      choose: (id) => {
        if (id === PROG.up || id === PROG.down) {
          if (id === PROG.up) prog.up();
          else prog.down();
          restart();
          return true;
        }
        const step = steps[id];
        if (step) {
          step();
          return true;
        }
        if (id === PROG.done) {
          if (!prog.done()) {
            o.refuse(itfText(assets, prog.refusal === "balloon" ? REFUSAL.balloon : REFUSAL.box), REFUSAL.ok);
            return true;
          }
          finished = true;
          o.changed();
        }
        return false;
      },
    },
  };
}

/** Texte lisible du choix ou du compteur, pour les lecteurs d'écran. */
export function programStatus(prog: PartProgram): string {
  if (prog.kind === "counter") return copy.programCounter(prog.counter);
  return prog.choices.length ? copy.programChoice(prog.index + 1, prog.choices.length) : "";
}

/** Ouvre la fenêtre ; fermer sans « Terminé » annule (`PartProgram.cancel`). */
export function openProgramWindow(host: ItfHost, o: Omit<ProgramWindowOptions, "refuse"> & { onClose?(): void }): ItfWindowHandle {
  const itf = readItf(host.assets.index.get(`PROG${o.program.type}.ITF`));
  const w = programWindow(host.assets, itf, {
    ...o,
    refuse: (text, ok) => void genericDialog(host, { text, buttons: [ok], choose: () => undefined }),
  });
  return openItfWindow(host, w.itf, {
    ...w.options,
    status: () => programStatus(o.program),
    onClose: () => {
      if (!w.finished()) o.program.cancel();
      o.onClose?.();
    },
  });
}
