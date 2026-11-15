import type { Palette } from "../../engine/desktop-adventures/data/palette";
import { TILE_SIZE } from "../../engine/desktop-adventures/data/types";
import type { Icon } from "../../engine/desktop-adventures/data/resources";
import { type Game, GameEvent, MAX_HEALTH } from "../../engine/desktop-adventures/game";
import { Direction } from "../../engine/desktop-adventures/geometry";
import { tileCanvas } from "../../engine/desktop-adventures/render/zone-renderer";
import type { DesktopCopy } from "./definition";
import { h } from "../dom";
import { type CompassIcons, describeExits, drawCompass } from "./compass";
import { healthGradient, healthPie } from "./health-pie";

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

/**
 * Panneau latéral, au style de la fenêtre d'origine (gris Windows 3D) : liste d'inventaire (une ligne = case icône + case nom,
 * lignes vides dessinées jusqu'en bas) puis la rangée boussole | case d'arme | moniteur de santé. Les commandes (`commands`) sont
 * un bloc à part, posé sous la fenêtre sur ordinateur.
 */
export class Sidebar {
  /** Le panneau d'origine (inventaire, boussole, arme, santé). */
  readonly element: HTMLElement;
  /** Boutons de commande, affichés sur ordinateur seulement. */
  readonly commands: HTMLElement;
  private readonly compass: HTMLCanvasElement;
  private readonly compassBox: HTMLElement;
  private readonly healthMeter: HTMLElement;
  private readonly weaponSlot: HTMLButtonElement;
  /** Jauge de munitions (Yoda), masquée pour une arme illimitée. */
  private readonly ammoMeter: HTMLElement;
  private readonly list: HTMLElement;
  readonly pauseButton: HTMLButtonElement;
  readonly soundButton: HTMLButtonElement;
  readonly musicButton: HTMLButtonElement;
  readonly mapButton: HTMLButtonElement;
  readonly speedButton: HTMLButtonElement;
  private game: Game | null = null;
  private blanks: HTMLElement[] = [];
  selected: number | null = null;

  constructor(
    private readonly palette: Palette,
    private readonly icons: Map<number, Icon>,
    private readonly compassIcons: CompassIcons,
    private readonly copy: DesktopCopy,
    private readonly actions: SidebarActions,
  ) {
    this.healthMeter = h("div", {
      class: "health",
      role: "meter",
      "aria-label": copy.health,
      "aria-valuemin": 0,
      "aria-valuemax": MAX_HEALTH,
    });
    // Comme dans l'original : une arme sélectionnée dans la liste, puis un clic sur la case d'arme, l'équipe (même chemin que le double-clic sur Indy).
    this.weaponSlot = h("button", { type: "button", class: "weapon-slot", "aria-label": copy.weapon });
    this.weaponSlot.addEventListener("click", () => this.equipSelected());
    this.ammoMeter = h("div", { class: "ammo", role: "meter", "aria-label": copy.ammo ?? "", "aria-valuemin": 0, hidden: true });
    this.compass = h("canvas", { class: "compass-canvas", "aria-hidden": "true" });
    this.compassBox = h("div", { class: "compass", role: "img" }, this.compass);
    this.list = h("ul", { class: "inventory", "aria-label": copy.inventory });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => this.fillBlanks()).observe(this.list);
    this.mapButton = h("button", { type: "button", onclick: () => actions.onMap() }, copy.map);
    this.pauseButton = h("button", { type: "button", onclick: () => actions.onPause() }, copy.pause);
    this.soundButton = h("button", { type: "button", class: "toggle", "aria-pressed": "true", onclick: () => actions.onToggleSound() }, copy.sound);
    this.musicButton = h("button", { type: "button", class: "toggle", "aria-pressed": "true", onclick: () => actions.onToggleMusic() }, copy.music);
    this.speedButton = h("button", { type: "button", onclick: () => actions.onCycleSpeed() });
    this.element = h(
      "aside",
      { class: "sidebar" },
      h(
        "div",
        { class: "retro-panel" },
        h("div", { class: "inventory-frame" }, this.list),
        h("div", { class: "status-row" }, this.compassBox, h("div", { class: "weapon-box" }, this.ammoMeter, this.weaponSlot), this.healthMeter),
      ),
    );
    this.commands = h(
      "nav",
      { class: "commands desktop-only" },
      this.mapButton,
      this.pauseButton,
      this.soundButton,
      this.musicButton,
      this.speedButton,
      h("button", { type: "button", onclick: () => actions.onHelp() }, copy.help),
      h("button", { type: "button", class: "secondary", onclick: () => actions.onNewGame() }, copy.newGame),
    );
    this.renderCompass();
  }

  /** Ajoute une commande après le réglage de vitesse (« Plein écran », qui vise toute la page du jeu). */
  addCommand(button: HTMLButtonElement): void {
    this.speedButton.after(button);
  }

  /** Affiche la vitesse courante sur le bouton de réglage ; ses changements ultérieurs sont annoncés (zone live). */
  setSpeed(ms: number): void {
    const label = this.copy.speedButton(this.copy.speeds[ms] ?? String(ms));
    if (this.speedButton.textContent === label) return;
    const first = !this.speedButton.textContent;
    this.speedButton.textContent = label;
    // Activée après le premier libellé, pour ne rien annoncer à l'affichage initial.
    if (first) this.speedButton.setAttribute("aria-live", "polite");
  }

  attach(game: Game): void {
    this.game = game;
    this.selected = null;
    game.addEventListener(GameEvent.Health, () => this.renderHealth());
    game.addEventListener(GameEvent.Zone, () => this.renderCompass());
    game.addEventListener(GameEvent.Weapon, () => this.renderWeapon());
    game.addEventListener(GameEvent.Inventory, () => this.renderInventory());
    this.renderHealth();
    // La boussole se dessine à l'événement Zone, émis dès que la partie pose Indy dans sa première zone (la zone n'existe pas encore ici).
    this.renderWeapon();
    this.renderInventory();
  }

  private renderHealth(): void {
    const game = this.game;
    if (!game) return;
    this.healthMeter.style.background = healthGradient(healthPie(game.hero.health));
    this.healthMeter.setAttribute("aria-valuenow", String(game.hero.health));
    this.healthMeter.setAttribute("aria-valuetext", this.copy.healthPercent(Math.round((100 * game.hero.health) / MAX_HEALTH)));
  }

  /** Flèches allumées dans les directions où la carte du monde a un secteur voisin ; indicateur seulement. */
  private renderCompass(): void {
    const exits = this.game?.exits ?? { [Direction.Up]: false, [Direction.Down]: false, [Direction.Left]: false, [Direction.Right]: false };
    drawCompass(this.compass, this.icons, this.compassIcons, exits);
    const d = this.copy.directions;
    const open = describeExits(exits, { [Direction.Up]: d.up, [Direction.Down]: d.down, [Direction.Left]: d.left, [Direction.Right]: d.right }, "");
    this.compassBox.setAttribute("aria-label", open ? this.copy.compassOpen(open) : this.copy.compassClosed);
  }

  private renderWeapon(): void {
    const game = this.game;
    if (!game) return;
    this.renderAmmo(game);
    const weapon = game.weapon;
    const tile = weapon ? game.weaponTile(weapon) : -1;
    if (tile < 0) {
      this.weaponSlot.replaceChildren();
      this.weaponSlot.setAttribute("aria-label", `${this.copy.weapon} : ${this.copy.noWeapon}`);
      this.weaponSlot.removeAttribute("title");
      return;
    }
    const name = game.assets.tileName(tile);
    this.weaponSlot.replaceChildren(this.tileIcon(game, tile));
    this.weaponSlot.setAttribute("aria-label", `${this.copy.weapon} : ${name}`);
    this.weaponSlot.title = name;
  }

  /** Jauge de munitions : part restante de l'arme pleine, masquée si les munitions sont illimitées. */
  private renderAmmo(game: Game): void {
    const max = game.weapon ? game.maxAmmo(game.weapon) : -1;
    const visible = max > 0 && game.ammo >= 0;
    this.ammoMeter.hidden = !visible;
    if (!visible) return;
    this.ammoMeter.style.setProperty("--ammo", String(game.ammo / max));
    this.ammoMeter.setAttribute("aria-valuemax", String(max));
    this.ammoMeter.setAttribute("aria-valuenow", String(game.ammo));
  }

  /** Icône de tuile à la taille de sa case (la feuille de style la règle : pas de taille en ligne). */
  private tileIcon(game: Game, tile: number): HTMLCanvasElement {
    const canvas = tileCanvas(game.assets.tile(tile), this.palette, TILE_SIZE);
    canvas.style.removeProperty("width");
    canvas.style.removeProperty("height");
    return canvas;
  }

  renderInventory(): void {
    const game = this.game;
    if (!game) return;
    if (this.selected !== null && !game.inventory.includes(this.selected)) this.selected = null;
    this.blanks = [];
    this.list.replaceChildren(
      ...game.inventory.map((tile, index) => {
        const item = h(
          "li",
          {
            class: `item${this.selected === tile ? " selected" : ""}`,
            role: "button",
            tabindex: "0",
            "aria-pressed": this.selected === tile ? "true" : "false",
            "data-index": index,
          },
          h("span", { class: "item-icon" }, this.tileIcon(game, tile)),
          h("span", { class: "item-name" }, h("span", { class: "item-text" }, game.assets.tileName(tile))),
        );
        item.title = game.assets.tileName(tile);
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
    this.fillBlanks();
  }

  /** Dessine des lignes vides jusqu'en bas de la liste (celles en trop se compriment à zéro : pas d'ascenseur inutile). */
  private fillBlanks(): void {
    const game = this.game;
    if (!game) return;
    const row = this.rowHeight();
    const height = this.list.clientHeight;
    const wanted = row > 0 ? Math.max(0, Math.ceil(height / row) - game.inventory.length) : 0;
    while (this.blanks.length > wanted) this.blanks.pop()!.remove();
    while (this.blanks.length < wanted) {
      const blank = h("li", { class: "item blank", "aria-hidden": "true" }, h("span", { class: "item-icon" }), h("span", { class: "item-name" }));
      this.blanks.push(blank);
      this.list.append(blank);
    }
  }

  /**
   * Hauteur d'une ligne de la liste : celle d'un objet affiché, ou, inventaire vide, celle d'une ligne témoin posée le temps de la
   * mesure (une ligne vide ne convient pas : elle se comprime).
   */
  private rowHeight(): number {
    const shown = this.list.querySelector(".item:not(.blank)");
    if (shown) return shown.getBoundingClientRect().height;
    const probe = h("li", { class: "item", "aria-hidden": "true" });
    this.list.prepend(probe);
    const height = probe.getBoundingClientRect().height;
    probe.remove();
    return height;
  }

  /** Case d'arme : équipe l'objet sélectionné s'il s'agit d'une arme ; sans arme sélectionnée, ne fait rien. */
  private equipSelected(): void {
    const game = this.game;
    if (!game || this.selected === null || !game.assets.weaponForTile(this.selected)) return;
    this.actions.onItemUseOnHero(this.selected);
  }

  select(tile: number | null): void {
    this.selected = this.selected === tile ? null : tile;
    this.renderInventory();
  }

  setPaused(paused: boolean): void {
    this.pauseButton.textContent = paused ? this.copy.resume : this.copy.pause;
    this.pauseButton.setAttribute("aria-pressed", String(paused));
  }
}
