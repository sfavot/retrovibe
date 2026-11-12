/**
 * Joueur des solutions de Lure of the Temptress : une solution est une liste d'étapes (`Step[]`, des données dans `zone-*.ts`) que
 * `Play` joue par de **vrais clics** (pointeur, clic gauche ou droit, menus surgissants, sorties, écrans de choix) sur le moteur, sans
 * jamais écrire l'état du jeu. Un seul joueur pour toutes les zones (cellule, village, grottes et monastère, château).
 *
 * ## API
 *
 * ```ts
 * const play = new Play(engine, host);   // `makeEngine()` de `test/lure/engine/test-host.ts`
 * play.run(steps, (index, step) => { … }); // le rappel est appelé AVANT chaque étape
 * play.log.dialogs                       // boîtes, bulles et écrans de choix vus (Unicode), dans l'ordre
 * play.log.steps                         // étapes jouées ; play.frames : images jouées par ce joueur
 * play.room, play.inventory()            // pièce affichée ; noms (Unicode) des objets du joueur
 * ```
 *
 * Les étapes (`Step`) ; les libellés sont ceux des menus, en Unicode ; `note` est libre (documentation de la solution) :
 *
 * | Étape | Ce que fait le joueur |
 * | --- | --- |
 * | `{ exit: room }` | clic gauche sur la zone de sortie de la pièce courante qui mène à `room` (porte fermée : « Ouvre » d'abord) ; réessaie si un personnage barre la route |
 * | `{ go: [x, y], room }` | clic gauche en `(x, y)` jusqu'à être dans la pièce `room` (une sortie que la table des sorties ne décrit pas, ou dont le centre est inatteignable) |
 * | `{ goto: room, avoid? }` | plus court chemin de sorties jusqu'à `room`, sans les passages `"depuis>vers"` de `avoid` (défaut : la porte 20 <-> 12) |
 * | `{ walk: [x, y] }` | clic gauche sur un point du sol, puis attendre le repos |
 * | `{ stand: [x, y] }` | comme `walk`, en recommençant jusqu'à ce que les pieds du joueur y soient (à 20 pixels près) |
 * | `{ verb, on?, with?, here? }` | clic droit sur le hotspot `on` (un point où le pointeur le désigne vraiment), le verbe, puis l'objet `with` ; sans `on` : menu « standard » (Bois, Statut…). Un personnage est d'abord rejoint dans sa pièce, sauf avec `here` (lève s'il n'est pas là : à combiner avec `repeat`) |
 * | `{ look: id }` | clic gauche sur le hotspot (« Regarde ») |
 * | `{ talk: [fragments] }` | dialogue en cours : à chaque écran de choix, la ligne qui contient le fragment suivant (la première ligne quand la liste est épuisée) |
 * | `{ tell: id, orders }` | « Dis à » : clic droit sur le personnage, « Dis à », puis chaque `TellOrder` (verbe, objet, « et puis » ou « Fin ») |
 * | `{ until: (engine, host) => boolean, what, max?, stay? }` | laisser passer des images jusqu'à la condition (ce qu'un joueur observe), au plus `max` (3000) ; lève sinon. En attendant, le joueur cède le passage (`giveWay`) à un personnage qu'il gêne ou qui va arriver sur lui ; `stay` : il ne bouge pas (il bloque exprès un passage) |
 * | `{ giveWay: true }` | s'écarter : le point du sol le plus proche loin des personnages de la pièce, de leur chemin vers ce qu'ils vont faire, des points d'arrivée et des sorties (chemin vérifié par la recherche de chemin du moteur) |
 * | `{ wait: n }` | laisser passer `n` images |
 * | `{ fight: foe }` | combat en cours, réactif : répond au coup que l'adversaire lance, sinon marche vers lui et frappe où il ne garde pas |
 * | `{ skipUntil, what, max? }` | séquence plein écran : un clic à chaque image tant que le moteur est occupé, jusqu'à la condition |
 * | `{ repeat: steps, until, what, times?, optional? }` | rejouer `steps` (au plus `times` fois, 3 par défaut) jusqu'à la condition, comme une personne qui recommence (un personnage parti en marchant n'a pas pris l'objet) ; rien si elle est déjà vraie ; lève sinon, sauf `optional` |
 *
 * Réactions de joueur attentif (génériques) : un personnage qui fait un détour (`blockedFlag`) n'est pas interpellé avant d'avoir repris sa
 * route (`waitDetour`) ; un personnage qu'on ne peut pas désigner (il sort, il entre) est rejoint de nouveau ; le joueur pris par le Skorl
 * fait échouer l'étape aussitôt.
 *
 * Entre deux actions, le joueur est « pressé » : il ferme les boîtes de texte d'un clic et clique sur les bulles de parole qui le
 * permettent (celles du joueur ou qui lui sont adressées, `checkInTalkDialog`) ; les autres bulles se ferment d'elles-mêmes.
 * Une étape qui ne peut pas aboutir **lève** une erreur qui décrit l'état (pièce, position, action, curseur…).
 */

import { gameTextToUnicode } from "../../../src/games/lure/data/charset";
import { Direction, UiString } from "../../../src/games/lure/data/ids";
import type { FightsManager } from "../../../src/games/lure/engine/fights/index";
import type { LureEngine } from "../../../src/games/lure/engine/game";
import type { Hotspot } from "../../../src/games/lure/engine/hotspot";
import { CharacterMode, CurrentAction, CursorState, Field, GameState, HotspotId, TickProc } from "../../../src/games/lure/engine/ids";
import { PathResult, createPathFinder, processPath, resetPath } from "../../../src/games/lure/engine/pathfinder";
import { clearPathOccupied, pathOccupied } from "../../../src/games/lure/engine/state";
import { charactersIntersecting } from "../../../src/games/lure/engine/support";
import { talkSelectView } from "../../../src/games/lure/engine/talk";
import { TalkState } from "../../../src/games/lure/engine/world";
import { bubbleText } from "../../../src/games/lure/render/talk-bubble";
import { Driver, type TestHost } from "../engine/test-host";

/** Un ordre de « Dis à » : verbe, objet visé (libellé du menu) et, pour qu'il soit proposé, le hotspot que le joueur doit avoir survolé. */
export interface TellOrder {
  verb: string;
  object?: string;
  seen?: number;
}

/** Condition observée sur le jeu. */
export type Until = (engine: LureEngine, host: TestHost) => boolean;

/** Une étape de la solution (voir le tableau en tête du fichier). */
export type Step =
  | { exit: number; note?: string }
  | { go: [number, number]; room: number; note?: string }
  | { goto: number; avoid?: string[]; note?: string }
  | { walk: [number, number]; note?: string }
  | { stand: [number, number]; note?: string }
  | { verb: string; on?: number; with?: string; here?: boolean; note?: string }
  | { look: number; note?: string }
  | { talk: string[]; note?: string }
  | { tell: number; orders: TellOrder[]; note?: string }
  | { until: Until; what: string; max?: number; stay?: boolean; note?: string }
  | { wait: number; note?: string }
  | { giveWay: true; note?: string }
  | { fight: number; note?: string }
  | { skipUntil: Until; what: string; max?: number; note?: string }
  | { repeat: Step[]; until: Until; what: string; times?: number; optional?: boolean; note?: string };

export interface PlayLog {
  /** Boîtes de texte, bulles de parole et écrans de choix vus (Unicode), dans l'ordre. */
  dialogs: string[];
  /** Étapes jouées. */
  steps: number;
}

/** Portes que le joueur ne peut pas ouvrir au début du village (la 2721, pièce 20 vers 12, s'ouvre quand `TALK_INDEX` est de 8 à 13). */
export const DOORS_LOCKED: readonly string[] = ["20>12", "12>20"];

/** Hauteur d'une bulle de parole que le rendu donnerait (`room.talkDialogHeight`) : sans rendu, une bulle ne se clique pas. */
const BUBBLE_HEIGHT = 32;

const FIGHT_HEIGHTS = ["fightCursorLeftTop", "fightCursorLeftMiddle", "fightCursorLeftBottom"] as const;

export class Play {
  readonly d: Driver;
  readonly log: PlayLog = { dialogs: [], steps: 0 };
  /** Images jouées par ce joueur. */
  frames = 0;
  private lastBubble = "";

  constructor(
    readonly engine: LureEngine,
    readonly host: TestHost,
  ) {
    this.d = new Driver(engine, host);
  }

  get room(): number {
    return this.engine.room.roomNumber;
  }

  inventory(): string[] {
    return this.engine.world.state.hotspots.filter((h) => h.roomNumber === HotspotId.PLAYER).map((h) => gameTextToUnicode(this.engine.text(h.nameId)));
  }

  // --- le temps qui passe -------------------------------------------------------------------------------------------------------

  /** Une image : ferme la boîte de texte (clic), ou clique sur une bulle de parole qui le permet, ou avance d'un tick. */
  frame(): void {
    this.frames++;
    const e = this.engine;
    const bubble = e.room.talkDialog;
    if (bubble) {
      const key = `${bubble.srcCharacterId}:${bubble.stringId}`;
      if (key !== this.lastBubble) {
        this.lastBubble = key;
        const who = bubble.srcCharacterId === HotspotId.PLAYER ? "Diermot" : gameTextToUnicode(e.text(e.world.requireHotspot(bubble.srcCharacterId).nameId));
        // Le texte tel que la bulle l'affiche (noms et articles substitués).
        this.log.dialogs.push(`<${who} (${bubble.srcCharacterId.toString(16)}) : ${gameTextToUnicode(bubbleText(e, bubble))}>`);
      }
    } else this.lastBubble = "";
    if (e.dialogText !== null) {
      this.log.dialogs.push(this.d.dialog()!);
      this.d.click(160, 100);
      return;
    }
    if (bubble && !bubble.building) {
      e.room.talkDialogHeight = BUBBLE_HEIGHT;
      const x = bubble.x + 8;
      const y = bubble.y + 4;
      this.d.hover(x, y);
      if (e.room.checkInTalkDialog()) {
        this.d.click(x, y);
        return;
      }
    }
    e.tick();
    // Le Skorl a rattrapé le joueur : la partie est perdue, aucune étape ne peut continuer.
    if (e.gameState & GameState.CAUGHT) throw new Error(`le joueur a été pris (pièce ${this.room})`);
  }

  frameCount(n: number): void {
    for (let k = 0; k < n; k++) this.frame();
  }

  /** Vrai quand le joueur n'a plus rien à faire (ni action, ni dialogue, ni séquence, ni changement de pièce). */
  quiet(): boolean {
    const e = this.engine;
    const player = e.world.getActiveHotspot(HotspotId.PLAYER);
    return (
      !e.busy &&
      e.dialogText === null &&
      e.world.talkState === TalkState.NONE &&
      e.room.cursorState === CursorState.NONE &&
      (player?.currentActions.isEmpty() ?? true) &&
      e.world.fields.get(Field.OLD_ROOM_NUMBER) === 0
    );
  }

  /** Avance jusqu'à ce que le joueur soit au repos 6 images de suite (au plus `max` images) ; s'arrête sur un écran de choix. */
  settle(max = 2500): void {
    let calm = 0;
    for (let i = 0; i < max && calm < 6; i++) {
      this.frame();
      if (this.engine.world.talkState === TalkState.SELECT) return;
      calm = this.quiet() ? calm + 1 : 0;
    }
  }

  /**
   * Laisse passer des images jusqu'à la condition. Comme une personne qui attend : elle ne reste pas dans un passage (près d'une zone de
   * sortie, là où arrivent ceux qui entrent) et, si un personnage de la pièce est gêné par elle (`hindered`), elle lui cède le passage
   * (`giveWay`). `stay` : le joueur reste où il est (il bloque exprès un passage).
   */
  until(test: Until, what: string, max = 3000, stay = false): void {
    let lastWay = -1000;
    for (let i = 0; i < max && !test(this.engine, this.host); i++) {
      if (!stay && i - lastWay >= 60 && this.quiet() && (this.onArrivalPoint() || this.hindered().length > 0)) {
        lastWay = i;
        this.giveWay();
        continue;
      }
      this.frame();
    }
    if (!test(this.engine, this.host)) throw new Error(`attente sans fin : ${what} (pièce ${this.room})`);
  }

  /**
   * Le joueur est sur le point d'arrivée d'un personnage qui vient d'une pièce voisine vers la sienne (l'action en tête de sa pile a lieu
   * dans la pièce du joueur) : arrivé sur lui, il ne pourrait pas entrer (`checkForIntersectingCharacter`, comme ScummVM).
   */
  private onArrivalPoint(): boolean {
    const player = this.engine.world.requireActiveHotspot(HotspotId.PLAYER);
    return this.engine.world.activeHotspots.some((h) => {
      if (h.hotspotId === HotspotId.PLAYER || h.hotspotId >= HotspotId.START_EXIT || h.roomNumber === this.room) return false;
      if (h.currentActions.isEmpty() || h.currentActions.top().roomNumber !== this.room) return false;
      const exit = this.engine.data.rooms.find((r) => r.roomNumber === h.roomNumber)?.exits.find((e) => e.roomNumber === this.room);
      return exit !== undefined && Math.abs(player.x - exit.x) < 40 && Math.abs(player.y - exit.y) < 24;
    });
  }

  private nearExit(x: number, y: number): boolean {
    const exits = this.engine.data.rooms.find((r) => r.roomNumber === this.room)?.exits ?? [];
    return exits.some((e) => x >= e.xs - 32 && x <= e.xe + 32 && y >= e.ys - 24 && y <= e.ye + 24);
  }

  /** Les personnages de la pièce du joueur (hors le joueur), actifs. */
  private charactersHere(): Hotspot[] {
    return this.engine.world.activeHotspots.filter(
      (h) => h.hotspotId !== HotspotId.PLAYER && h.hotspotId < HotspotId.START_EXIT && h.roomNumber === this.room && h.heightCopy >= 32,
    );
  }

  /** Les pieds d'un personnage (milieu bas du cadre). */
  private feetOf(h: Hotspot): { x: number; y: number } {
    return { x: h.x + (h.widthCopy >> 1), y: h.y + h.heightCopy };
  }

  /**
   * Les personnages que le joueur gêne, tels qu'une personne les voit : arrêté contre lui (il attend que le passage se libère), ou
   * détourné (recherche de chemin bloquée, `blockedState`) avec le joueur près de lui ou de là où il allait, ou arrivé sur lui en entrant.
   */
  private hindered(): number[] {
    const player = this.engine.world.requireActiveHotspot(HotspotId.PLAYER);
    const p = this.feetOf(player);
    const near = (q: { x: number; y: number }, r: number): boolean => Math.abs(q.x - p.x) <= r && Math.abs(q.y - p.y) <= r / 2;
    return this.charactersHere()
      .filter((h) => {
        const f = this.feetOf(h);
        const touching = charactersIntersecting(h.res, player.res);
        if (h.skipFlag && touching) return true;
        if (h.blockedState !== 0 && (near(f, 64) || near({ x: h.destX, y: h.destY }, 48))) return true;
        return touching && h.currentActions.action() !== CurrentAction.NO_ACTION && h.characterMode !== CharacterMode.CONVERSING;
      })
      .map((h) => h.hotspotId);
  }

  /**
   * Céder le passage : gagner le point du sol le plus proche qui est loin des personnages de la pièce, de là où ils vont, et des zones de
   * sortie (où arrivent ceux qui entrent), par un chemin que le moteur trouve et qui ne traverse aucune sortie. Rien si le joueur y est.
   */
  giveWay(): void {
    for (let i = 0; i < 400 && this.engine.world.requireActiveHotspot(HotspotId.PLAYER).tickProcId === TickProc.TALK; i++) this.frame();
    const player = this.engine.world.requireActiveHotspot(HotspotId.PLAYER);
    const p = this.feetOf(player);
    const others = this.charactersHere();
    // Là où chacun va : sa destination, et l'endroit d'où il fera ce qu'on lui a demandé (« Dis à Minnow : Tire le levier »).
    const goals = (h: Hotspot): Array<{ x: number; y: number }> => {
      const out = h.currentActions.isEmpty() ? [] : [{ x: h.destX, y: h.destY }];
      for (const entry of h.currentActions.entries) {
        if (entry.support?.kind !== "dynamic") continue;
        for (const id of entry.support.params) {
          const t = this.engine.world.hotspot(id);
          if (t && t.roomNumber === this.room && (t.walkX !== 0 || t.walkY !== 0)) out.push({ x: t.walkX, y: t.walkY });
        }
      }
      return out;
    };
    // Le chemin de chacun vers ses buts, en ligne droite : points tous les 8 pixels.
    const lanes = others.map((h) => {
      const f = this.feetOf(h);
      const pts = [f];
      for (const g of goals(h)) {
        const n = Math.max(1, Math.ceil(Math.max(Math.abs(g.x - f.x), Math.abs(g.y - f.y)) / 8));
        for (let i = 1; i <= n; i++) pts.push({ x: f.x + ((g.x - f.x) * i) / n, y: f.y + ((g.y - f.y) * i) / n });
      }
      return pts;
    });
    // Les points d'arrivée dans cette pièce (données des sorties des pièces voisines : coin haut gauche du personnage qui arrive).
    const arrivals = this.engine.data.rooms
      .flatMap((r) => r.exits.filter((e) => e.roomNumber === this.room && r.roomNumber !== this.room))
      .map((e) => ({ x: e.x + 16, y: e.y + 48 }));
    const clear = (x: number, y: number): boolean =>
      lanes.every((pts) => pts.every((q, i) => Math.abs(q.x - x) > (i === 0 ? 56 : 40) || Math.abs(q.y - y) > (i === 0 ? 28 : 20))) &&
      arrivals.every((q) => Math.abs(q.x - x) > 48 || Math.abs(q.y - y) > 24) &&
      !this.nearExit(x, y);
    if (clear(p.x, p.y)) return;
    const points: Array<{ x: number; y: number }> = [];
    for (let y = 16; y <= 196; y += 4) for (let x = 16; x <= 304; x += 8) if (clear(x, y)) points.push({ x, y });
    // Le plus près possible, mais franchement à l'écart des passages : la distance aux points d'arrivée compte jusqu'à 96 pixels.
    const exitsHere = this.engine.data.rooms.find((r) => r.roomNumber === this.room)?.exits ?? [];
    const doors = [...arrivals, ...exitsHere.map((e) => ({ x: (e.xs + e.xe) >> 1, y: (e.ys + e.ye) >> 1 }))];
    const cost = (u: { x: number; y: number }): number =>
      Math.abs(u.x - p.x) + Math.abs(u.y - p.y) * 2 - 2 * Math.min(96, ...doors.map((q) => Math.abs(q.x - u.x) + Math.abs(q.y - u.y)));
    points.sort((u, v) => cost(u) - cost(v));
    // Coincé contre un personnage (sa place occupe le départ du chemin), le joueur ne bouge pas : il essaie un autre point.
    let rest = points;
    for (let attempt = 0; attempt < 6; attempt++) {
      // Aucun chemin trouvé depuis ici (le point d'arrivée d'une sortie est parfois hors de la grille de marche) : le point libre le plus
      // proche, le moteur y mène le joueur au mieux (chemin partiel), comme un clic de joueur.
      const spot = this.firstReachable(rest) ?? rest.find((u) => this.floorFree(u.x, u.y) && this.straightAwayFromExits(u)) ?? null;
      if (!spot) return;
      const before = { x: player.x, y: player.y };
      this.walk(spot.x, spot.y);
      if (player.x !== before.x || player.y !== before.y) return;
      rest = rest.filter((u) => Math.abs(u.x - spot.x) + Math.abs(u.y - spot.y) > 24);
      this.frameCount(10);
    }
  }

  /** Le sol de la pièce (grille de `lure.dat`, sans les personnages) est libre sous ces pieds, et un clic à cet endroit est un simple pas. */
  private floorFree(x: number, y: number): boolean {
    const paths = this.engine.data.rooms.find((r) => r.roomNumber === this.room)?.paths;
    if (!paths) return false;
    // Le personnage (32 pixels de large, pieds au milieu) couvre les blocs de x - 16 à x + 15 sur la ligne des pieds.
    const row = (y - 12) >> 3;
    for (let bx = (x - 16) >> 3; bx <= (x + 15) >> 3; bx++) if (pathOccupied(paths, bx, row)) return false;
    const room = this.engine.room;
    const saved = { x: room.mouseX, y: room.mouseY, hotspotId: room.hotspotId, dest: room.destRoomNumber };
    room.mouseX = x;
    room.mouseY = y;
    room.checkRoomHotspots();
    const plain = room.hotspotId === 0 && room.destRoomNumber === 0;
    room.mouseX = saved.x;
    room.mouseY = saved.y;
    room.hotspotId = saved.hotspotId;
    room.destRoomNumber = saved.dest;
    return plain;
  }

  /**
   * La recherche de chemin du moteur mène le joueur à ce point sans traverser de zone de sortie : sur la grille de la pièce telle qu'elle
   * est (les autres personnages y sont), sans la place du joueur lui-même (`startPath` la libère aussi).
   */
  private canReach(x: number, y: number): boolean {
    const player = this.engine.world.requireActiveHotspot(HotspotId.PLAYER);
    const paths = new Uint8Array(this.engine.world.requireRoom(this.room).paths);
    clearPathOccupied(paths, Math.max(0, player.x >> 3), (player.y - 8 + player.heightCopy - 4) >> 3, Math.max(player.widthCopy >> 3, 1));
    const pf = createPathFinder();
    resetPath(pf, paths, player.widthCopy, 0);
    const walker = { x: player.x, y: player.y, widthCopy: player.widthCopy, heightCopy: player.heightCopy, destX: x, destY: y };
    if (processPath(pf, walker, 0) !== PathResult.OK) return false;
    let fx = player.x + (player.widthCopy >> 1);
    let fy = player.y + player.heightCopy;
    type Zone = { xs: number; xe: number; ys: number; ye: number };
    const inside = (e: Zone, m: number): boolean => fx >= e.xs - m && fx <= e.xe + m && fy - 4 >= e.ys - m && fy - 4 <= e.ye + m;
    // Près d'une sortie au départ (il vient d'arriver par là) : seule la zone exacte compte pour celle-ci, 6 pixels de marge pour les autres.
    const all = this.engine.data.rooms.find((r) => r.roomNumber === this.room)?.exits ?? [];
    const margins = all.map((e) => (inside(e, 6) ? 0 : 6));
    for (const step of pf.list) {
      for (let k = 0; k < step.rawSteps; k += 2) {
        if (step.direction === Direction.LEFT) fx -= 2;
        else if (step.direction === Direction.RIGHT) fx += 2;
        else if (step.direction === Direction.UP) fy -= 2;
        else if (step.direction === Direction.DOWN) fy += 2;
        // `checkRoomChange` teste les pieds remontés de `yCorrection / 2` : marge de 6 pixels.
        if (all.some((e, i) => inside(e, margins[i]!))) return false;
      }
    }
    return true;
  }

  /** En ligne droite des pieds du joueur à ce point, on ne passe près d'aucune zone de sortie (sauf celle où il se tient). */
  private straightAwayFromExits(to: { x: number; y: number }): boolean {
    const p = this.feetOf(this.engine.world.requireActiveHotspot(HotspotId.PLAYER));
    const exits = this.engine.data.rooms.find((r) => r.roomNumber === this.room)?.exits ?? [];
    const inside = (e: { xs: number; xe: number; ys: number; ye: number }, x: number, y: number, m: number): boolean =>
      x >= e.xs - m && x <= e.xe + m && y >= e.ys - m && y <= e.ye + m;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(to.x - p.x), Math.abs(to.y - p.y)) / 4));
    for (let i = 1; i <= n; i++) {
      const x = p.x + ((to.x - p.x) * i) / n;
      const y = p.y + ((to.y - p.y) * i) / n - 4;
      if (exits.some((e) => inside(e, x, y, inside(e, p.x, p.y - 4, 16) ? 0 : 16))) return false;
    }
    return true;
  }

  /** Le premier point (dans l'ordre donné) où le joueur peut aller (`floorFree`, `canReach`) ; au plus 40 recherches de chemin. */
  private firstReachable(points: ReadonlyArray<{ x: number; y: number }>): { x: number; y: number } | null {
    let tested = 0;
    for (const pt of points) {
      if (!this.floorFree(pt.x, pt.y)) continue;
      if (this.canReach(pt.x, pt.y)) return pt;
      if (++tested >= 40) break;
    }
    return null;
  }

  // --- viser ---------------------------------------------------------------------------------------------------------------------

  /** Un point du hotspot où le pointeur le désigne vraiment (le centre, puis en spirale, puis toute la surface), sans attendre. */
  private scanPoint(id: number): { x: number; y: number } | null {
    const world = this.engine.world;
    const o = world.getHotspotOverride(id);
    let r: { xs: number; ys: number; xe: number; ye: number };
    if (o) r = { xs: o.xs, ys: o.ys, xe: o.xe, ye: o.ye };
    else {
      const h = world.requireHotspot(id);
      r = { xs: h.startX, ys: h.startY, xe: h.startX + h.widthCopy, ye: h.startY + h.height };
    }
    const xs = Math.max(1, r.xs);
    const xe = Math.min(318, r.xe);
    const ys = Math.max(9, r.ys);
    const ye = Math.min(198, r.ye);
    if (xs > xe || ys > ye) return null;
    const cx = (xs + xe) >> 1;
    const cy = (ys + ye) >> 1;
    const points: Array<[number, number]> = [[cx, cy]];
    for (let d = 2; d <= 60; d += 2) {
      for (const [dx, dy] of [[-d, 0], [d, 0], [0, -d], [0, d], [-d, -d], [d, d], [-d, d], [d, -d]] as const) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= xs && x <= xe && y >= ys && y <= ye) points.push([x, y]);
      }
    }
    for (let y = ys; y <= ye; y += 3) for (let x = xs; x <= xe; x += 3) points.push([x, y]);
    // Viser sans laisser passer le temps : le hotspot sous chaque point candidat est celui que donnerait `checkRoomHotspots` (la fonction
    // du moteur), sans image jouée ; seul le point retenu est survolé (une image). Survoler chaque candidat coûtait jusqu'à des centaines
    // d'images, que le monde passait à vivre (le vin du château s'écoulait pendant que le joueur « cherchait » Minnow).
    const room = this.engine.room;
    const saved = { x: room.mouseX, y: room.mouseY, hotspotId: room.hotspotId, dest: room.destRoomNumber };
    let found: { x: number; y: number } | null = null;
    for (const [x, y] of points) {
      room.mouseX = x;
      room.mouseY = y;
      room.checkRoomHotspots();
      if (room.hotspotId === id) {
        found = { x, y };
        break;
      }
    }
    room.mouseX = saved.x;
    room.mouseY = saved.y;
    room.hotspotId = saved.hotspotId;
    room.destRoomNumber = saved.dest;
    if (!found) return null;
    this.d.hover(found.x, found.y);
    return this.engine.room.hotspotId === id ? found : null;
  }

  /** Comme `scanPoint`, en laissant passer des images tant que le hotspot n'est pas visible (personnage qui arrive ou bouge). */
  pointOn(id: number): { x: number; y: number } {
    for (let attempt = 0; attempt < 60; attempt++) {
      const p = this.scanPoint(id);
      if (p) return p;
      this.frame();
    }
    throw new Error(`hotspot ${id.toString(16)} : aucun point du pointeur ne le désigne (pièce ${this.room})`);
  }

  /** Un point du décor où le pointeur ne désigne rien (menu « standard ») : le milieu de l'écran, sinon le plus proche. */
  private emptyPoint(): { x: number; y: number } {
    const room = this.engine.room;
    const saved = { x: room.mouseX, y: room.mouseY, hotspotId: room.hotspotId, dest: room.destRoomNumber };
    let found = { x: 160, y: 100 };
    search: for (let d = 0; d <= 90; d += 6) {
      for (const [dx, dy] of [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d], [d, -d], [-d, d]] as const) {
        const x = 160 + dx;
        const y = 100 + dy;
        room.mouseX = x;
        room.mouseY = y;
        room.checkRoomHotspots();
        if (room.hotspotId === 0 && room.destRoomNumber === 0) {
          found = { x, y };
          break search;
        }
      }
    }
    room.mouseX = saved.x;
    room.mouseY = saved.y;
    room.hotspotId = saved.hotspotId;
    room.destRoomNumber = saved.dest;
    return found;
  }

  /** Clic droit sur le hotspot (ou sur le décor, menu « standard ») jusqu'à ce que le menu surgissant s'ouvre. */
  private openMenu(on: number | undefined, follow = false): void {
    // Une bulle de parole sous le pointeur prend le clic pour elle ; un personnage qui n'a pas encore de verbes (il n'est pas arrivé à
    // son poste) n'ouvre aucun menu : dans les deux cas on attend un peu et on recommence. Un personnage qu'on ne peut pas désigner (il
    // entre, il sort, il est caché) est rejoint de nouveau là où il est (`follow`), comme une personne qui le cherche des yeux.
    for (let attempt = 0; attempt < 12; attempt++) {
      let p: { x: number; y: number };
      try {
        p = on === undefined ? this.emptyPoint() : this.pointOn(on);
      } catch (e) {
        if (!follow || on === undefined || attempt >= 6) throw e;
        this.giveWay();
        this.meet(on);
        this.waitDetour(on);
        continue;
      }
      if (on === undefined) this.d.hover(p.x, p.y);
      this.d.click(p.x, p.y, "right");
      if (this.engine.menuView?.kind === "popup") return;
      this.settle(80);
      if (attempt >= 3) this.frameCount(40);
    }
    throw new Error(`pas de menu surgissant sur ${on === undefined ? "le décor" : on.toString(16)} (pièce ${this.room})`);
  }

  // --- se déplacer ---------------------------------------------------------------------------------------------------------------

  /** `detour` : arriver dans une autre pièce que `room` n'est pas une erreur (`goTo` recalcule le chemin). */
  exit(room: number, detour = false): void {
    this.settle(300);
    const from = this.room;
    const data = this.engine.data.rooms.find((r) => r.roomNumber === this.room)!;
    const e = data.exits.find((x) => x.roomNumber === room);
    if (!e) throw new Error(`pas de sortie de la pièce ${this.room} vers ${room}`);
    // Une zone de sortie hors de l'écran (x < 0, x > 319, y > 199) : on clique au bord le plus proche, le joueur marche jusqu'à elle.
    // Le centre de la zone (au bord de l'écran si elle en sort), ou un point de la zone où le pointeur annonce bien cette sortie (un décor
    // ou une autre sortie peut recouvrir le centre).
    const { x, y } = this.exitPoint(e, room);
    // Le joueur peut être arrêté en chemin (un personnage se met en travers) : on clique de nouveau, comme le ferait une personne. Le clic
    // sur une sortie mène les pieds au point de `exitCoordinate`, qui n'est pas toujours dans la zone de sortie : arrivé de l'autre côté
    // (pièce 28 vers 18, après un heurt), le joueur ne la traverse plus et reste planté, dans ScummVM aussi (vérifié au banc,
    // `docs/lure/engine.md` § 10). Une personne fait alors un pas de côté, de l'autre côté de la zone, puis clique de nouveau.
    const detours: Array<[number, number]> = [
      [x, e.ye + 12],
      [x, e.ys - 12],
      [e.xs - 12, y],
      [e.xe + 12, y],
    ];
    const left = (): boolean => this.room === room || (detour && this.room !== from);
    for (let attempt = 0; attempt < 8 && !left(); attempt++) {
      if (attempt > 0) {
        const [dx, dy] = detours[(attempt - 1) % detours.length]!;
        const p = { x: Math.max(1, Math.min(318, dx)), y: Math.max(9, Math.min(198, dy)) };
        this.d.hover(p.x, p.y);
        if (this.engine.room.destRoomNumber === 0 && this.engine.room.hotspotId === 0) this.walk(p.x, p.y);
        if (left()) break;
      }
      this.d.hover(x, y);
      // Une porte fermée mène à la pièce visée : on l'ouvre d'abord, comme une personne (la porte n'est pas toujours sous le centre de
      // la zone de sortie : celle du laboratoire, pièce 30, est au-dessus).
      const door = this.closedDoorTo(room);
      if (door !== null) {
        this.verb("Ouvre", door);
        this.d.hover(x, y);
      }
      this.d.click(x, y);
      let calm = 0;
      for (let i = 0; i < 1500 && !left() && calm < 12; i++) {
        this.frame();
        calm = this.quiet() ? calm + 1 : 0;
      }
      if (!left()) this.frameCount(60); // on laisse le temps au personnage qui gêne de s'écarter
    }
    if (!left()) {
      const pl = this.engine.world.requireActiveHotspot(HotspotId.PLAYER);
      throw new Error(
        `la sortie vers ${room} n'a pas été franchie (pièce ${this.room}, joueur ${pl.x},${pl.y} action ${pl.currentActions.action()} gestionnaire ${pl.tickProcId} curseur ${this.engine.room.cursorState} dialogue ${this.engine.world.talkState} sous le pointeur ${this.engine.room.hotspotId.toString(16)} sortie ${this.engine.room.destRoomNumber})`,
      );
    }
    this.settle(60);
  }

  private exitPoint(e: { xs: number; xe: number; ys: number; ye: number }, room: number): { x: number; y: number } {
    const center = { x: Math.max(0, Math.min(319, (e.xs + e.xe) >> 1)), y: Math.max(9, Math.min(199, (e.ys + e.ye) >> 1)) };
    const r = this.engine.room;
    const saved = { x: r.mouseX, y: r.mouseY, hotspotId: r.hotspotId, dest: r.destRoomNumber };
    const announces = (x: number, y: number): boolean => {
      r.mouseX = x;
      r.mouseY = y;
      r.checkRoomHotspots();
      return r.destRoomNumber === room || (r.destRoomNumber === 0 && r.hotspotId === 0);
    };
    let found = center;
    if (!announces(center.x, center.y)) {
      search: for (let yy = Math.max(9, e.ys); yy <= Math.min(199, e.ye); yy += 2) {
        for (let xx = Math.max(0, e.xs); xx <= Math.min(319, e.xe); xx += 2) {
          r.mouseX = xx;
          r.mouseY = yy;
          r.checkRoomHotspots();
          if (r.destRoomNumber === room) {
            found = { x: xx, y: yy };
            break search;
          }
        }
      }
    }
    r.mouseX = saved.x;
    r.mouseY = saved.y;
    r.hotspotId = saved.hotspotId;
    r.destRoomNumber = saved.dest;
    return found;
  }

  /** Porte fermée de la pièce courante qui mène à `room` (jonction de `0x3F0A` : ses deux hotspots, un de chaque côté). */
  private closedDoorTo(room: number): number | null {
    const world = this.engine.world;
    for (const h of world.state.hotspots) {
      if (h.hotspotId < HotspotId.START_EXIT || h.hotspotId >= 0x2800 || h.roomNumber !== this.room) continue;
      const join = world.getExitJoin(h.hotspotId);
      if (!join || !join.blocked) continue;
      if (join.hotspots.some((j) => j.hotspotId !== h.hotspotId && world.hotspot(j.hotspotId)?.roomNumber === room)) return h.hotspotId;
    }
    return null;
  }

  go(at: [number, number], room: number): void {
    for (let attempt = 0; attempt < 12 && this.room !== room; attempt++) {
      this.d.hover(at[0], at[1]);
      this.d.click(at[0], at[1]);
      this.settle();
      for (let i = 0; i < 20 && this.room !== room; i++) this.frame();
    }
    if (this.room !== room) throw new Error(`la sortie en (${at.join(",")}) n'a pas mené à la pièce ${room} (pièce ${this.room})`);
    this.settle(60);
  }

  /** Chemin le plus court entre deux pièces par les sorties (les portes fermées ne sont pas écartées : `exit` les ouvre). */
  private pathTo(target: number, avoid: readonly string[]): number[] {
    const rooms = this.engine.data.rooms;
    const prev = new Map<number, number>([[this.room, this.room]]);
    const queue = [this.room];
    while (queue.length) {
      const r = queue.shift()!;
      if (r === target) break;
      for (const e of rooms.find((x) => x.roomNumber === r)?.exits ?? []) {
        if (e.roomNumber === 0 || prev.has(e.roomNumber) || avoid.includes(`${r}>${e.roomNumber}`)) continue;
        prev.set(e.roomNumber, r);
        queue.push(e.roomNumber);
      }
    }
    if (!prev.has(target)) throw new Error(`pas de chemin de la pièce ${this.room} à ${target}`);
    const path: number[] = [];
    for (let r = target; r !== this.room; r = prev.get(r)!) path.unshift(r);
    return path;
  }

  /**
   * Va de pièce en pièce ; le chemin est recalculé après chaque sortie : en traversant une pièce, le joueur peut repasser par une autre
   * zone de sortie (dans la pièce 20, le chemin de l'arrivée depuis la 36 vers la sortie de la 13 recoupe la zone de la 36).
   */
  goTo(room: number, avoid: readonly string[] = DOORS_LOCKED): void {
    for (let hops = 0; hops < 30 && this.room !== room; hops++) this.exit(this.pathTo(room, avoid)[0]!, true);
    if (this.room !== room) throw new Error(`pièce ${room} pas atteinte (pièce ${this.room})`);
  }

  /** Rejoindre un personnage : on va là où il est (il se déplace : on recommence quelques fois). Ratpouch suit : on l'attend. */
  meet(id: number): void {
    const here = (): boolean => this.engine.world.requireHotspot(id).roomNumber === this.room;
    if (here()) return;
    if (id === HotspotId.RATPOUCH) {
      this.until(here, "Ratpouch rejoint le joueur", 900);
      this.settle(60);
      return;
    }
    for (let i = 0; i < 6 && !here(); i++) {
      this.goTo(this.engine.world.requireHotspot(id).roomNumber);
      this.settle(60);
    }
  }

  /**
   * Clic sur le sol, puis attendre le repos. Pendant une conversation (le joueur a le gestionnaire de dialogue) le clic serait avalé :
   * on attend d'abord qu'elle se termine, comme une personne.
   */
  walk(x: number, y: number): void {
    const player = this.engine.world.requireActiveHotspot(HotspotId.PLAYER);
    for (let i = 0; i < 400 && player.tickProcId === TickProc.TALK; i++) this.frame();
    this.d.hover(x, y);
    this.d.click(x, y);
    this.settle();
  }

  stand(at: [number, number]): void {
    const player = this.engine.world.requireActiveHotspot(HotspotId.PLAYER);
    for (let attempt = 0; attempt < 12; attempt++) {
      this.walk(at[0], at[1]);
      if (Math.abs(player.x + (player.widthCopy >> 1) - at[0]) <= 20 && Math.abs(player.y + player.heightCopy - at[1]) <= 20) return;
    }
    throw new Error(`le joueur n'a pas rejoint (${at.join(",")}) : il est en (${player.x},${player.y})`);
  }

  // --- agir ----------------------------------------------------------------------------------------------------------------------

  verb(verb: string, on: number | undefined, withItem?: string, here = false): void {
    this.settle(200);
    if (on !== undefined && on < HotspotId.START_EXIT) {
      if (!here) this.meet(on);
      else if (this.engine.world.requireHotspot(on).roomNumber !== this.room) throw new Error(`${on.toString(16)} n'est pas dans la pièce ${this.room}`);
      this.waitDetour(on);
    }
    this.openMenu(on, on !== undefined && on < HotspotId.START_EXIT && !here);
    this.d.choose(verb);
    if (withItem !== undefined) this.d.choose(withItem);
    this.settle();
  }

  look(id: number): void {
    this.settle(200);
    const p = this.pointOn(id);
    this.d.click(p.x, p.y);
    this.settle();
  }

  /**
   * Un personnage qui fait un détour (sa recherche de chemin a échoué : il s'écarte avant de reprendre sa route, `blockedFlag`) n'est pas
   * interpellé : on attend qu'il ait repris son chemin (au plus 300 images), en lui cédant le passage s'il le faut. Lui parler pendant le
   * détour remplace le détour par la réponse sans effacer `blockedFlag` (`Script::setSupportData`, ScummVM comme le portage) : au
   * blocage suivant, l'emploi du temps « retour » écrase la réponse (Minnow ne va plus prévenir le Skorl).
   */
  private waitDetour(id: number): void {
    for (let i = 0; i < 300; i++) {
      const h = this.engine.world.getActiveHotspot(id);
      if (!h || h.roomNumber !== this.room || !h.blockedFlag) return;
      if (this.quiet() && this.hindered().includes(id)) this.giveWay();
      else this.frame();
    }
  }

  /** « Dis à » : compose la commande par les menus (verbe, objet, « et puis » ou « Fin »), puis laisse le personnage l'exécuter. */
  tell(who: number, orders: readonly TellOrder[]): void {
    this.settle(200);
    this.meet(who);
    this.waitDetour(who);
    // Le menu des objets ne propose que ce que le joueur a déjà vu (survolé) : on survole les objets visés.
    for (const order of orders) if (order.seen !== undefined) this.pointOn(order.seen);
    const ui = this.engine.data.uiStrings;
    const andThen = gameTextToUnicode(ui[UiString.AND_THEN]!);
    const finish = gameTextToUnicode(ui[UiString.FINISH]!);
    this.openMenu(who, true);
    this.d.choose("Dis à");
    orders.forEach((order, i) => {
      this.d.choose(order.verb);
      if (order.object !== undefined) this.d.choose(order.object);
      // Au huitième ordre la commande se termine d'elle-même : plus de menu.
      if (this.engine.menuView?.kind === "popup") this.d.choose(i === orders.length - 1 ? finish : andThen);
    });
    this.settle();
  }

  /** Dialogue en cours : choisit les options dans l'ordre (fragments de texte), la première ligne quand la liste est épuisée. */
  talk(picks: readonly string[]): void {
    this.settle();
    let index = 0;
    for (let guard = 0; guard < 200; guard++) {
      if (this.engine.world.talkState === TalkState.SELECT) {
        const lines = talkSelectView(this.engine)!.lines.map((l) => gameTextToUnicode(l));
        const wanted = picks[index++];
        this.log.dialogs.push(`[choix : ${lines.join(" | ")}]`);
        const pick = wanted === undefined ? 0 : lines.findIndex((l) => l.includes(wanted));
        if (pick < 0) throw new Error(`option « ${wanted} » absente : ${lines.join(" | ")}`);
        this.d.click(10, (pick + 1) * 8 + 2);
      }
      this.settle(400);
      if (this.engine.world.talkState === TalkState.NONE && this.quiet()) return;
    }
    throw new Error("le dialogue ne finit pas");
  }

  /**
   * Combat en cours, joué comme une personne qui voit partir les coups (écrit par l'agent des grottes, 30 victoires sur 30 contre le cochon,
   * graines 1 à 30, contre ~16 à l'aveugle) ; rend le nombre d'images. Ce que disent les données de combat (`0x3F16`) :
   * - les coups de l'adversaire (séquences 6, 7, 8, 10, 11) sont arrêtés par la garde du joueur à l'instant du coup : 7 et 10 par un coup
   *   ou une garde en haut, 6 au milieu, 8 et 11 par une garde au milieu ou en bas : on répond par le coup (ou la garde) qui l'arrête ;
   * - sinon on marche vers lui, puis on frappe à une hauteur qu'il ne garde pas (haut : 1 ou 4, milieu : 2 ou 5, bas : 3).
   */
  fight(foe: number): number {
    const fights = this.engine.fights as FightsManager;
    if (!fights.isFighting) throw new Error("aucun combat en cours");
    let t = 0;
    for (; t < 5000 && fights.isFighting; t++) {
      if (this.engine.busy || this.engine.dialogText !== null) {
        if (this.engine.dialogText !== null) this.log.dialogs.push(this.d.dialog()!);
        this.d.click(160, 100);
        continue;
      }
      this.host.push({ type: "actionEnd", action: "fightMoveLeft" });
      this.host.push({ type: "action", action: this.fightAction(fights, foe, t) });
      this.engine.tick();
    }
    if (fights.isFighting) throw new Error("le combat ne finit pas");
    this.frames += t;
    return t;
  }

  private fightAction(fights: FightsManager, foe: number, t: number): (typeof FIGHT_HEIGHTS)[number] | "fightCursorRightMiddle" | "fightMoveLeft" {
    const player = fights.record(HotspotId.PLAYER);
    const enemy = fights.record(foe);
    const dist = Math.abs(player.fwtrue_x - enemy.fwtrue_x);
    const seq = enemy.fwseq_no;
    if (dist <= 40) {
      if (seq === 7 || seq === 10) return FIGHT_HEIGHTS[0];
      if (seq === 6) return FIGHT_HEIGHTS[1];
      if (seq === 8 || seq === 11) return "fightCursorRightMiddle";
    }
    if (dist > 32) return "fightMoveLeft";
    const guard = enemy.fwblocking;
    const open = [guard !== 1 && guard !== 4, guard !== 5 && guard !== 2, guard !== 3];
    for (let k = 0; k < 3; k++) {
      const height = (Math.floor(t / 4) + k) % 3;
      if (open[height]) return FIGHT_HEIGHTS[height]!;
    }
    return FIGHT_HEIGHTS[0];
  }

  /** Rejoue `steps` jusqu'à la condition ; une étape qui lève (le personnage est parti) compte comme un essai manqué. */
  repeat(steps: readonly Step[], test: Until, what: string, times = 3, optional = false): void {
    let last = "";
    for (let k = 0; k < times && !test(this.engine, this.host); k++) {
      const before = this.log.steps;
      try {
        this.run(steps);
      } catch (e) {
        last = ` ; dernier essai : ${(e as Error).message}`;
      }
      this.log.steps = before;
      this.settle(100);
    }
    if (!optional && !test(this.engine, this.host)) throw new Error(`${times} essais sans effet : ${what} (pièce ${this.room})${last}`);
  }

  skipUntil(test: Until, what: string, max = 4000): void {
    for (let i = 0; i < max && !test(this.engine, this.host); i++) {
      if (this.engine.busy) this.d.click(5, 5);
      else this.engine.tick();
      this.host.clock += 80;
      this.frames++;
    }
    if (!test(this.engine, this.host)) throw new Error(`attente sans fin : ${what}`);
  }

  // --- jouer une solution --------------------------------------------------------------------------------------------------------

  run(steps: readonly Step[], onStep?: (index: number, step: Step) => void): void {
    steps.forEach((s, i) => {
      onStep?.(i, s);
      if ("repeat" in s) this.repeat(s.repeat, s.until, s.what, s.times, s.optional);
      else if ("exit" in s) this.exit(s.exit);
      else if ("go" in s) this.go(s.go, s.room);
      else if ("goto" in s) this.goTo(s.goto, s.avoid ?? DOORS_LOCKED);
      else if ("walk" in s) this.walk(s.walk[0], s.walk[1]);
      else if ("stand" in s) this.stand(s.stand);
      else if ("verb" in s) this.verb(s.verb, s.on, s.with, s.here);
      else if ("look" in s) this.look(s.look);
      else if ("talk" in s) this.talk(s.talk);
      else if ("tell" in s) this.tell(s.tell, s.orders);
      else if ("until" in s) this.until(s.until, s.what, s.max, s.stay);
      else if ("wait" in s) this.frameCount(s.wait);
      else if ("giveWay" in s) this.giveWay();
      else if ("fight" in s) this.fight(s.fight);
      else this.skipUntil(s.skipUntil, s.what, s.max);
      this.log.steps++;
    });
  }
}
