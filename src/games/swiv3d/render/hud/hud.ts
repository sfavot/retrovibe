/**
 * HUD de SWIV 3D dans l'image indexée 320×400 (`gm_draw_hud` `0042ec80`, `gm_draw_overlay_sw` `004362b8`, `gm_draw_crosshair` `00437c38` ;
 * `docs/swiv3d/rules.md` § 7 et 8). À appeler après la vue 3D. Positions et ordre de tracé : celles de l'exécutable en mode 320×400.
 */
import { encodeCp437 } from "../../../../data/cp437";
import type { GlobalData } from "../../data/global";
import { blitRows, blitSprite } from "./blit";
import { drawRadar, stepPointer, type RadarAssets } from "./radar";
import { SPECIAL_SLOTS, type HudState, type Reticle } from "./state";
import { createPauseScreen, type PauseScreen } from "./pause";
import { ascii, drawText } from "./text";
import { GAUGE_HEIGHT, GAUGE_WIDTH } from "../../data/global";
import { createText3d, MessagePool, TITLE_TINT } from "../text3d";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../view";

export interface HudAssets {
  global: Pick<GlobalData, "weaponIcons" | "radar" | "gauge" | "font" | "strings" | "sprites29x40" | "vectorFont">;
  /** Table de mélange de la partie : SLV 108 du niveau (`005bc180`) ; `GLOBAL 800` hors niveau. 65 536 octets. */
  blendTable: Uint8Array;
  /** SLV 109 (128 × 256) : viseur. */
  table109: Uint8Array;
  /** Bloc 103 du niveau (512 × 512). */
  colorMap: Uint8Array;
  /** 8 Ko à l'offset 0x300 du bloc 11003 du niveau : voir `radarColorTable`. Sert aussi aux couleurs du texte 3D (`005bc158`). */
  radarColors: Uint8Array;
}

export interface HudOptions {
  /** Horloge en millisecondes : les messages 3D de l'écran de pause avancent au rythme de 40 Hz même quand le monde est arrêté. */
  now?: () => number;
}

/** Pas de la boucle d'événements de l'exécutable (`0x19` ms) et seuil au-delà duquel le retard est abandonné (800 ms). */
const EFFECT_TICK_MS = 25;
const EFFECT_CATCH_UP_MS = 800;
/** Le monde peut avancer de beaucoup de ticks entre deux images (onglet masqué) : on ne rejoue pas plus d'une durée de vie. */
const MAX_TICKS_PER_FRAME = 200;

/** Table des couleurs du radar à partir des octets bruts du bloc 11003 (`bd.get(11003)`). */
export function radarColorTable(block11003: Uint8Array): Uint8Array {
  if (block11003.length < 0x2300) throw new Error("HUD : bloc 11003 trop court pour la table du radar");
  return block11003.subarray(0x300, 0x2300);
}

export interface Hud {
  /** Dessine le HUD par-dessus `fb` (`320 × 400` indices). */
  draw(fb: Uint8Array, state: HudState): void;
  /** Fait repartir les messages 3D figés (« Accompli », « Game over ! ») : `gm_title_release`, à l'ouverture d'un écran de fin. */
  releaseTitles(): void;
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

export function createHud(assets: HudAssets, options: HudOptions = {}): Hud {
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

  // Messages 3D : le pool de l'exécutable, alimenté par les messages du monde (reconnus par leur clé) et par l'écran de pause.
  const now = options.now ?? (() => performance.now());
  const pool = new MessagePool();
  let glyphPage = 0;
  const text3d = createText3d({ font: g.vectorFont, glyphIndex: (code) => g.font.glyphIndex(code, glyphPage), colors: assets.radarColors });
  let seen = new Set<number>();
  let wasPaused = false;
  let wallLast = 0;
  let wallAccumulated = 0;
  const pauseScreens: Partial<Record<HudState["language"], PauseScreen>> = {};

  /** Un tick des effets (`gm_effects_tick`) par tick du monde ; à l'arrêt (pause), un tick toutes les 25 ms d'horloge. */
  function advanceMessages(state: HudState, worldTicks: number): void {
    if (state.paused) {
      const t = now();
      if (!wasPaused) wallAccumulated = 0;
      else wallAccumulated += t - wallLast;
      wallLast = t;
      if (wallAccumulated > EFFECT_CATCH_UP_MS) wallAccumulated = 0;
      for (; wallAccumulated > EFFECT_TICK_MS; wallAccumulated -= EFFECT_TICK_MS) pool.tick();
    } else {
      for (let t = 0; t < worldTicks; t++) pool.tick();
    }
  }

  /** Crée les messages 3D des nouveaux messages du monde, retire ceux qui ont disparu de la liste, ouvre ou ferme l'écran de pause. */
  function syncMessages(state: HudState): void {
    const current = new Set<number>();
    for (const m of state.messages) {
      current.add(m.serial);
      if (!seen.has(m.serial)) pool.spawn(bytesOf(state, m.textTable, m.textId), m.tint, m.type);
    }
    seen = current;
    if (state.paused && !wasPaused) pool.spawn(bytesOf(state, 4, 0), TITLE_TINT, 11);
    if (!state.paused && wasPaused) pool.releaseTitles();
  }

  function advance(state: HudState): void {
    const target = gaugeTarget(state.energy);
    if (lastTick !== null && state.tick < lastTick) {
      // Nouveau niveau : le jeu réinitialise le pool (`gm_message_pool_init`).
      pool.clear();
      seen.clear();
    }
    const ticks = lastTick === null ? 0 : Math.max(0, Math.min(state.tick - lastTick, MAX_TICKS_PER_FRAME));
    syncMessages(state);
    advanceMessages(state, ticks);
    wasPaused = state.paused;
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

  /** Viseurs : 28 colonnes sur 29 (`00437c38`), tracés à travers la table 109 ; jaune (images 0 à 15) puis rouge (16 à 31). */
  function drawCrosshair(fb: Uint8Array, state: HudState): void {
    const c = state.crosshair;
    if (!c) return;
    const draw = (reticle: Reticle | null, series: number): void => {
      if (!reticle) return;
      const image = g.sprites29x40[series + (reticle.frame & 15)];
      if (image) blitRows(fb, assets.table109, image, 29, 40, Math.round(reticle.x) - 14, Math.round(reticle.y) - 20, 28);
    };
    draw(c.yellow, 0);
    draw(c.red, 16);
  }

  function drawPause(fb: Uint8Array, state: HudState): void {
    let screen = pauseScreens[state.language];
    if (!screen) {
      const language = GLYPH_PAGE_LANGUAGE[state.language];
      const hint = g.strings.get(language, 4, 1) ?? "";
      screen = pauseScreens[state.language] = createPauseScreen(g.font, blend, g.strings.glyphPages[language] ?? 0, hint);
    }
    screen.draw(fb);
  }

  return {
    releaseTitles: () => pool.releaseTitles(),
    draw(fb, state) {
      if (fb.length < SCREEN_WIDTH * SCREEN_HEIGHT) throw new Error("HUD : image trop petite");
      glyphPage = g.strings.glyphPages[GLYPH_PAGE_LANGUAGE[state.language]] ?? 0;
      advance(state);
      drawCrosshair(fb, state);
      // En pause l'exécutable dessine le décor seul (`gm_frame` sans le drapeau 2) : ni radar, ni jauge, ni score.
      if (!state.paused) {
        drawRadar(fb, radarAssets, state.radar, pointer, state.tick);
        drawWeapons(fb, state);
        text(fb, state, ascii(formatScore(state.score)), "right", LAYOUT.score.right, LAYOUT.score.y);
        drawGauge(fb, state);
        if (state.missionName) text(fb, state, encodeCp437(state.missionName), "center", LAYOUT.mission.x, LAYOUT.mission.y);
      }
      text3d.draw(fb, pool);
      if (state.paused) drawPause(fb, state);
    },
  };
}
