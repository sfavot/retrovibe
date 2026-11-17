import type { Point } from "../../data/exe";
import type { MinigameEntry } from "../../game/rules";
import type { Play } from "../game";
import type { Script, Zone } from "../runtime";
import { changeSesterces } from "../squares";
import { ARROW_RGB, Anim, arrowCursor, beginPlay, endPlay, fadeSoundOut, flushInput, movePointer } from "./common";

/**
 * Mini-jeux « Les sangliers » (case 20, `MDF/28`) et « Pirates à bâbord ! » (case 52, `MDF/29`) : un seul segment,
 * `24e3`, entré en `24e3:0406` avec l'argument 0 (sangliers) ou 1 (pirates) ; ses deux fonctions `24e3:0004` (la cible)
 * et `24e3:0210` (le tir). Règles, adresses et niveaux de confiance : `docs/asterix/minigames/m28.md`.
 *
 * Pendant 28 secondes, des cibles sortent une à une à l'un de quinze endroits du décor. Le joueur vise avec la flèche
 * et tire : une cible touchée retombe, la suivante arrive. Un tir à côté, un tir sans cible ou une cible repartie sans
 * avoir été touchée font perdre. Sans faute jusqu'au bout, le joueur gagne 1 sesterce.
 */
export const MODULE_SANGLIERS = 28;
export const MODULE_PIRATES = 29;

/** Durée de l'épreuve en secondes (chrono 2) : la partie s'arrête à la première image sans cible passé ce temps. */
export const DURATION = 0x1c;
/** Une image tous les 4 ticks (`1831:030a(1)` à `(4)`) : 15 images par seconde. */
export const FRAME_TICKS = 4;
/** Sesterces gagnés (`1d24:0912(joueur, 1, 1)`). */
export const GAIN = 1;
/** Emplacements par jeu (`DS:3182`, 15 couples x, y par jeu). */
export const SPOT_COUNT = 15;

/** État de la cible (`DS:3180`). */
export const PHASE_IDLE = 0;
export const PHASE_APPEARING = 1;
export const PHASE_WAITING = 2;
export const PHASE_LEAVING = 3;
export const PHASE_HIT = 4;

/** Secondes sans cible avant la première (`DS:7098 = 2` : elle part quand le chrono 3 dépasse 2). */
export const FIRST_DELAY = 2;
/** Après une cible touchée : `DS:7098 = 3 − niveau Action`. */
export const DELAY_BASE = 3;

/**
 * Zone de tir autour de l'emplacement (x, y) de la cible, en pixels, pour le niveau Action `n` : à gauche
 * `0x28 − 4n` (`DS:7096`), à droite `0x1e − 4n` (`DS:7094`), en haut `0x4b − 5n` (`DS:7092`), en bas `−3n` (`DS:7090`).
 */
export const BOX = { left: 0x28, right: 0x1e, top: 0x4b, bottom: 0, perLevel: { left: 4, right: 4, top: 5, bottom: 3 } } as const;

/** Décalage des tables du jeu vers l'écran (`x − 0x20`, `y − 0x28`). */
const OFFSET_X = 0x20;
const OFFSET_Y = 0x28;

/** Dérive du pointeur (`DS:404e`) : 2 pixels par tick vers la droite jusqu'à 300, puis vers la gauche jusqu'à 20. */
export const DRIFT_STEP = 2;
export const DRIFT_MAX = 300;
export const DRIFT_MIN = 0x14;

/** Bit de miroir du numéro de sprite (`DS:709c = 0x8000`). */
const MIRROR = 0x8000;

/** Fichiers de chaque jeu, dans l'ordre des globales de l'original. */
const GAMES = [
  {
    module: MODULE_SANGLIERS,
    appear: "m28b0000.voc",
    leave: "m28b0001.voc",
    hits: ["m28b0009.voc", "m28b0011.voc", "m28b0012.voc"],
    // Tir manqué : `rnd() & 1` choisit `m28b0003` (1) ou `m28b0004` (0).
    misses: ["m28b0004.voc", "m28b0003.voc"],
    sheets: ["m28sa000.hy8"],
    picture: "m28da000.mcc",
    music: "m28m.voc",
  },
  {
    module: MODULE_PIRATES,
    appear: "m29b0000.voc",
    leave: "b01-05a.voc",
    hits: ["m29b0001.voc", "m29b0002.voc", "m29b0003.voc", "b29-01a.voc", "b29-04a.voc"],
    misses: ["m28b0003.voc"],
    // `rnd() & 1` choisit la seconde planche (`DS:70c8`).
    sheets: ["m29sa000.hy8", "m29sa001.hy8"],
    picture: "m29da000.mcc",
    music: "m29m.voc",
  },
] as const;

/** État du mini-jeu (globales `DS:317c` à `DS:3180` et `DS:7090` à `DS:70a2`), exposé aux robots par `rt.hint.state`. */
export interface SangliersState {
  /** `DS:70a2` : 0 les sangliers, 1 les pirates. */
  game: number;
  /** Les quinze emplacements du jeu (`DS:3182`), en coordonnées de table (l'écran est à −32, −40). */
  spots: readonly Point[];
  /** `DS:3180` : `PHASE_*`. */
  phase: number;
  /** `DS:317c` : emplacement de la cible, 0 à 14. */
  spot: number;
  /** `DS:709e` : variante de la cible (animations `3 × variante`, `+ 1`, `+ 2`). */
  variant: number;
  /** `DS:709c` : cible dessinée en miroir (sangliers seulement) ; la zone de tir est alors retournée. */
  mirrored: boolean;
  /** `DS:7096`, `DS:7094`, `DS:7092`, `DS:7090` : étendue de la zone de tir autour de l'emplacement. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** `DS:7098` : la cible suivante sort quand le chrono 3 dépasse ce nombre de secondes. */
  delay: number;
  /** `DS:709a` : la cible sortie repart quand le chrono 3 dépasse ce nombre de secondes. */
  stay: number;
  /** `DS:70a1` : faute commise, la partie est perdue. */
  missed: boolean;
  /** Cibles touchées (compteur du portage, sans effet sur le jeu). */
  hits: number;
}

/**
 * Zone de tir de la cible courante (`24e3:0210`), bornes **exclues** : le tir touche si `x1 < x < x2` et `y1 < y < y2`.
 * Le coin haut gauche est ramené à 0 quand il sortirait de l'écran.
 */
export function targetBox(state: SangliersState): Zone {
  const { x, y } = state.spots[state.spot];
  const dx = x - state.left;
  const dy = y - state.top;
  return {
    x1: dx < OFFSET_X ? 0 : dx - OFFSET_X,
    y1: dy < OFFSET_Y ? 0 : dy - OFFSET_Y,
    x2: (x + state.right - OFFSET_X) & 0xffff,
    y2: (y + state.bottom - OFFSET_Y) & 0xffff,
  };
}

/** `24e3:0406(jeu)`. */
export function* script(play: Play, entry: MinigameEntry): Script {
  const { rt, board } = play;
  const { surface, resources, input, palette, voice } = rt.ctx;
  const player = board.player;
  const game = entry.argument === 1 ? 1 : 0;
  const pirates = game === 1;
  const files = GAMES[game];
  const [appearSound, leaveSound, hitSounds, missSounds, sheets] = yield* rt.load(
    Promise.all([
      resources.sound(files.appear),
      resources.sound(files.leave),
      Promise.all(files.hits.map((name) => resources.sound(name))),
      Promise.all(files.misses.map((name) => resources.sound(name))),
      Promise.all(files.sheets.map((name) => resources.hy8(name))),
    ]),
  );
  yield* rt.picture(files.picture, 1);
  yield* rt.music(files.music);
  rt.commit();
  rt.startChrono(2);
  rt.startChrono(3);

  const level = player.action;
  const s: SangliersState = {
    game,
    spots: rt.tables.targetSpots[game],
    phase: PHASE_IDLE,
    spot: 0,
    variant: 0,
    mirrored: false,
    left: BOX.left - BOX.perLevel.left * level,
    right: BOX.right - BOX.perLevel.right * level,
    top: BOX.top - BOX.perLevel.top * level,
    bottom: BOX.bottom - BOX.perLevel.bottom * level,
    delay: FIRST_DELAY,
    stay: 0,
    missed: false,
    hits: 0,
  };
  const target = new Anim(sheets[0]);
  const flip = (): void => {
    [s.left, s.right] = [s.right, s.left];
  };

  /** `24e3:0004` : dessin de la cible, puis son automate (sortie, attente, départ, chute). */
  const stepTarget = (): void => {
    if (s.phase !== PHASE_IDLE) {
      if (s.phase !== PHASE_WAITING) target.step();
      const spot = s.spots[s.spot];
      rt.sprite(target.sheet, target.sprite | (s.mirrored ? MIRROR : 0), spot.x - OFFSET_X, spot.y - OFFSET_Y);
    }
    switch (s.phase) {
      case PHASE_IDLE:
        if (rt.chrono(3) <= s.delay) return;
        rt.effect(appearSound);
        // Un sanglier sur deux regarde de l'autre côté : sa zone de tir est retournée avec lui.
        if (!pirates && (rt.rnd() & 1) !== 0) {
          s.mirrored = true;
          flip();
        }
        s.phase = PHASE_APPEARING;
        s.variant = rt.rnd() & 1;
        s.spot = rt.rnd() % SPOT_COUNT;
        target.init(pirates && (rt.rnd() & 1) !== 0 ? sheets[1] : sheets[0]);
        target.select(s.variant * 3);
        return;
      case PHASE_APPEARING:
        if (!target.wrapped) return;
        s.phase = PHASE_WAITING;
        rt.startChrono(3);
        s.stay = level === 0 ? 2 : 1;
        return;
      case PHASE_WAITING:
        if (rt.chrono(3) <= s.stay) return;
        rt.effect(leaveSound);
        s.phase = PHASE_LEAVING;
        target.select(s.variant * 3 + 1);
        return;
      case PHASE_LEAVING:
        // Repartie sans avoir été touchée : perdu.
        if (!target.wrapped) return;
        s.phase = PHASE_IDLE;
        s.missed = true;
        return;
      case PHASE_HIT:
        if (!target.wrapped) return;
        s.phase = PHASE_IDLE;
        if (s.mirrored) {
          flip();
          s.mirrored = false;
        }
        s.delay = DELAY_BASE - level;
    }
  };

  /**
   * `24e3:0210` : un tir en (x, y). Sans cible ou sur une cible qui repart, il est manqué ; sur une cible qui tombe déjà,
   * il est ignoré ; sinon il doit tomber dans la zone de tir.
   */
  const shoot = (x: number, y: number): void => {
    if (s.phase === PHASE_HIT) return;
    if (s.phase === PHASE_APPEARING || s.phase === PHASE_WAITING) {
      const box = targetBox(s);
      if (x > box.x1 && x < box.x2 && y > box.y1 && y < box.y2) {
        rt.effect(hitSounds[rt.rnd() % hitSounds.length]);
        s.phase = PHASE_HIT;
        s.hits++;
        target.select(s.variant * 3 + 2);
        return;
      }
      // Tir à côté (`18a1:0262(0x400000)` retire le curseur de bibliothèque, sans effet ici) : la cible repart au plus tôt.
      s.stay = 0;
    }
    s.missed = true;
    rt.effect(missSounds[pirates ? 0 : rt.rnd() & 1]);
  };

  /** `153c:05b4` : la flèche, pointe en haut à gauche sur la position du pointeur, coupée aux bords de l'écran. */
  const arrow = arrowCursor(rt);

  yield* flushInput(rt);
  palette.setColor(0xff, ...ARROW_RGB);

  /** Image du jeu sans la flèche : celle-ci est reposée à chaque tick, à la position courante du pointeur. */
  const frame = new Uint8Array(surface.work.length);
  const present = (): void => {
    surface.work.set(frame);
    arrow.drawAtPointer();
  };
  /** Sens de la dérive (variable locale `BP − 1`). */
  let driftingBack = false;
  /** Tir de l'image en cours : position du pointeur à l'appui. */
  let shot: Point | null = null;

  beginPlay(rt, files.module, s);
  do {
    rt.restore();
    stepTarget();
    if (!s.missed && shot) shoot(shot.x, shot.y);
    shot = null;
    frame.set(surface.work);
    present();
    for (let tick = 0; tick < FRAME_TICKS; tick++) {
      // Le pointeur dérive tout seul, d'un bord à l'autre ; pas sous une vraie souris, que le jeu ne peut pas déplacer (D11).
      if (!input.pointerHovering) {
        if (!driftingBack) {
          if (input.mouseX < DRIFT_MAX) input.mouseMove(input.mouseX + DRIFT_STEP, input.mouseY);
          else driftingBack = true;
        } else if (input.mouseX > DRIFT_MIN) input.mouseMove(input.mouseX - DRIFT_STEP, input.mouseY);
        else driftingBack = false;
      }
      yield;
      // Pointeur au clavier (`1902:03c0`, actif tant que `DS:0144 == 1`).
      movePointer(rt);
      if (rt.click() !== null) shot ??= input.validateAt ?? { x: input.mouseX, y: input.mouseY };
      present();
    }
    rt.nextFrame();
  } while (s.phase !== PHASE_IDLE || (!s.missed && rt.chrono(2) < DURATION));
  endPlay(rt);

  // Flèche retirée, décor seul ; fin du bruitage en cours, 25 cs, fondu sonore.
  rt.restore();
  while (voice.effectPlaying) yield;
  yield* rt.wait(25);
  yield* fadeSoundOut(rt);
  yield* rt.cleanup();
  yield* rt.fadeOut(16);

  if (s.missed) {
    if (!pirates) {
      // L'image de la défaite est mise de côté (bloc C) pendant la vidéo plein écran, puis affichée sur sa palette.
      const picture = yield* rt.load(resources.picture("m28db001.mcc"));
      yield* rt.video("M28AC.MUX");
      rt.draw(picture, 4);
    } else {
      rt.draw(yield* rt.load(resources.picture("m29db000.mcc")), 4);
      surface.commitBackground();
      yield* rt.moduleVideo(MODULE_PIRATES, 1, { overlay: true });
    }
    return;
  }
  if (!pirates) {
    rt.draw(yield* rt.load(resources.picture("m28db000.mcc")), 4);
    surface.commitBackground();
    yield* rt.moduleVideo(MODULE_SANGLIERS, 1, { overlay: true });
  } else yield* rt.video("M29AA.MUX");
  yield* changeSesterces(rt, player, GAIN, true);
}
