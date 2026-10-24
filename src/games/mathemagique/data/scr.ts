/**
 * Ressource `\0SCR` : script d'animation par sprites de Math Workshop (interprète `1090:0094` de MATH, voir
 * `docs/mathemagique/scr.md`). Petit-boutiste, contrairement au reste de l'archive.
 *
 * Format : zone d'écrêtage (4 × u16 : haut, gauche, bas, droite), puis des opcodes jusqu'à `0x00` ; la fin de la
 * ressource est du bourrage (zéros).
 *
 * Choix de modèle : le lecteur produit deux vues du même script.
 * - `ops` : la liste typée et fidèle des opcodes, dans l'ordre (base d'un futur interprète rejouant les hooks et les
 *   sons avec leur chronologie exacte) ;
 * - `frames` : une simulation sans rendu qui calcule, pour chaque opcode « image », l'instant de présentation (en
 *   ticks), la durée, l'état complet des cellules visibles à ce moment et les évènements (sons, hooks) tombant
 *   pendant l'image. C'est ce qu'il faut pour un aperçu d'animation.
 *
 * Temps : unité = tick du moteur (`DAT_1108_8722`, nominal 60 Hz, soit une horloge de 17 ms). Une image
 * `FRAME count delay` dure `count × delay` ticks.
 */
import { BinaryReader } from "../../../data/reader";

/** Nombre de cellules (sprites) d'une animation. L'indice 0 est le fond ; dessin par indice croissant. */
export const SCR_CELL_COUNT = 32;

/** Coordonnée « hors écran » d'une cellule jamais positionnée (mot haut de `0x80000000`). */
export const SCR_OFFSCREEN = -32768;

/** Drapeaux initiaux d'une cellule (`1090:0e21` : quartet bas = mode de blit 2). */
export const SCR_INITIAL_FLAGS = 0x0002;

/** Zone d'effet et d'écrêtage, en pixels (repère écran 576×432). Les positions des cellules sont relatives à `(left, top)`. */
export interface ScrClip {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export type ScrOp =
  /** `0x01` : présente l'image précédente, fixe la durée de celle-ci à `count × delay` ticks. */
  | { op: "frame"; count: number; delay: number }
  /** `0x02` : attente passive (jamais présent dans les données). */
  | { op: "wait"; ticks: number }
  /** `0x03` : joue le son `\0SND` `id` quand l'image courante est terminée. */
  | { op: "sound"; id: number }
  /** `0x04` : arrête le son `id` (jamais présent). */
  | { op: "stopSound"; id: number }
  /** `0x05` : attend la fin du son `id` (jamais présent). */
  | { op: "waitSound"; id: number }
  /** `0x06` : attend le repère `level` du MIDI (jamais présent). */
  | { op: "waitMidi"; level: number }
  /** `0x07` : compose les cellules sans attendre ni présenter. */
  | { op: "render" }
  /** `0x10`–`0x13` : appelle le hook `hook` (0 à 3) de la scène avec l'argument `arg`. */
  | { op: "hook"; hook: number; arg: number }
  /** `0x14`–`0x17` : 4 octets ignorés par l'interprète (jamais présent). */
  | { op: "skip"; opcode: number; data: Uint8Array }
  /** `0x20`–`0x3f` : `flags = (flags & mask) | or`. */
  | { op: "flags"; cell: number; mask: number; or: number }
  /** `0x60`–`0x7f` : position de la cellule, relative au coin `(left, top)` de la zone. */
  | { op: "position"; cell: number; x: number; y: number }
  /** `0x80`–`0x9f` : forme (indice 1 à n dans la `SHPL`, 0 = cellule vide et remise à zéro). `echo` = 2e u16, toujours égal. */
  | { op: "shape"; cell: number; shape: number; echo: number };

export interface ScrCell {
  cell: number;
  /** Indice de forme dans la `SHPL` (1 à n) : la `SHAP` est `firstShapeId + shape - 1`. */
  shape: number;
  /** Drapeaux bruts (quartet bas = mode de blit). */
  flags: number;
  /** Mode de blit effectif : quartet bas des drapeaux, `0xa` étant converti en `0x8` au premier dessin (`1090:0c25`). */
  blit: number;
  /** Position relative à la zone (`SCR_OFFSCREEN` tant que la cellule n'est pas placée). */
  x: number;
  y: number;
}

export type ScrEvent =
  | { kind: "sound"; tick: number; id: number }
  | { kind: "hook"; tick: number; hook: number; arg: number }
  | { kind: "stopSound"; tick: number; id: number }
  | { kind: "waitSound"; tick: number; id: number }
  | { kind: "waitMidi"; tick: number; level: number };

export interface ScrFrame {
  /** Rang de l'image (0 à n-1). */
  index: number;
  /** Instant de présentation, en ticks depuis le début du script. */
  start: number;
  /** `count` et `delay` de l'opcode ; durée = `count × delay` ticks. */
  count: number;
  delay: number;
  duration: number;
  /** Compteur d'images logiques cumulé (somme des `count`) à la présentation, argument de l'avance rapide `1090:0432`. */
  logicalIndex: number;
  /** Cellules non vides et placées, par indice croissant (ordre de dessin). */
  cells: ScrCell[];
  /** Évènements survenus entre cette présentation (incluse) et la suivante (exclue). */
  events: ScrEvent[];
}

export interface ScrScript {
  clip: ScrClip;
  ops: ScrOp[];
  frames: ScrFrame[];
  /** Durée totale en ticks. */
  duration: number;
  /** Évènements survenus après la fin de la dernière image (avant `END`). */
  trailingEvents: ScrEvent[];
  /** Octets utiles (zone + opcodes + `END`) ; le reste de la ressource est du bourrage. */
  size: number;
}

export function parseScr(bytes: Uint8Array): ScrScript {
  const r = new BinaryReader(bytes);
  if (bytes.length < 9) throw new Error("SCR : ressource trop courte");
  const clip: ScrClip = {
    top: r.u16(),
    left: r.u16(),
    bottom: r.u16(),
    right: r.u16(),
  };
  const ops: ScrOp[] = [];
  for (;;) {
    if (r.isAtEnd) throw new Error("SCR : fin du script sans opcode END");
    const start = r.offset;
    const opcode = r.u8();
    const need = (count: number) => {
      if (r.offset + count > r.length)
        throw new Error(
          `SCR : opcode 0x${opcode.toString(16)} tronqué en ${start}`,
        );
    };
    if (opcode === 0x00) break;
    if (opcode === 0x01) {
      need(4);
      ops.push({ op: "frame", count: r.u16(), delay: r.u16() });
    } else if (opcode === 0x02) {
      need(2);
      ops.push({ op: "wait", ticks: r.u16() });
    } else if (opcode === 0x03) {
      need(2);
      ops.push({ op: "sound", id: r.u16() });
    } else if (opcode === 0x04) {
      need(2);
      ops.push({ op: "stopSound", id: r.u16() });
    } else if (opcode === 0x05) {
      need(2);
      ops.push({ op: "waitSound", id: r.u16() });
    } else if (opcode === 0x06) {
      need(1);
      ops.push({ op: "waitMidi", level: r.u8() });
    } else if (opcode === 0x07) {
      ops.push({ op: "render" });
    } else if ((opcode & 0xfc) === 0x10) {
      need(2);
      ops.push({ op: "hook", hook: opcode & 3, arg: r.u16() });
    } else if ((opcode & 0xfc) === 0x14) {
      need(4);
      ops.push({
        op: "skip",
        opcode,
        data: bytes.slice(r.offset, r.offset + 4),
      });
      r.offset += 4;
    } else if ((opcode & 0xe0) === 0x20) {
      need(4);
      ops.push({
        op: "flags",
        cell: opcode & 0x1f,
        mask: r.u16(),
        or: r.u16(),
      });
    } else if ((opcode & 0xe0) === 0x60) {
      need(4);
      ops.push({ op: "position", cell: opcode & 0x1f, x: r.i16(), y: r.i16() });
    } else if ((opcode & 0xe0) === 0x80) {
      need(4);
      ops.push({
        op: "shape",
        cell: opcode & 0x1f,
        shape: r.u16(),
        echo: r.u16(),
      });
    } else {
      throw new Error(
        `SCR : opcode inconnu 0x${opcode.toString(16)} en ${start}`,
      );
    }
  }
  const { frames, duration, trailingEvents } = simulate(ops);
  return { clip, ops, frames, duration, trailingEvents, size: r.offset };
}

interface CellState {
  shape: number;
  flags: number;
  x: number;
  y: number;
}

function resetCell(): CellState {
  return {
    shape: 0,
    flags: SCR_INITIAL_FLAGS,
    x: SCR_OFFSCREEN,
    y: SCR_OFFSCREEN,
  };
}

/**
 * Rejoue les opcodes sans rendu, avec la chronologie de l'interprète : les opcodes de cellule et les hooks
 * s'exécutent immédiatement ; `FRAME`, `SOUND` et `END` attendent d'abord la fin de l'image précédente.
 * Une image « présente » l'état des cellules tel qu'il est quand l'opcode `FRAME` est atteint.
 */
function simulate(ops: readonly ScrOp[]): {
  frames: ScrFrame[];
  duration: number;
  trailingEvents: ScrEvent[];
} {
  const cells = Array.from({ length: SCR_CELL_COUNT }, resetCell);
  const frames: ScrFrame[] = [];
  const events: ScrEvent[] = [];
  let now = 0;
  let frameEnd = 0;
  let logical = 0;
  const wait = () => {
    now = Math.max(now, frameEnd);
  };
  for (const op of ops) {
    switch (op.op) {
      case "frame": {
        wait();
        const duration = op.count * op.delay;
        const visible: ScrCell[] = [];
        cells.forEach((c, cell) => {
          if (c.shape !== 0) {
            const blit = c.flags & 0xf;
            visible.push({
              cell,
              shape: c.shape,
              flags: c.flags,
              blit: blit === 0xa ? 0x8 : blit,
              x: c.x,
              y: c.y,
            });
          }
        });
        frames.push({
          index: frames.length,
          start: now,
          count: op.count,
          delay: op.delay,
          duration,
          logicalIndex: logical,
          cells: visible,
          events: [],
        });
        logical += op.count;
        frameEnd = now + duration;
        break;
      }
      case "wait":
        now += op.ticks;
        frameEnd += frameEnd > 0 ? op.ticks : 0;
        break;
      case "sound":
        wait();
        events.push({ kind: "sound", tick: now, id: op.id });
        break;
      case "stopSound":
        events.push({ kind: "stopSound", tick: now, id: op.id });
        break;
      case "waitSound":
        events.push({ kind: "waitSound", tick: now, id: op.id });
        break;
      case "waitMidi":
        events.push({ kind: "waitMidi", tick: now, level: op.level });
        break;
      case "hook":
        events.push({ kind: "hook", tick: now, hook: op.hook, arg: op.arg });
        break;
      case "render":
      case "skip":
        break;
      case "flags": {
        const c = cells[op.cell]!;
        c.flags = ((c.flags & op.mask) | op.or) & 0xffff;
        break;
      }
      case "position": {
        const c = cells[op.cell]!;
        c.x = op.x;
        c.y = op.y;
        break;
      }
      case "shape":
        if (op.shape === 0) cells[op.cell] = resetCell();
        else cells[op.cell]!.shape = op.shape;
        break;
    }
  }
  wait();
  // Un évènement appartient à la dernière image présentée au plus tard à son instant ; après la fin : final.
  const trailingEvents: ScrEvent[] = [];
  for (const event of events) {
    if (event.tick >= frameEnd) trailingEvents.push(event);
    else {
      let target = frames[0];
      for (const frame of frames) if (frame.start <= event.tick) target = frame;
      target?.events.push(event);
    }
  }
  return { frames, duration: frameEnd, trailingEvents };
}

// Résolution des ressources associées -------------------------------------------------------------------------------

/** Identifiants présents dans une archive, pour la résolution `SCR` -> `SHPL` / `SNDL`. */
export interface ScrResourceIds {
  shpl: ReadonlySet<number>;
  sndl: ReadonlySet<number>;
}

export interface ScrResources {
  /** `SHPL` fournissant les formes (`undefined` : introuvable). */
  shplId: number | undefined;
  /** Décalage `scrId - shplId` (octet `+6` du descripteur d'animation). */
  offset: number;
  /** `SNDL` listant les sons (`undefined` : le script n'a pas de liste de sons). */
  sndlId: number | undefined;
}

/**
 * Résout la `SHPL` et la `SNDL` d'un script.
 *
 * Le moteur calcule `SCR = SHPL du descripteur + décalage` et charge la `SNDL` de même id que le `SCR`
 * (`1090:1024`). Dans les données : `SHPL` = `SCR` quand elle existe ; sinon la plus grande `SHPL` d'id inférieur
 * (le décalage du descripteur). Pour le bowling (`1010:3adc`), le `SCR` `base + dizaine + i` partage la `SNDL` de la
 * dizaine `base + dizaine`, d'où le repli sur la `SNDL` de la dizaine inférieure.
 */
export function resolveScrResources(
  scrId: number,
  ids: ScrResourceIds,
): ScrResources {
  let shplId: number | undefined;
  if (ids.shpl.has(scrId)) shplId = scrId;
  else
    for (const id of ids.shpl)
      if (id < scrId && (shplId === undefined || id > shplId)) shplId = id;
  let sndlId: number | undefined;
  if (ids.sndl.has(scrId)) sndlId = scrId;
  else if (ids.sndl.has(scrId - (scrId % 10))) sndlId = scrId - (scrId % 10);
  return { shplId, offset: shplId === undefined ? 0 : scrId - shplId, sndlId };
}
