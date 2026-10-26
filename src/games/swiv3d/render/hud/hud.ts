/**
 * HUD de SWIV 3D dans l'image indexée 320×400 (`gm_draw_hud` `0042ec80`, `gm_draw_overlay_sw` `004362b8`, `gm_draw_crosshair` `00437c38` ;
 * `docs/swiv3d/rules.md` § 7 et 8). À appeler après la vue 3D. Positions et ordre de tracé : celles de l'exécutable en mode 320×400.
 */
import { encodeCp437 } from "../../../../data/cp437";
import type { GlobalData } from "../../data/global";
import { blitRows, blitSprite } from "./blit";
import { drawRadar, stepPointer, type RadarAssets } from "./radar";
import { SPECIAL_SLOTS, type HudState } from "./state";
import { ascii, drawText } from "./text";
import { GAUGE_HEIGHT, GAUGE_WIDTH } from "../../data/global";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../view";

export interface HudAssets {
  global: Pick<GlobalData, "weaponIcons" | "radar" | "gauge" | "font" | "strings" | "sprites29x40">;
  /** Table de mélange de la partie : SLV 108 du niveau (`005bc180`) ; `GLOBAL 800` hors niveau. 65 536 octets. */
  blendTable: Uint8Array;
  /** SLV 109 (128 × 256) : viseur. */
  table109: Uint8Array;
  /** Bloc 103 du niveau (512 × 512). */
  colorMap: Uint8Array;
  /** 8 Ko à l'offset 0x300 du bloc 11003 du niveau : voir `radarColorTable`. */
  radarColors: Uint8Array;
}

/** Table des couleurs du radar à partir des octets bruts du bloc 11003 (`bd.get(11003)`). */
export function radarColorTable(block11003: Uint8Array): Uint8Array {
  if (block11003.length < 0x2300) throw new Error("HUD : bloc 11003 trop court pour la table du radar");
  return block11003.subarray(0x300, 0x2300);
}

export interface Hud {
  /** Dessine le HUD par-dessus `fb` (`320 × 400` indices). */
  draw(fb: Uint8Array, state: HudState): void;
}

/** Position de la jauge, des armes, du score et du nom de mission (`rules.md` § 7). */
export const LAYOUT = {
  gauge: { x: 292, y: 10 },
  weaponIcon: { x: 4, y: 354 },
  ammo: { x: 30, y: 354 },
  weaponName: { x: 30, y: 372 },
  /** Premier emplacement de la liste (haut de l'icône suivante) et pas vertical. */
  weaponList: { x: 4, y: 309, step: 40, visible: 5 },
  score: { right: 310, y: 370 },
  mission: { x: 160, y: 10 },
} as const;

const GLYPH_PAGE_LANGUAGE = { en: 0, fr: 1 } as const;
/** Énergie sous laquelle la jauge clignote (`+0x08 < 100`) ; visible 20 ticks sur 32. */
export const GAUGE_BLINK_BELOW = 100;
const GAUGE_FRAMES_MAX = 43;
/** Pas d'animation de l'image de la jauge : un cran tous les 2 ticks. */
const GAUGE_STEP_TICKS = 2;

/** Image visée de la jauge pour une énergie (`FUN_0043c234`) : `énergie >> 5` bornée à 0..31, +12 au-dessus de 15. */
export function gaugeTarget(energy: number): number {
  const target = Math.max(0, Math.min(31, Math.trunc(energy) >> 5));
  return target > 15 ? target + 12 : target;
}

/** Le clignotement masque-t-il la jauge à ce tick ? */
export function gaugeHidden(energy: number, tick: number): boolean {
  return energy < GAUGE_BLINK_BELOW && (tick & 0x1f) >= 0x14;
}

/** `"%07d"` du jeu : au moins 7 caractères, complétés de zéros (signe compris). */
export function formatScore(score: number): string {
  const n = Math.trunc(score);
  return n < 0 ? `-${String(-n).padStart(6, "0")}` : String(n).padStart(7, "0");
}

/** `"x%02d"` des munitions. */
export function formatAmmo(ammo: number): string {
  return `x${String(Math.trunc(ammo)).padStart(2, "0")}`;
}

export function createHud(assets: HudAssets): Hud {
  const { global: g, blendTable: blend } = assets;
  const radarAssets: RadarAssets = {
    colorMap: assets.colorMap,
    colors: assets.radarColors,
    frames510: g.radar.frames510,
    frames511: g.radar.frames511,
    frames512: g.radar.frames512,
    blend,
  };

  // État d'animation du jeu d'origine : image de la jauge (`+0x118`) et pointeur d'objectif, avancés une fois par tick logique.
  let gaugeFrame = -1;
  let pointer = 0;
  let lastTick: number | null = null;

  function advance(state: HudState): void {
    const target = gaugeTarget(state.energy);
    const ticks = lastTick === null ? 0 : Math.max(0, Math.min(state.tick - lastTick, 200));
    if (gaugeFrame < 0 || lastTick === null) gaugeFrame = target;
    for (let t = 1; t <= ticks; t++) {
      pointer = stepPointer(pointer, state.radar);
      if ((lastTick! + t) % GAUGE_STEP_TICKS === 0) {
        if (gaugeFrame < target) gaugeFrame++;
        else if (gaugeFrame > target) gaugeFrame--;
      }
    }
    lastTick = state.tick;
  }

  function bytesOf(state: HudState, table: number, id: number): Uint8Array {
    return g.strings.getBytes(GLYPH_PAGE_LANGUAGE[state.language], table, id) ?? new Uint8Array(0);
  }

  function text(fb: Uint8Array, state: HudState, bytes: Uint8Array, align: "center" | "left" | "right", x: number, y: number): void {
    const page = g.strings.glyphPages[GLYPH_PAGE_LANGUAGE[state.language]] ?? 0;
    drawText(fb, blend, g.font, page, bytes, align, x, y);
  }

  function drawWeapons(fb: Uint8Array, state: HudState): void {
    const selected = state.special;
    const icons = g.weaponIcons;
    const { weaponIcon, ammo, weaponName, weaponList } = LAYOUT;
    // Icône sélectionnée : capsule vide (image 0) sans arme.
    blitSprite(fb, blend, icons[selected < 0 ? 0 : selected + 1]!, weaponIcon.x, weaponIcon.y);
    if (selected >= 0) {
      text(fb, state, ascii(formatAmmo(state.specialAmmo[selected] ?? 0)), "left", ammo.x, ammo.y);
      text(fb, state, bytesOf(state, 100, selected), "left", weaponName.x, weaponName.y);
    }
    // Armes suivantes possédées, en cyclant sur 20 : 5 icônes à demi-teinte, puis la flèche (image 21).
    let y = weaponList.y;
    let shown = 0;
    let slot = selected;
    for (let i = 1; i < SPECIAL_SLOTS; i++) {
      slot = (slot + 1) % SPECIAL_SLOTS;
      if ((state.specialAmmo[slot] ?? 0) <= 0) continue;
      if (shown < weaponList.visible) blitSprite(fb, blend, icons[slot + 1]!, weaponList.x, y, true);
      else if (shown === weaponList.visible) blitSprite(fb, blend, icons[21]!, weaponList.x, y, true);
      else break;
      y -= weaponList.step;
      shown++;
    }
  }

  function drawGauge(fb: Uint8Array, state: HudState): void {
    if (gaugeHidden(state.energy, state.tick)) return;
    const frame = g.gauge[Math.max(0, Math.min(gaugeFrame, GAUGE_FRAMES_MAX, g.gauge.length - 1))];
    if (frame) blitRows(fb, blend, frame, GAUGE_WIDTH, GAUGE_HEIGHT, LAYOUT.gauge.x, LAYOUT.gauge.y);
  }

  /** Viseur : 28 colonnes sur 29 (`00437c38`), tracé à travers la table 109. */
  function drawCrosshair(fb: Uint8Array, state: HudState): void {
    const c = state.crosshair;
    if (!c) return;
    const draw = (frame: number): void => {
      const image = g.sprites29x40[frame];
      if (image) blitRows(fb, assets.table109, image, 29, 40, Math.round(c.x) - 14, Math.round(c.y) - 20, 28);
    };
    draw(c.yellowFrame & 15);
    if (c.redFrame !== null) draw(16 + (c.redFrame & 15));
  }

  function drawMessages(fb: Uint8Array, state: HudState): void {
    let y = 110;
    for (const m of state.messages) {
      if (m.ticksLeft <= 0) continue;
      const lines = splitLines(bytesOf(state, m.textTable, m.textId));
      for (const line of lines) {
        text(fb, state, line, "center", SCREEN_WIDTH / 2, y);
        y += 22;
      }
      y += 10;
    }
  }

  function drawPause(fb: Uint8Array, state: HudState): void {
    text(fb, state, bytesOf(state, 4, 0), "center", SCREEN_WIDTH / 2, 170);
    text(fb, state, bytesOf(state, 4, 1), "center", SCREEN_WIDTH / 2, 200);
  }

  return {
    draw(fb, state) {
      if (fb.length < SCREEN_WIDTH * SCREEN_HEIGHT) throw new Error("HUD : image trop petite");
      advance(state);
      drawCrosshair(fb, state);
      drawRadar(fb, radarAssets, state.radar, pointer, state.tick);
      drawWeapons(fb, state);
      text(fb, state, ascii(formatScore(state.score)), "right", LAYOUT.score.right, LAYOUT.score.y);
      drawGauge(fb, state);
      if (state.missionName) text(fb, state, encodeCp437(state.missionName), "center", LAYOUT.mission.x, LAYOUT.mission.y);
      drawMessages(fb, state);
      if (state.paused) drawPause(fb, state);
    },
  };
}

/** Sépare une chaîne du jeu sur `|` (saut de ligne). */
function splitLines(bytes: Uint8Array): Uint8Array[] {
  const lines: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i <= bytes.length; i++) {
    if (i === bytes.length || bytes[i] === 0x7c) {
      lines.push(bytes.subarray(start, i));
      start = i + 1;
    }
  }
  return lines;
}
