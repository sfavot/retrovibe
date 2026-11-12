import { FakeStorage } from "../../support/fake-host";
import type { LureData } from "../../../src/games/lure/data/lure-data";
import type { LureContext } from "../../../src/games/lure/engine/context";
import { LureEngine, type LureEngineOptions } from "../../../src/games/lure/engine/game";
import type { Hotspot } from "../../../src/games/lure/engine/hotspot";
import { type LureAction, type LureHost, type LureInput, MouseButton } from "../../../src/games/lure/engine/host";
import { CurrentAction } from "../../../src/games/lure/engine/ids";
import type { Movement } from "../../../src/games/lure/engine/services";
import { checkRoomChange } from "../../../src/games/lure/engine/support";
import { gameTextToUnicode } from "../../../src/games/lure/data/charset";
import { lureData } from "../data/catalog-helper";

export { hasOriginalFiles } from "../data/helpers";

/** Hôte de test : entrées en file, journal gardé, sortie comptée. */
export class TestHost implements LureHost {
  readonly storage = new FakeStorage();
  clock = 0;
  exits = 0;
  readonly logs: string[] = [];
  readonly saveDialogs: boolean[] = [];
  private queue: LureInput[] = [];

  now(): number {
    return this.clock;
  }

  exit(): void {
    this.exits++;
  }

  log(message: string): void {
    this.logs.push(message);
  }

  openSaveDialog(save: boolean): void {
    this.saveDialogs.push(save);
  }

  push(...inputs: LureInput[]): void {
    this.queue.push(...inputs);
  }

  pollInput(): readonly LureInput[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }
}

/**
 * Téléportation **de test** : le personnage arrive à sa destination au premier tick de marche, comme si la marche avait abouti
 * (`setAction(DISPATCH_ACTION)` à la fin du chemin), puis la sortie éventuelle est prise. Pour les tests qui ne portent pas sur la
 * marche ; la marche réelle est `LureMovement` (par défaut).
 */
export class TeleportMovement implements Movement {
  readonly pathfindCountdown = 0;
  readonly walks: Array<{ id: number; x: number; y: number }> = [];

  constructor(private readonly ctx: LureContext) {}

  walkPlayer(h: Hotspot): void {
    this.teleport(h);
  }

  walkCharacter(h: Hotspot): void {
    this.teleport(h);
  }

  private teleport(h: Hotspot): void {
    const actions = h.currentActions;
    if (actions.action() === CurrentAction.START_WALKING) {
      actions.pop();
      actions.addFront(CurrentAction.PROCESSING_PATH, h.roomNumber);
    }
    this.walks.push({ id: h.hotspotId, x: h.destX, y: h.destY });
    // Le pied du personnage (`y + heightCopy`) arrive sur la destination.
    h.setPosition(h.destX, h.destY - h.heightCopy);
    actions.top().action = CurrentAction.DISPATCH_ACTION;
    checkRoomChange(this.ctx, h);
  }

  clearPath(): void {}
}

/** Moteur sur les vrais fichiers (marche réelle par défaut ; `movement` pour la téléportation de test). */
export function makeEngine(options: Partial<LureEngineOptions> = {}): { engine: LureEngine; host: TestHost; data: LureData } {
  const host = new TestHost();
  const data = lureData();
  const engine = new LureEngine({ data, host, ...options });
  return { engine, host, data };
}

/** Pilote : clics et ticks. */
export class Driver {
  constructor(
    readonly engine: LureEngine,
    readonly host: TestHost,
  ) {}

  ticks(n: number): void {
    for (let i = 0; i < n; i++) this.engine.tick();
  }

  /** Place le pointeur (un tick, pour que le curseur et le hotspot sous le pointeur soient à jour). */
  hover(x: number, y: number): void {
    this.host.push({ type: "pointer", x, y, buttons: 0 });
    this.engine.tick();
  }

  click(x: number, y: number, button: "left" | "right" = "left"): void {
    const b = button === "left" ? MouseButton.Left : MouseButton.Right;
    this.host.push({ type: "pointer", x, y, buttons: b }, { type: "pointer", x, y, buttons: 0 });
    this.engine.tick();
  }

  action(action: LureAction): void {
    this.host.push({ type: "action", action });
    this.engine.tick();
  }

  /** Choisit l'entrée de texte `label` (Unicode) dans le menu surgissant ouvert. */
  choose(label: string): void {
    const view = this.engine.menuView;
    if (!view || view.kind !== "popup") throw new Error("aucun menu surgissant ouvert");
    const index = view.entries.findIndex((e) => gameTextToUnicode(e) === label);
    if (index < 0) throw new Error(`« ${label} » absent du menu : ${view.entries.map(gameTextToUnicode).join(", ")}`);
    this.click(view.x + 14, view.y + 12 + index * 8 + 2);
  }

  /** Choisit l'entrée de rang `index` du menu surgissant ouvert. */
  chooseIndex(index: number): void {
    const view = this.engine.menuView;
    if (!view || view.kind !== "popup") throw new Error("aucun menu surgissant ouvert");
    this.click(view.x + 14, view.y + 12 + index * 8 + 2);
  }

  /** Entrées du menu surgissant ouvert, en Unicode. */
  popupEntries(): string[] {
    const view = this.engine.menuView;
    return view && view.kind === "popup" ? view.entries.map(gameTextToUnicode) : [];
  }

  /** Texte de la boîte affichée (Unicode), ou `null`. */
  dialog(): string | null {
    return this.engine.dialogText === null ? null : gameTextToUnicode(this.engine.dialogText);
  }

  /** Ferme la boîte affichée (clic) et rend son texte. */
  dismiss(): string {
    const text = this.dialog();
    if (text === null) throw new Error("aucune boîte affichée");
    this.click(160, 100);
    return text;
  }

  /** Avance jusqu'à ce qu'une boîte s'affiche (au plus `max` ticks) et rend son texte. */
  untilDialog(max = 200): string {
    for (let i = 0; i < max && this.engine.dialogText === null; i++) this.engine.tick();
    const text = this.dialog();
    if (text === null) throw new Error("aucune boîte affichée");
    return text;
  }

  statusLine(): string {
    return gameTextToUnicode(this.engine.room.statusLine);
  }

  /** Centre du rectangle cliquable d'un hotspot de la pièce (surcharge `0x3F08` ou position). */
  centerOf(hotspotId: number): { x: number; y: number } {
    const world = this.engine.world;
    const o = world.getHotspotOverride(hotspotId);
    if (o) return { x: (o.xs + o.xe) >> 1, y: (o.ys + o.ye) >> 1 };
    const h = world.requireHotspot(hotspotId);
    return { x: h.startX + (h.widthCopy >> 1), y: h.startY + (h.height >> 1) };
  }
}
