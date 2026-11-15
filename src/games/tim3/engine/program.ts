/**
 * Fenêtre « programmer » d'une pièce posée (poignée 0xD de l'éditeur, 42ea57 → 4249f8), sans DOM. Le jeu ouvre l'écran
 * `PROG<type>.ITF` ; l'état de la fenêtre vit dans des globales (0x47fb2c … 0x47fc2c), ici dans `PartProgram`.
 *
 * Traduit de TIMWIN.EXE (le binaire fait foi) :
 * - 425147 (ouverture) : les lignes de `PROGPART.RES` du type (« pièce, état, animation, texte », colonnes lues par `atoi`
 *   aux octets 0, 4, 8) donnent jusqu'à 16 choix {image = 44b2c0(ANM du type, état), état de `PROGPART.ANM` montré} ; le
 *   choix courant est celui dont l'image vaut l'image d'édition (+0xF0), sinon le premier. Puis, selon le type : compteur
 *   du pistolet laser 27 (+0xFC, 0 … 99), réglettes de la balle programmable 87 (masse +0x5C et réglages +0x90, rang
 *   0 … 10 = premier palier ≥ valeur), réglette du seau troué 108 (0 … 5 = 5 − choix).
 * - 424ce1 (boutons) : PP_UP (0x5dc2) = choix précédent (du premier au dernier), PP_DOWN (0x5dc3) = suivant (du dernier au
 *   premier) ; pour 27, PP_UP ajoute 1 et PP_DOWN retire 1. Flèches des réglettes : ± 1 dans leurs bornes (425a46 : le seau
 *   recalcule son choix).
 * - 4255b4 : boîtes 71 et ballon 4 sont appliqués à chaque changement (425455) puis testés (437208) : « Terminé » est
 *   refusé tant que la pièce chevauche (messages de `INTRFACE.RES`).
 * - 425455 (« Terminé ») : 27 → +0xFC ; 87 → réglages et masse ; puis, si l'image du choix diffère de +0x18 : +0x18 et
 *   +0xF0 = cette image, slot 2, 439b58.
 *
 * Écart volontaire : fermer sans « Terminé » (Échap) remet aussi une boîte ou un ballon dans leur état d'avant (l'exe les
 * laisse tels quels, chevauchement compris).
 * Les types 127 et 136 ont du code dans 424ce1 mais pas d'écran `PROG<type>.ITF` : non portés.
 */
import { updateGeometry } from "./move";
import type { Part } from "./part";
import { overlapsAnother } from "./parts/creatures/kernel";
import type { World } from "./world";

/** Une ligne de `PROGPART.RES`. */
export interface ProgramRow {
  type: number;
  /** État de l'ANM de la pièce. */
  state: number;
  /** État de `PROGPART.ANM` montré dans la fenêtre. */
  preview: number;
  /** Texte de la ligne (anglais, non affiché par le jeu). */
  text: string;
}

/** `atoi` du C : blancs, signe, chiffres. */
function atoi(s: string): number {
  const m = /^\s*([+-]?\d+)/.exec(s);
  return m ? Number(m[1]) : 0;
}

/** Lignes de `PROGPART.RES` (déjà découpées) lues comme 425147 : colonnes aux octets 0, 4 et 8, texte après 12. */
export function parseProgramRows(lines: readonly string[]): ProgramRow[] {
  const out: ProgramRow[] = [];
  for (const line of lines) {
    const type = atoi(line);
    if (type <= 0) continue;
    out.push({ type, state: atoi(line.slice(4)), preview: atoi(line.slice(8)), text: line.slice(12).trim() });
  }
  return out;
}

/** Paliers des réglettes de la balle programmable (0x472e4c, 0x472df4, 0x472e20, 0x472dc8). */
export const BALL_STEPS = {
  mass: [1, 2, 6, 10, 21, 50, 121, 151, 201, 1801, 28000],
  elasticity: [0, 64, 96, 128, 144, 160, 192, 224, 256, 302, 396],
  density: [1, 250, 750, 1100, 1200, 1500, 1800, 3000, 6000, 9000, 11000],
  friction: [0, 8, 12, 16, 24, 34, 46, 60, 78, 98, 128],
} as const;
export type BallSetting = keyof typeof BALL_STEPS;

/** Types qui ont un écran `PROG<type>.ITF`. */
export const PROGRAM_TYPES: readonly number[] = [4, 27, 54, 58, 63, 71, 80, 81, 87, 96, 108, 137];

const LASER_GUN = 0x1b;
const PROG_BALL = 0x57;
const BUCKET = 0x6c;
/** Boîtes et ballon : appliqués à chaque changement, refusés s'ils chevauchent (4255b4). */
const LIVE = new Set([0x47, 4]);
/** 424da2 : plus grand compte du pistolet laser. */
export const LASER_GUN_MAX = 99;
/** 425b3d : bornes de la réglette du seau troué. */
export const BUCKET_MAX = 5;

export interface ProgramChoice {
  /** Image de la pièce (première image de l'état). */
  frame: number;
  state: number;
  preview: number;
}

/** Rang de la réglette pour une valeur (425147 : premier palier ≥ valeur, 10 au-delà). */
function stepIndex(steps: readonly number[], value: number): number {
  let i = 0;
  while (i < 10 && value > steps[i]!) i++;
  return i;
}

export class PartProgram {
  readonly type: number;
  /** Choix de l'écran (0x47fb5c, 16 au plus). */
  readonly choices: ProgramChoice[];
  /** 0x47fb2c */
  index = 0;
  /** 0x47fb54 : compte du pistolet laser. */
  counter = 0;
  /** 0x47fb44, 0x47fb48, 0x47fb4c, 0x47fb50 : rangs des réglettes de la balle programmable. */
  readonly ball: Record<BallSetting, number> = { mass: 0, elasticity: 0, density: 0, friction: 0 };
  /** 0x47fb58 : réglette du seau troué. */
  bucket = 0;
  /** 0x47fb30 : la pièce ne chevauche rien (boîtes et ballon). */
  fits = true;
  private readonly initial: { frame: number; editFrame: number };
  private closed = false;

  constructor(
    readonly world: World,
    readonly part: Part,
    rows: readonly ProgramRow[],
  ) {
    this.type = part.type;
    const anim = world.types.anims[part.type];
    this.choices = rows
      .filter((r) => r.type === part.type)
      .slice(0, 16)
      .map((r) => ({ frame: anim?.stateFirst(r.state) ?? 0, state: r.state, preview: r.preview }));
    this.initial = { frame: part.frame, editFrame: part.editFrame };
    this.index = Math.max(0, this.choices.findIndex((c) => c.frame === part.editFrame));
    if (this.type === LASER_GUN) this.counter = part.fFC;
    else if (this.type === PROG_BALL) {
      const prog = part.prog;
      this.ball.mass = stepIndex(BALL_STEPS.mass, part.mass);
      this.ball.elasticity = stepIndex(BALL_STEPS.elasticity, prog?.[1] ?? 0);
      this.ball.density = stepIndex(BALL_STEPS.density, prog?.[0] ?? 0);
      this.ball.friction = stepIndex(BALL_STEPS.friction, prog?.[2] ?? 0);
    } else if (this.type === BUCKET) this.bucket = BUCKET_MAX - this.index;
    this.live();
  }

  /** Choix courant (absent pour le pistolet laser). */
  get choice(): ProgramChoice | null {
    return this.choices[this.index] ?? null;
  }

  /** Réglette du seau troué (sinon : des flèches haut / bas) ; compteur du pistolet laser. */
  get kind(): "choices" | "counter" | "ball" | "bucket" {
    if (this.type === LASER_GUN) return "counter";
    if (this.type === PROG_BALL) return "ball";
    if (this.type === BUCKET) return "bucket";
    return "choices";
  }

  /** PP_UP (0x5dc2). */
  up(): void {
    if (this.type === LASER_GUN) {
      if (this.counter < LASER_GUN_MAX) this.counter++;
      return;
    }
    if (this.choices.length === 0) return;
    this.index = this.index > 0 ? this.index - 1 : this.choices.length - 1;
    this.live();
  }

  /** PP_DOWN (0x5dc3). */
  down(): void {
    if (this.type === LASER_GUN) {
      if (this.counter > 0) this.counter--;
      return;
    }
    if (this.choices.length === 0) return;
    this.index = this.index + 1 < this.choices.length ? this.index + 1 : 0;
    this.live();
  }

  /** Choix direct (toucher une vignette) : même effet qu'une suite de flèches. */
  select(index: number): void {
    if (index < 0 || index >= this.choices.length) return;
    this.index = index;
    if (this.type === BUCKET) this.bucket = BUCKET_MAX - index;
    this.live();
  }

  /** Réglette de la balle programmable (rang 0 … 10). */
  setBall(setting: BallSetting, rank: number): void {
    this.ball[setting] = Math.max(0, Math.min(10, Math.trunc(rank)));
  }

  /** Réglette du seau troué (0 … 5) : le choix suit (425a46). */
  setBucket(value: number): void {
    this.bucket = Math.max(0, Math.min(BUCKET_MAX, Math.trunc(value)));
    this.index = Math.min(BUCKET_MAX - this.bucket, Math.max(0, this.choices.length - 1));
    this.live();
  }

  /** Message de refus de « Terminé » (`INTRFACE.RES` : boîte 0x7a6e, ballon 0x7a6f), `null` si accepté. */
  get refusal(): "box" | "balloon" | null {
    if (this.fits) return null;
    return this.type === 4 ? "balloon" : "box";
  }

  /** « Terminé » (4250cf puis 425455) : rend faux si refusé (la fenêtre reste ouverte). */
  done(): boolean {
    if (this.closed) return true;
    if (!this.fits) return false;
    this.apply();
    this.closed = true;
    return true;
  }

  /** Fermeture sans « Terminé » : la pièce reprend son état d'avant (voir l'écart en tête de fichier). */
  cancel(): void {
    if (this.closed) return;
    this.closed = true;
    if (!LIVE.has(this.type)) return;
    const p = this.part;
    p.frame = this.initial.frame;
    p.editFrame = this.initial.editFrame;
    this.world.call(2, p);
    updateGeometry(this.world, p);
    this.world.redraw(p, 2);
  }

  /** 4255b4 : boîtes et ballon appliqués tout de suite, puis test de chevauchement. */
  private live(): void {
    if (!LIVE.has(this.type)) return;
    this.apply();
    this.fits = !overlapsAnother(this.world, this.part);
  }

  /** 425455 */
  private apply(): void {
    const p = this.part;
    const w = this.world;
    if (this.type === LASER_GUN) {
      p.fFC = this.counter;
      w.call(2, p);
      updateGeometry(w, p);
      w.redraw(p, 2);
      return;
    }
    if (this.type === PROG_BALL) {
      p.prog ??= new Int32Array(4);
      p.prog[2] = BALL_STEPS.friction[this.ball.friction]!;
      p.prog[1] = BALL_STEPS.elasticity[this.ball.elasticity]!;
      p.prog[0] = BALL_STEPS.density[this.ball.density]!;
      p.mass = BALL_STEPS.mass[this.ball.mass]!;
    }
    const c = this.choice;
    if (!c || c.frame === p.frame) return;
    p.frame = p.editFrame = c.frame;
    w.call(2, p);
    updateGeometry(w, p);
    w.redraw(p, 2);
  }
}
