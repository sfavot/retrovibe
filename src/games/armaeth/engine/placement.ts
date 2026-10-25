import {
  GROUND_FLOOR,
  MAX_P,
  MAX_X,
  MAX_Y,
  SPAN_EMPTY,
  bilinearHeight,
  cellCorners,
  cellIndex,
  depthMaskHit,
  spanAt,
  terrainCollision,
  typeAt,
  type Footprint,
  type Terrain,
} from "./ground";

/**
 * Placement d'un objet : `1aba:000e` (modes 0 à 10) et la recherche de la position valide la plus proche
 * `gm_object_behavior_main` `1b11:000c` (`docs/armaeth/movement.md` § 4). Module pur.
 *
 * Reproduit les défauts de l'original : la spirale ne visite jamais la case (même rangée, colonne -1), la racine entière de
 * `1b11:140e` est une dichotomie qui peut valoir un de moins, l'égalité de distance donne la victoire au dernier candidat
 * parcouru, et le code d'erreur laissé par une recherche (`DS:0ea8`) n'est jamais remis à zéro (`PlacementMemory`).
 */

/** Codes de retour de la recherche (et `Err` de l'objet). */
export const PLACE_OK = 0;
/** Trouvé, mais le type de case sous l'objet a changé. */
export const PLACE_TYPE_CHANGED = 0x11;
export const PLACE_NOT_FOUND = 0x14;
/** Opération impossible hors salle. */
export const PLACE_OUTSIDE_ROOM = 0x15;
/** Fenêtre de recherche vide (conflit de bornes). */
export const PLACE_EMPTY_WINDOW = 0x17;

/** Ce que le placement lit et écrit d'un objet (champs de `movement.md` § 1.2). */
export interface PlaceBody extends Footprint {
  /** `N` (+0x53) : plan de marche. */
  plane: number;
  /** `Sol` (+0x5A) : type de case sous les pieds. */
  ground: number;
  /** `Xyp` (+0x52) : présence (0 absent, 1 salle non chargée, 2 posé dans la salle chargée). */
  presence: number;
  /** `Err` (+0x3E). */
  err: number;
  /** `Inf` (+0x3F) : côté d'arrivée pour le mode 10. */
  info: number;
}

/** Résultat de la collision objet-objet `1a50:0006` : 8 bloque, 9 ne bloque pas, 0 libre ; `col` = `Ser` de l'autre objet. */
export interface ContactResult {
  err: number;
  col: number;
}

/**
 * `DS:0ea8` : le code d'erreur de la recherche n'est écrit qu'en fin de recherche (0, 0x11, 0x14, 0x15) ou sur conflit de
 * bornes (0x17) et **jamais remis à zéro à l'entrée** : un échec rend la dernière valeur non nulle (`movement.md` § 8.6).
 * Une instance par partie ; l'état n'est pas sauvegardé (hypothèse : le fichier de sauvegarde ne contient pas `DS:0ea8`).
 */
export interface PlacementMemory {
  code: number;
}

export function createPlacementMemory(): PlacementMemory {
  return { code: 0 };
}

export interface PlaceEnv {
  terrain: Terrain;
  /** L'objet est dans la salle chargée (conteneur == salle courante). */
  inRoom: boolean;
  memory: PlacementMemory;
  /** `13a8:000a(type, effet, o) == 0`. Défaut : tout type >= 2. */
  acceptsGround?: (type: number, effect: number, body: PlaceBody) => boolean;
  /** `1a50:0006` : la collision avec les autres objets de la salle (le résultat 8 écarte le candidat). */
  contact?: (body: PlaceBody) => ContactResult;
  /** Masque de profondeur du pilote vidéo (`movement.md` § 3.2). */
  depthBlocked?: (body: Footprint) => boolean;
  /**
   * Rogne la fenêtre verticale par les murs de l'empreinte du sprite (`1b11:0cf2`) et mémorise ceux qui ne la rognent pas pour
   * le test de chaque échantillon (`1b11:16b4`, `movement.md` § 4.3 et § 4.4). Désactivé par défaut (tests du classement seul).
   */
  clipWalls?: boolean;
  /**
   * Diagnostic : faux désactive le rognage de la fenêtre de Y par le rayon 3D (`1b11:140e`), pour mesurer son effet sur le
   * classement par distance X / P (`movement.md` § 4.5). Vrai par défaut, comme dans l'original.
   */
  trimHeight?: boolean;
  /** `lib_rand()` : entier >= 0 (mode 9). */
  random?: () => number;
}

/**
 * Paramètres de la recherche (`1b11:000c`). Tolérance -1 = illimitée ; signe 0 = libre ; `type` > 0 exige ce type de case,
 * 0 accepte tout type praticable accepté par l'objet.
 */
export interface SearchArgs {
  /** `AX` : côté de la salle dont la borne est figée (0 à 5), 6 et plus = aucun. */
  side: number;
  signX: number;
  tolX: number;
  type: number;
  tolP: number;
  signP: number;
  tolY: number;
  signY: number;
}

/** Le plus proche de la position actuelle, sans contrainte (mode 1). */
export const SEARCH_FREE: SearchArgs = { side: 6, signX: 0, tolX: -1, type: 0, tolP: -1, signP: 0, tolY: -1, signY: 0 };

/** Clic du héros (`1504:0002`, `movement.md` § 4.6) : tolérance 4 en X, 1 en Y, P libre. */
export const SEARCH_CLICK: SearchArgs = { ...SEARCH_FREE, tolX: 4, tolY: 1 };

const NEVER = 0x7fff;
const NEVER_D2 = 0x7fffffff;

/**
 * Racine entière de `1b11:140e` : dichotomie entre 0 et `upper` ; rend `lo` quand `hi - lo <= 1` (donc `floor(sqrt) - 1` pour
 * un carré parfait trop proche de la borne) ou `mid` si `mid² == d`.
 */
export function quirkySqrt(d: number, upper: number): number {
  let lo = 0;
  let hi = upper;
  for (;;) {
    const mid = lo + ((hi - lo) >> 1);
    if (mid === lo) return mid;
    const square = mid * mid;
    if (square === d) return mid;
    if (d < square) hi = mid;
    else lo = mid;
  }
}

interface Axis {
  lo: number;
  hi: number;
  target: number;
}

/** Fenêtre d'un axe : tolérance autour de la position actuelle, puis signe (`movement.md` § 4.2) ; `null` = conflit de bornes. */
function clampAxis(cur: number, tolerance: number, sign: number, lo: number, hi: number): Axis | null {
  let target = cur;
  if (tolerance >= 0) {
    const low = cur - tolerance;
    const high = cur + tolerance;
    if (low > hi || high < lo) return null;
    if (lo < low) lo = low;
    if (high < hi) hi = high;
  }
  if (sign < 0) {
    if (cur < lo) return null;
    if (cur < hi) hi = cur;
  } else if (sign > 0) {
    if (hi < cur) return null;
    if (lo < cur) lo = cur;
  } else if (cur < lo) target = lo;
  else if (cur > hi) target = hi;
  return { lo, hi, target };
}

interface Candidate {
  x: number;
  y: number;
  p: number;
  plane: number;
  type: number;
}

/**
 * Recherche de la position valide la plus proche (`1b11:000c`, **probable pour l'ensemble, certain pas à pas** ;
 * `movement.md` § 4.3 et § 4.4). Écrit `x, y, p, plane, ground, presence` et `err` dans l'objet ; retour : 0, 0x11, 0x14, 0x15 ou
 * 0x17. En cas d'échec l'objet retrouve sa position d'entrée.
 */
export function searchPosition(body: PlaceBody, env: PlaceEnv, request: SearchArgs): number {
  const { terrain, inRoom, memory } = env;
  const { grid, limits } = terrain;
  const args = { ...request };
  const flyer = body.dep !== 0;
  const walker = inRoom && !flyer; // `cRam4a4db`
  const zoneOnly = body.dep === 2 || body.dep === 4;
  const wantedType = args.type > 0 ? args.type : 0;
  const planeCount = !inRoom || zoneOnly ? 1 : terrain.planes;
  const accepts = (type: number) => (env.acceptsGround ? env.acceptsGround(type, 0, body) : type >= GROUND_FLOOR);
  const origin = { x: body.x, y: body.y, p: body.p, plane: body.plane, ground: body.ground, presence: body.presence };
  const curX = body.x;
  const curY = body.y;
  const curP = body.p;
  const originalGround = body.ground;

  let bestRadius = NEVER;
  let bestD2 = NEVER_D2;
  let best: Candidate | null = null;

  // état de la recherche dans le plan (partagé avec le balayage des zones)
  let xMin = 0;
  let xMax = 0;
  let yMin = 0;
  let yMax = 0;
  let pMin = 0;
  let pMax = 0;
  let tgtX = 0;
  let tgtY = 0;
  let tgtP = 0;
  let colMin = 0;
  let colMax = 0;
  let rowMin = 0;
  let rowMax = 0;
  let cellYMin = 0; // y53a
  let cellYMax = 0; // y53e
  let startY = 0; // y532
  let below = 0; // n548 : pas possibles vers le bas
  let above = 0; // n54c : pas possibles vers le haut
  let radius3d = NEVER; // r58e
  let radius2d = NEVER; // r588
  let lastD2xp = NEVER_D2; // d58a
  let lastD2 = NEVER_D2; // d590
  let planeBest: Candidate | null = null;
  /** Murs mémorisés par le rognage (`43c0c`, `43c10`) : `{colonne, lo, hi}`, au plus `capacity` (`43c12`). */
  let walls: { col: number; lo: number; hi: number }[] = [];
  const wallCapacity = ((body.width >> 2) + 1) * terrain.planes;

  /** `1b11:140e` : enregistre le candidat, calcule les rayons et rogne les fenêtres. */
  const record = (x: number, y: number, p: number, plane: number, type: number): void => {
    const dx = x - tgtX;
    const dp = p - tgtP;
    const dy = y - tgtY;
    const d2xp = dx * dx + dp * dp;
    const d2 = d2xp + dy * dy;
    planeBest = { x, y, p, plane, type };
    lastD2xp = d2xp;
    lastD2 = d2;
    if (d2 === 0) {
      radius3d = 0;
      radius2d = 0;
      return;
    }
    radius3d = quirkySqrt(d2, Math.abs(dx) + Math.abs(dp) + Math.abs(dy));
    radius2d = quirkySqrt(d2xp, radius3d);
    const radius = flyer ? radius3d : radius2d;
    xMin = Math.max(xMin, tgtX - radius);
    xMax = Math.min(xMax, tgtX + radius);
    pMin = Math.max(pMin, tgtP - radius);
    pMax = Math.min(pMax, tgtP + radius);
    if (env.trimHeight !== false) {
      yMin = Math.max(yMin, tgtY - radius3d);
      yMax = Math.min(yMax, tgtY + radius3d);
    }
    cellYMin = Math.max(cellYMin, yMin);
    cellYMax = Math.min(cellYMax, yMax);
    below = startY - cellYMin;
    above = cellYMax - startY;
    colMin = Math.max(colMin, xMin >> 2);
    colMax = Math.min(colMax, xMax >> 2);
    rowMin = Math.max(rowMin, pMin >> 3);
    rowMax = Math.min(rowMax, pMax >> 3);
  };

  let perfect = false; // sortie anticipée : ni balayage des zones ni erreur hors salle
  planes: for (let plane = 0; plane < planeCount; plane++) {
    body.plane = plane;
    radius3d = NEVER;
    radius2d = NEVER;
    lastD2xp = NEVER_D2;
    lastD2 = NEVER_D2;
    planeBest = null;
    if (bestRadius < NEVER) {
      if (args.tolX < 0 || bestRadius < args.tolX) args.tolX = bestRadius;
      if (args.tolY < 0 || bestRadius < args.tolY) args.tolY = bestRadius;
      if (args.tolP < 0 || bestRadius < args.tolP) args.tolP = bestRadius;
    }
    if (inRoom) {
      ({ xMin, xMax, yMin, yMax, pMin, pMax } = limits);
    } else {
      xMin = 0;
      xMax = MAX_X;
      pMin = 0;
      pMax = MAX_P;
      yMin = 0;
      yMax = MAX_Y;
    }
    switch (args.side) {
      case 0:
        pMax = pMin;
        break;
      case 1:
        xMin = xMax;
        break;
      case 2:
        pMin = pMax;
        break;
      case 3:
        xMax = xMin;
        break;
      case 4:
        yMax = yMin;
        break;
      case 5:
        yMin = yMax;
        break;
    }
    const axisX = clampAxis(curX, args.tolX, args.signX, xMin, xMax);
    const axisP = axisX && clampAxis(curP, args.tolP, args.signP, pMin, pMax);
    const axisY = axisP && clampAxis(curY, args.tolY, args.signY, yMin, yMax);
    if (!axisX || !axisP || !axisY) {
      memory.code = PLACE_EMPTY_WINDOW;
      continue;
    }
    ({ lo: xMin, hi: xMax, target: tgtX } = axisX);
    ({ lo: pMin, hi: pMax, target: tgtP } = axisP);
    ({ lo: yMin, hi: yMax, target: tgtY } = axisY);
    if (zoneOnly) continue; // les zones sont balayées après les plans

    let stepsX = 4;
    let stepsP = 8;
    if (args.side === 0 || args.side === 2) stepsP = 1;
    else if (args.side === 1 || args.side === 3) stepsX = 1;
    const startSubX = tgtX & 3;
    const startSubP = tgtP & 7;
    colMin = xMin >> 2;
    colMax = xMax >> 2;
    rowMin = pMin >> 3;
    rowMax = pMax >> 3;

    // spirale de bandes de cases autour de la cible (`1b11:09d6..0a84`)
    let rLo = tgtP >> 3;
    let rHi = rLo;
    let cLo = tgtX >> 2;
    let cHi = cLo;
    let size = 1;
    let state = 4;
    let emptyBands = 0;

    cells: for (;;) {
      const bandRowLo = Math.max(rLo, rowMin);
      const bandRowHi = Math.min(rHi, rowMax);
      const bandColLo = Math.max(cLo, colMin);
      const bandColHi = Math.min(cHi, colMax);
      for (let col = bandColLo; col <= bandColHi; col++) {
        const x0 = col * 4;
        if (!(x0 <= xMax && xMin < x0 + 4)) continue;
        for (let row = bandRowLo; row <= bandRowHi; row++) {
          const p0 = row * 8;
          if (!(p0 <= pMax && pMin < p0 + 8)) continue;
          const index = cellIndex(plane, row, col);
          const type = flyer ? 0 : inRoom ? typeAt(grid, index) : GROUND_FLOOR;
          if (walker) {
            if (wantedType === 0) {
              if (type < GROUND_FLOOR || !accepts(type)) continue;
            } else if (type !== wantedType) continue;
          }
          let corners: [number, number, number, number] = [0, 0, 0, 0];
          if (!flyer) {
            if (!inRoom) {
              cellYMin = tgtY;
              cellYMax = tgtY;
            } else {
              corners = cellCorners(grid, plane, row, col);
              cellYMin = Math.min(...corners);
              cellYMax = Math.max(...corners);
            }
          } else {
            cellYMin = yMin;
            cellYMax = yMax;
            if (inRoom && body.txt !== 2) {
              const span = spanAt(grid, index);
              if (span === SPAN_EMPTY) {
                if (plane !== 0) continue;
              } else cellYMax = (span & 0xff) - 1;
              for (let upper = plane + 1; upper < planeCount; upper++) {
                const upperSpan = spanAt(grid, cellIndex(upper, row, col));
                if (upperSpan >> 8 === 0xff) continue;
                cellYMin = (upperSpan >> 8) + body.height - 1;
                break;
              }
              if (cellYMax < cellYMin) continue;
            }
          }
          if (cellYMin < yMin) cellYMin = yMin;
          if (cellYMax > yMax) cellYMax = yMax;
          walls = [];
          if (env.clipWalls && inRoom && body.txt !== 2 && !clipWalls(row, col)) continue;
          if (cellYMin > cellYMax) continue;

          // essais de Y : pour un voleur, Y puis Y-1, Y+1, Y-2... jusqu'aux bornes de la case
          let y = tgtY < cellYMin ? cellYMin : Math.min(cellYMax, tgtY);
          startY = y;
          let up = 0;
          let down = 0;
          let phase = 0;
          below = y - cellYMin;
          above = cellYMax - y;
          for (let first = true; ; first = false) {
            if (!first) {
              let found = false;
              while (!found) {
                phase ^= 1;
                if (phase === 0) {
                  up++;
                  if (up <= above) {
                    y = startY + up;
                    found = true;
                  } else if (below <= down) break;
                } else {
                  down++;
                  if (below < down) {
                    if (above <= up) break;
                  } else {
                    y = startY - down;
                    found = true;
                  }
                }
              }
              if (!found) break;
            }
            samples: for (let i = 0; i < stepsX; i++) {
              const x = ((startSubX + i) & 3) + x0;
              if (x < xMin || x > xMax) continue;
              const dx = x - tgtX;
              for (let j = 0; j < stepsP; j++) {
                const p = ((startSubP + j) & 7) + p0;
                if (p < pMin || p > pMax) continue;
                const dp = p - tgtP;
                let sampleY: number;
                if (flyer) sampleY = y;
                else if (!inRoom) sampleY = tgtY;
                else sampleY = bilinearHeight(corners, x, p);
                if (sampleY < yMin || sampleY > yMax) {
                  if (flyer) break samples;
                  continue;
                }
                const dy = sampleY - tgtY;
                const d2xp = dx * dx + dp * dp;
                if (!(flyer ? d2xp + dy * dy <= lastD2 : d2xp <= lastD2xp)) continue;
                body.x = x;
                body.y = sampleY;
                body.p = p;
                if (env.contact && env.contact(body).err === 8) continue;
                if (inRoom && body.txt !== 2) {
                  // murs mémorisés (`1b11:16b4`) : -1 abandonne la case, 1 écarte l'échantillon (un voleur change de Y)
                  const wall = walls.length ? checkWalls(col, x, sampleY) : 0;
                  if (wall < 0) break samples;
                  if (wall > 0) {
                    if (flyer) break samples;
                    continue;
                  }
                  if (depthMaskHit(terrain, body, env.depthBlocked)) continue;
                }
                record(x, sampleY, p, plane, type);
                if (!inRoom || radius3d === 0 || (walker && radius2d === 0) || cellYMax < cellYMin) break cells;
              }
            }
            if (!flyer) break;
          }
        }
      }
      // bande suivante
      for (;;) {
        state = (state + 1) & 3;
        if (state === 0) {
          cLo += 1;
          cHi += size;
          rLo = rHi;
        } else if (state === 1) {
          cLo = cHi;
          rLo -= size;
          rHi -= 1;
          size++;
        } else if (state === 2) {
          cLo -= size;
          cHi -= 1;
          rHi = rLo;
        } else {
          cHi = cLo;
          rLo += 1;
          rHi += size;
          size++;
        }
        const colsInside = cHi !== cLo || (colMin <= cLo && cHi <= colMax);
        const rowsInside = rHi !== rLo || (rowMin <= rLo && rHi <= rowMax);
        if (colsInside && rowsInside) {
          emptyBands = 0;
          break;
        }
        if (++emptyBands === 4) break cells;
      }
    }

    if (planeBest && radius3d < bestRadius) {
      best = planeBest;
      bestRadius = radius3d;
      bestD2 = lastD2;
      if (!inRoom || radius3d === 0) {
        perfect = true;
        break planes;
      }
    }
  }

  if (!perfect) {
    // aucune position parfaite : balayage des zones (en salle), sinon opération impossible hors salle
    if (inRoom) sweepZones();
    else memory.code = PLACE_OUTSIDE_ROOM;
  }

  /**
   * Rogne `[cellYMin, cellYMax]` par les murs de l'empreinte du sprite jusqu'à un point fixe (`1b11:0cf2`) et mémorise ceux qui
   * ne le rognent pas (colonne, `lo`, `hi`) pour `checkWalls`. L'empreinte est lue à la rangée `row` de la case (`4a4e0`), de la
   * colonne `(left)>>2` à `(left + Lar + 2)>>2` ; le « cœur » va de `left + 3` à `left + Lar - 1`. Faux : case vide.
   */
  function clipWalls(row: number, col: number): boolean {
    for (;;) {
      let again = false;
      walls = [];
      const left = col * 4 - (body.width >> 1);
      const coreFirst = Math.max(left + 3, 0) >> 2;
      const coreLast = Math.min(left + body.width - 1, MAX_X) >> 2;
      const first = Math.max(left, 0) >> 2;
      const last = Math.min(left + body.width + 2, MAX_X) >> 2;
      scan: for (let c = first; c <= last; c++) {
        for (let j = 0; j < planeCount; j++) {
          const span = spanAt(grid, cellIndex(j, row, c));
          if (span === SPAN_EMPTY) continue;
          const lo = span & 0xff;
          const hi = span >> 8;
          const wall = typeAt(grid, cellIndex(j, row, c)) === 1 || hi <= cellYMax;
          if (!(lo <= cellYMax && cellYMin - body.height < hi && wall)) continue;
          if (c >= coreFirst && c <= coreLast) {
            const lowerHit = !(cellYMin < lo || hi < cellYMin - body.height + 1);
            const upperHit = !(cellYMax < lo || hi < cellYMax - body.height + 1);
            if (lowerHit) cellYMin = body.height + hi;
            if (upperHit) cellYMax = lo - 1;
            if (lowerHit || upperHit) {
              if (cellYMax < cellYMin) return false;
              again = true;
              break scan;
            }
          }
          if (walls.length < wallCapacity) walls.push({ col: c, lo, hi });
        }
      }
      if (!again) return true;
    }
  }

  /**
   * Murs mémorisés contre l'échantillon `(x, y)` de la case `col` (`1b11:16b4`) : un mur qui recouvre le sprite à cette abscisse
   * et à cette hauteur est soit « cœur » (la case est abandonnée : -1 ; il rogne la fenêtre et sort de la liste s'il touche le
   * haut), soit « bord » (l'échantillon est écarté : 1). 0 : aucun.
   */
  function checkWalls(col: number, x: number, y: number): number {
    const left = x - (body.width >> 1);
    const right = left + body.width;
    const cellLeft = col * 4 - (body.width >> 1);
    let core = 0;
    let edge = 0;
    for (let k = 0; k < walls.length; k++) {
      const { col: wallCol, lo, hi } = walls[k]!;
      const wallX = wallCol * 4;
      if (!(left <= wallX + 3 && wallX <= right - 1 && lo <= y && y - body.height + 1 <= hi)) continue;
      if (cellLeft + body.width - 1 < wallX || wallX + 3 < cellLeft + 3) {
        edge++;
        continue;
      }
      core++;
      const top = hi + body.height - 1;
      // l'indicateur de `16b4` cumule (OR) les deux contacts : le haut est rogné aussi quand seul le bas touche (`1b11:17ab..17c4`)
      let hit = !(cellYMin < lo || top < cellYMin);
      if (hit) cellYMin = hi + body.height;
      if (lo <= cellYMax && cellYMax <= top) hit = true;
      if (hit) cellYMax = lo - 1;
      below = startY - cellYMin;
      above = cellYMax - startY;
      if (hit) {
        // le mur est remplacé par le dernier de la liste
        walls[k] = walls[walls.length - 1]!;
        walls.pop();
        if (walls.length === 0) break;
        k--;
      }
    }
    return core ? -1 : edge ? 1 : 0;
  }

  /** Balayage des zones (`1b11:0614..085d`) : seul balayage des objets de `Dep` 2 et 4. */
  function sweepZones(): void {
    for (const zone of terrain.zones) {
      let zoneXMin = zone.colStart * 4;
      let zoneXMax = zone.colEnd * 4 + 3;
      if (!(zoneXMin <= xMax && xMin <= zoneXMax)) continue;
      zoneXMax = Math.min(zoneXMax, xMax);
      zoneXMin = Math.max(zoneXMin, xMin);
      let zoneYMin = zone.low;
      let zoneYMax = zone.high;
      if (!(zoneYMin <= yMax && yMin <= zoneYMax)) continue;
      zoneYMax = Math.min(zoneYMax, yMax);
      zoneYMin = Math.max(zoneYMin, yMin);
      let zoneP = zone.row * 8;
      let zonePMax = zoneP + 7;
      if (!(zoneP <= pMax && pMin <= zonePMax)) continue;
      zonePMax = Math.min(zonePMax, pMax);
      zoneP = Math.max(zoneP, pMin);
      // même filtre de type que le balayage des plans, sans la règle `t >= 2`
      if (wantedType === 0 ? !accepts(zone.type) : zone.type !== wantedType) continue;
      const countX = zoneXMax - zoneXMin + 1;
      const countY = zoneYMax - zoneYMin + 1;
      const countP = zonePMax - zoneP + 1;
      const startX = tgtX < zoneXMin ? 0 : Math.min(zoneXMax, tgtX) - zoneXMin;
      const startYOffset = tgtY < zoneYMin ? 0 : Math.min(zoneYMax, tgtY) - zoneYMin;
      const startP = tgtP < zoneP ? 0 : Math.min(zonePMax, tgtP) - zoneP;
      for (let k = 0; k < countP; k++) {
        const p = ((startP + k) % countP) + zoneP;
        if (p < pMin || p > pMax) continue;
        for (let m = 0; m < countY; m++) {
          const y = ((m + startYOffset) % countY) + zoneYMin;
          if (y < yMin || y > yMax) continue;
          for (let i = 0; i < countX; i++) {
            const x = ((startX + i) % countX) + zoneXMin;
            if (x < xMin || x > xMax) continue;
            const d2 = (x - tgtX) ** 2 + (y - tgtY) ** 2 + (p - tgtP) ** 2;
            if (!(d2 < bestD2)) continue;
            body.x = x;
            body.y = y;
            body.p = p;
            if (env.contact && env.contact(body).err === 8) continue;
            if (terrainCollision(terrain, body, env.depthBlocked).code !== 0) continue;
            record(x, y, p, 0, zone.type);
            best = planeBest;
            bestRadius = radius3d;
            bestD2 = lastD2;
            if (radius3d === 0) return;
          }
        }
      }
    }
  }

  const found = best as Candidate | null;
  if (found && bestRadius < NEVER) {
    body.x = found.x;
    body.y = found.y;
    body.p = found.p;
    body.plane = found.plane;
    body.presence = inRoom ? 2 : 1;
    if (inRoom) body.ground = found.type;
    memory.code = body.ground === originalGround ? PLACE_OK : PLACE_TYPE_CHANGED;
  } else {
    if (memory.code === 0) memory.code = PLACE_NOT_FOUND;
    Object.assign(body, origin);
  }
  body.err = memory.code;
  return memory.code;
}

/**
 * `placer(o, mode)`, `1aba:000e` (`movement.md` § 4.1). Retour : `Err` de l'objet (0, 0x11 ou un échec de la recherche).
 * Les effets de bord du moteur après un succès (drapeaux héros / sélection, redessin du fond) sont à la charge de l'appelant.
 */
export function placeObject(body: PlaceBody, mode: number, env: PlaceEnv): number {
  for (;;) {
    body.err = 0;
    switch (mode) {
      case 0:
        body.plane = 0;
        body.x = 0;
        body.y = 0;
        body.p = 0;
        body.ground = 0;
        body.presence = 0;
        return 0;
      case 1:
        return searchPosition(body, env, SEARCH_FREE);
      case 2:
      case 6:
      case 8:
        body.presence = mode;
        return 0;
      case 3:
        return searchPosition(body, env, { ...SEARCH_FREE, tolX: 10, tolP: 4 });
      case 4:
        return searchPosition(body, env, { ...SEARCH_FREE, type: body.ground });
      case 5: {
        const result = searchPosition(body, env, { ...SEARCH_FREE, type: body.ground });
        if (result === PLACE_OK || result === PLACE_TYPE_CHANGED) return result;
        mode = 1;
        continue;
      }
      case 9: {
        const random = env.random ?? (() => Math.floor(Math.random() * 0x7fff));
        const flyer = body.dep === 1 || body.dep === 3;
        body.x = random() % MAX_X;
        body.y = flyer ? (random() % (MAX_Y - 10)) + 10 : MAX_Y;
        body.p = random() % MAX_P;
        body.plane = 0;
        body.ground = 0;
        mode = 1;
        continue;
      }
      case 10:
        body.ground = 0;
        return searchPosition(body, env, { ...SEARCH_FREE, side: body.info });
      default:
        throw new RangeError(`Mode de placement invalide : ${mode}`);
    }
  }
}
