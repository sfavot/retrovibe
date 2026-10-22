import type { Palette } from "../data/palette";
import { TILE_SIZE } from "../data/types";
import { type Game, GameEvent, MAX_HEALTH } from "../engine/game";
import { tileCanvas } from "../render/zone-renderer";
import { copy } from "../copy";
import { h } from "../../../ui/dom";

export interface SidebarActions {
  onMap(): void;
  onPause(): void;
  onNewGame(): void;
  onToggleSound(): void;
  onToggleMusic(): void;
  onHelp(): void;
  onCycleSpeed(): void;
  /** Début d'un glisser-déposer d'objet depuis l'inventaire. */
  onItemPointerDown(tile: number, event: PointerEvent): void;
  onItemUseOnHero(tile: number): void;
}

/** Panneau latéral : santé, arme, inventaire et commandes. */
export class Sidebar {
  readonly element: HTMLElement;
  private readonly healthBar: HTMLElement;
  private readonly healthMeter: HTMLElement;
  private readonly weaponSlot: HTMLElement;
  private readonly list: HTMLElement;
  readonly pauseButton: HTMLButtonElement;
  readonly soundButton: HTMLButtonElement;
  readonly musicButton: HTMLButtonElement;
  readonly mapButton: HTMLButtonElement;
  readonly speedButton: HTMLButtonElement;
  private game: Game | null = null;
  selected: number | null = null;

  constructor(
    private readonly palette: Palette,
    private readonly actions: SidebarActions,
  ) {
    this.healthBar = h("div", { class: "health-fill" });
    this.healthMeter = h(
      "div",
      { class: "health", role: "meter", "aria-label": copy.health, "aria-valuemin": 0, "aria-valuemax": MAX_HEALTH },
      this.healthBar,
    );
    this.weaponSlot = h("div", { class: "weapon-slot" });
    this.list = h("ul", { class: "inventory", "aria-label": copy.inventory });
    this.mapButton = h("button", { type: "button", onclick: () => actions.onMap() }, copy.map);
    this.pauseButton = h("button", { type: "button", onclick: () => actions.onPause() }, copy.pause);
    this.soundButton = h("button", { type: "button", class: "toggle", "aria-pressed": "true", onclick: () => actions.onToggleSound() }, copy.sound);
    this.musicButton = h("button", { type: "button", class: "toggle", "aria-pressed": "true", onclick: () => actions.onToggleMusic() }, copy.music);
    this.speedButton = h("button", { type: "button", onclick: () => actions.onCycleSpeed() });
    this.element = h(
      "aside",
      { class: "sidebar" },
      h("section", { class: "status" },
        h("div", { class: "status-row" }, h("span", { class: "label" }, copy.health), this.healthMeter),
        h("div", { class: "status-row" }, h("span", { class: "label" }, copy.weapon), this.weaponSlot),
      ),
      h("section", { class: "inventory-panel" }, h("h2", { class: "label" }, copy.inventory), this.list),
      h(
        "nav",
        { class: "commands" },
        this.mapButton,
        this.pauseButton,
        this.soundButton,
        this.musicButton,
        this.speedButton,
        h("button", { type: "button", onclick: () => actions.onHelp() }, copy.help),
        h("button", { type: "button", class: "secondary", onclick: () => actions.onNewGame() }, copy.newGame),
      ),
    );
  }

  /** Affiche la vitesse courante sur le bouton de réglage ; ses changements ultérieurs sont annoncés (zone live). */
  setSpeed(ms: number): void {
    const label = copy.speedButton(copy.speeds[ms] ?? String(ms));
    if (this.speedButton.textContent === label) return;
    const first = !this.speedButton.textContent;
    this.speedButton.textContent = label;
    // Activée après le premier libellé, pour ne rien annoncer à l'affichage initial.
    if (first) this.speedButton.setAttribute("aria-live", "polite");
  }

  attach(game: Game): void {
    this.game = game;
    this.selected = null;
    const refreshAll = () => {
      this.renderHealth();
      this.renderWeapon();
      this.renderInventory();
    };
    game.addEventListener(GameEvent.Health, () => this.renderHealth());
    game.addEventListener(GameEvent.Weapon, () => {
      this.renderWeapon();
      this.renderInventory();
    });
    game.addEventListener(GameEvent.Inventory, () => this.renderInventory());
    refreshAll();
  }

  private renderHealth(): void {
    const game = this.game;
    if (!game) return;
    const ratio = game.hero.health / MAX_HEALTH;
    this.healthBar.style.width = `${Math.round(ratio * 100)}%`;
    this.healthBar.dataset.level = ratio > 0.6 ? "good" : ratio > 0.3 ? "warn" : "bad";
    this.healthMeter.setAttribute("aria-valuenow", String(game.hero.health));
  }

  private renderWeapon(): void {
    const game = this.game;
    if (!game) return;
    const weapon = game.weapon;
    const tile = weapon ? game.weaponTile(weapon) : -1;
    if (tile < 0) {
      this.weaponSlot.replaceChildren(h("span", { class: "muted" }, copy.noWeapon));
      return;
    }
    this.weaponSlot.replaceChildren(
      tileCanvas(game.assets.tile(tile), this.palette, TILE_SIZE),
      h("span", {}, game.assets.tileName(tile)),
    );
  }

  renderInventory(): void {
    const game = this.game;
    if (!game) return;
    if (this.selected !== null && !game.inventory.includes(this.selected)) this.selected = null;
    if (!game.inventory.length) {
      this.list.replaceChildren(h("li", { class: "muted empty" }, copy.emptyInventory));
      return;
    }
    const equipped = game.weapon ? game.weaponTile(game.weapon) : -1;
    this.list.replaceChildren(
      ...game.inventory.map((tile, index) => {
        const item = h(
          "li",
          {
            class: `item${this.selected === tile ? " selected" : ""}${tile === equipped ? " equipped" : ""}`,
            role: "button",
            tabindex: "0",
            "aria-pressed": this.selected === tile ? "true" : "false",
            "data-index": index,
          },
          tileCanvas(game.assets.tile(tile), this.palette, TILE_SIZE),
          h("span", { class: "item-name" }, game.assets.tileName(tile)),
        );
        item.addEventListener("click", () => this.select(tile));
        item.addEventListener("dblclick", () => this.actions.onItemUseOnHero(tile));
        item.addEventListener("keydown", (e) => {
          if (e.key === "Enter") this.actions.onItemUseOnHero(tile);
          if (e.key === " ") {
            e.preventDefault();
            this.select(tile);
          }
        });
        item.addEventListener("pointerdown", (e) => this.actions.onItemPointerDown(tile, e));
        return item;
      }),
    );
  }

  select(tile: number | null): void {
    this.selected = this.selected === tile ? null : tile;
    this.renderInventory();
  }

  setPaused(paused: boolean): void {
    this.pauseButton.textContent = paused ? copy.resume : copy.pause;
    this.pauseButton.setAttribute("aria-pressed", String(paused));
  }
}
