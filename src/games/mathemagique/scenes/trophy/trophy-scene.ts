/**
 * Scène 10 : Hall of Fame (`TROPHY.DAT`, `docs/mathemagique/screens/common.md` §6).
 *
 * Fond `SHPL` 107 (en-têtes et 8 barres cuits dans l'image), 8 joueurs par page dans l'ordre alphabétique du moniteur, une cellule par
 * (joueur, opération) avec un ruban par niveau réussi, rang global (`STRL 5000`). Boutons : flèches de page, « Print My Certificate »
 * (image PNG du certificat de la cellule sélectionnée, via `CertificatePort`) et EXIT. Cellule sélectionnée : la première cellule active de la
 * page, ou celle qu'on clique (cadre noir).
 *
 * Écarts : la sortie revient au hub (`exitTo`, défaut `SceneId.hub`) alors que l'original retourne au Bowling (`1078:06d9`, `1b20 = 1`) ; l'original
 * n'est accessible que depuis le Bowling. Le cadre de survol et de sélection est un choix (la forme exacte de `1078:0b48` n'est pas relue).
 */
import { drawShape } from "../../engine/graphics/blit";
import { parseFon, type FonFont } from "../../engine/graphics/fon";
import { Surface } from "../../engine/graphics/surface";
import { drawText } from "../../engine/graphics/text";
import { rectFromEdges, type GadgetGroup } from "../../engine/gadgets";
import type { Archive } from "../../engine/resources";
import { SceneId, type Scene, type SceneContext } from "../../engine/scene";
import type { MathServices } from "../../engine/services";
import { OPERATION_COUNT } from "../../engine/roster";
import { certificateFileName, type CertificateData } from "../certificate/certificate-data";
import { createBrowserCertificateEnvironment, type CertificateEnvironment, type CertificatePort } from "../certificate/port";
import { CertificateRenderer } from "../certificate/render";
import {
  HallOfFameModel,
  NAME_BASELINE,
  NAME_X,
  PLAYERS_PER_PAGE,
  RANK_BASELINE,
  RANK_PREFIX,
  RIBBON_OFFSET,
  RIBBON_STEP,
  ROW_HEIGHT,
  ROW_PITCH,
  ROW_TOP,
  cellRect,
  type CellRef,
} from "./hall-of-fame";

const ARCHIVE = "TROPHY.DAT";
const SYSTEM_ARCHIVE = "MILKYWAY.DAT";
const FONT_FILE = "NCSCLB10.FON";
const BACKGROUND_SHAPE = 107;
const RANKS_STRL = 5000;
const RIBBON_SHAPE = 2000;
const MUSIC_ID = 65000;
const FADE_TICKS = 30;
/** Largeur laissée au nom du joueur : de x = 48 à la première colonne (172) moins une marge. */
const NAME_WIDTH = 120;
/** Couleur du texte et des cadres : index 0 de la palette (noir). */
const INK = 0;

/** Rectangles des boutons (`DS:2cee`, `2cfe`), `[gauche, haut, droite, bas[`. */
const BUTTONS = {
  up: rectFromEdges(38, 39, 57, 53),
  down: rectFromEdges(38, 54, 57, 68),
  print: rectFromEdges(194, 376, 380, 405),
  exit: rectFromEdges(501, 377, 537, 402),
};

export interface TrophyOptions {
  /** Remet l'image du certificat au joueur ; sans port, « Print My Certificate » est inactif. */
  certificates?: CertificatePort;
  /** Canevas et polices du certificat ; défaut : le navigateur. */
  certificateEnvironment?: CertificateEnvironment;
  /** Scène de sortie ; défaut : le hub. */
  exitTo?: SceneId;
  /** Erreur d'impression (fichier manquant, canevas indisponible) ; défaut : `console.error`. */
  onError?: (error: unknown) => void;
}

/** Page affichée d'un accès à l'autre dans une même session (`DS:82b4` n'est jamais remis à 0, common.md §6.2). */
const sessionPages = new WeakMap<object, number>();

export function createTrophyScene(services: MathServices, options: TrophyOptions = {}): Scene {
  let font: FonFont | null = null;
  let archive: Archive | null = null;
  let background: Surface | null = null;
  let model: HallOfFameModel | null = null;
  let cells: GadgetGroup | null = null;
  let renderer: CertificateRenderer | null = null;
  let printing = false;
  /** Cellule survolée au dernier dessin (le cadre de survol suit la souris). */
  let drawnHover: CellRef | null = null;
  let dirty = true;

  function hoveredCell(): CellRef | null {
    const record = services.gadgets.hovered;
    if (!record || record.group !== cells) return null;
    const i = record.index - 1;
    return { row: Math.floor(i / OPERATION_COUNT), operation: i % OPERATION_COUNT };
  }

  function sameCell(a: CellRef | null, b: CellRef | null): boolean {
    return a === b || (a !== null && b !== null && a.row === b.row && a.operation === b.operation);
  }

  function frame(screen: Surface, ref: CellRef, thickness: number): void {
    const r = cellRect(ref.row, ref.operation);
    for (let t = 1; t <= thickness; t++) {
      screen.fill(INK, { x: r.x - t, y: r.y - t, w: r.w + 2 * t, h: 1 });
      screen.fill(INK, { x: r.x - t, y: r.y + r.h + t - 1, w: r.w + 2 * t, h: 1 });
      screen.fill(INK, { x: r.x - t, y: r.y - t, w: 1, h: r.h + 2 * t });
      screen.fill(INK, { x: r.x + r.w + t - 1, y: r.y - t, w: 1, h: r.h + 2 * t });
    }
  }

  /** Repeint les 8 lignes : fond, nom, rang, rubans, cadres (équivalent de `1078:0860` et des rappels `0b48`). */
  function paint(ctx: SceneContext): void {
    if (!background || !archive || !font || !model) return;
    const { screen } = services.graphics;
    const hover = hoveredCell();
    for (let row = 0; row < PLAYERS_PER_PAGE; row++) {
      const top = ROW_TOP + ROW_PITCH * row;
      screen.copyFrom(background, { x: 36, y: top - 3, w: 504, h: ROW_HEIGHT + 6 });
      const hall = model.rows[row];
      if (!hall) continue;
      screen.pushClip({ x: NAME_X, y: top, w: NAME_WIDTH, h: ROW_HEIGHT });
      drawText(screen, font, hall.player.name, NAME_X, NAME_BASELINE + ROW_PITCH * row - font.ascent, INK);
      drawText(screen, font, RANK_PREFIX + hall.rank, NAME_X, RANK_BASELINE + ROW_PITCH * row - font.ascent, INK);
      screen.popClip();
      for (const cell of hall.cells) {
        const rect = cellRect(row, cell.operation);
        cell.levels.forEach((achieved, level) => {
          if (achieved) drawShape(screen, archive!.shap(RIBBON_SHAPE + level), rect.x + RIBBON_STEP * level + RIBBON_OFFSET, rect.y + RIBBON_OFFSET, 8);
        });
      }
    }
    const selected = model.selection;
    if (hover && !sameCell(hover, selected)) frame(screen, hover, 1);
    if (selected) frame(screen, selected, 2);
    drawnHover = hover;
    dirty = false;
    ctx.requestPresent();
  }

  /** Met les 48 cellules à jour : masquée sans joueur, inactive sans niveau réussi. */
  function syncCells(): void {
    if (!cells || !model) return;
    for (let row = 0; row < PLAYERS_PER_PAGE; row++) {
      for (let op = 0; op < OPERATION_COUNT; op++) {
        const record = cells.record(1 + OPERATION_COUNT * row + op);
        const hall = model.rows[row];
        record.hidden = !hall;
        record.disabled = !!hall && !hall.cells[op]!.active;
      }
    }
  }

  function changePage(delta: number, ctx: SceneContext): void {
    if (!model || !model.movePage(delta)) return;
    sessionPages.set(services, model.page);
    syncCells();
    dirty = true;
    ctx.requestPresent();
  }

  function print(ctx: SceneContext): void {
    const data: CertificateData | null = model?.selectedCertificate() ?? null;
    if (!data || !options.certificates || printing) return;
    const port = options.certificates;
    renderer ??= new CertificateRenderer(options.certificateEnvironment ?? createBrowserCertificateEnvironment(), (path) => ctx.host.loadFile(path));
    printing = true;
    renderer
      .render(data)
      .then((blob) => port.download(blob, certificateFileName(data.playerName, data.operation)))
      .catch((error: unknown) => (options.onError ?? console.error)(error))
      .finally(() => {
        printing = false;
      });
  }

  return {
    async load(ctx) {
      const [trophy, fonBytes] = await Promise.all([ctx.resources.open(ARCHIVE), ctx.host.loadFile(FONT_FILE), ctx.resources.open(SYSTEM_ARCHIVE, "persistent")]);
      archive = trophy;
      const first = parseFon(fonBytes)[0];
      if (!first) throw new Error(`${FONT_FILE} : aucune police`);
      font = first;
    },

    enter(ctx) {
      const trophy = archive ?? ctx.resources.require(ARCHIVE);
      archive = trophy;
      const { screen, palette } = services.graphics;
      services.useArchive(trophy);
      palette.loadShpl(trophy.shpl(BACKGROUND_SHAPE));
      const image = trophy.shap(BACKGROUND_SHAPE);
      screen.pixels.set(image.pixels);
      background = new Surface(screen.width, screen.height);
      background.pixels.set(image.pixels);

      const ranks = trophy.strl(RANKS_STRL);
      model = new HallOfFameModel(ranks);
      model.setPlayers(ctx.roster.roster.players(), sessionPages.get(services) ?? 0);
      sessionPages.set(services, model.page);

      services.gadgets.addGroup({
        id: "trophy-buttons",
        records: [
          { rect: BUTTONS.up, shapes: { normal: 1000, hover: 1001, pressed: 1001 } },
          { rect: BUTTONS.down, shapes: { normal: 1002, hover: 1003, pressed: 1003 } },
          { rect: BUTTONS.print, shapes: { normal: 1004, hover: 1005, pressed: 1005 }, disabled: !options.certificates },
          { rect: BUTTONS.exit, shapes: { normal: 1500, hover: 1501, pressed: 1501 } },
        ],
        onActivate(index) {
          if (index === 1) changePage(-1, ctx);
          else if (index === 2) changePage(1, ctx);
          else if (index === 3) print(ctx);
          else ctx.scenes.request(options.exitTo ?? SceneId.hub);
        },
      });
      cells = services.gadgets.addGroup({
        id: "trophy-cells",
        records: Array.from({ length: PLAYERS_PER_PAGE * OPERATION_COUNT }, (_, i) => ({
          rect: cellRect(Math.floor(i / OPERATION_COUNT), i % OPERATION_COUNT),
          focusable: false,
        })),
        onActivate(index) {
          const i = index - 1;
          if (model?.selectCell(Math.floor(i / OPERATION_COUNT), i % OPERATION_COUNT)) dirty = true;
        },
      });
      syncCells();
      services.gadgets.captureBackground(screen);
      services.gadgets.invalidate();
      paint(ctx);

      services.sound.playSound(ctx.resources.require(SYSTEM_ARCHIVE), MUSIC_ID, { ambient: true, loop: true });
      palette.fadeFromBlack(FADE_TICKS);
      ctx.setCursor("arrow");
      ctx.requestPresent();
    },

    tick(ctx) {
      if (!sameCell(hoveredCell(), drawnHover)) dirty = true;
      if (dirty) paint(ctx);
    },

    exit(ctx) {
      ctx.scenes.request(options.exitTo ?? SceneId.hub);
    },

    leave() {
      services.endScene({ keepMusic: true });
      cells = null;
      background = null;
      model = null;
      drawnHover = null;
    },
  };
}
