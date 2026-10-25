import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodePng } from "../../scripts/lib/png.mjs";
import { ArmaethEngine, type ArmaethEngineOptions } from "../../src/games/armaeth/engine/engine";
import type { GameObject } from "../../src/games/armaeth/engine/state";
import { TestHost } from "./test-host";

/** Dossier des images PNG de contrôle visuel (variable `ARMAETH_PNG_DIR`) ; aucune image n'est écrite sans elle. */
const PNG_DIR = process.env.ARMAETH_PNG_DIR;

/** Écrit la dernière image présentée en PNG dans `ARMAETH_PNG_DIR`. */
export function snapshot(host: TestHost, name: string, scale = 2): void {
  if (!PNG_DIR || !host.lastFrame) return;
  mkdirSync(PNG_DIR, { recursive: true });
  const { pixels, palette } = host.lastFrame;
  const out = new Uint8Array(320 * scale * 200 * scale);
  for (let y = 0; y < 200 * scale; y++) for (let x = 0; x < 320 * scale; x++) out[y * 320 * scale + x] = pixels[Math.floor(y / scale) * 320 + Math.floor(x / scale)];
  writeFileSync(join(PNG_DIR, `${name}.png`), encodePng(320 * scale, 200 * scale, { indexed: out, palette }));
}

/**
 * Un joueur devant le moteur complet (modules de jeu enregistrés par défaut) : il saute l'introduction à coups de clics, tape des
 * commandes, clique dans la salle et lit les messages affichés, comme à l'écran.
 */
export class Player {
  readonly host = new TestHost();
  readonly engine: ArmaethEngine;
  /** Textes des fenêtres lus depuis le dernier `drain()`. */
  readonly log: string[] = [];

  constructor(options: ArmaethEngineOptions = {}) {
    this.engine = new ArmaethEngine(this.host, { seed: 1, ...options });
  }

  get state() {
    return this.engine.state!;
  }

  get hero(): GameObject {
    return this.state.hero!;
  }

  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.engine.tick();
  }

  /** Un clic gauche (appui puis relâchement). */
  click(x = 100, y = 100, buttons = 1): void {
    this.host.pointer(x, y, buttons);
    this.engine.tick();
    this.host.pointer(x, y, 0);
    this.engine.tick();
  }

  /** Lit la fenêtre ouverte (si elle l'est), la ferme d'un clic, et rend son texte. */
  readWindow(): string | null {
    if (!this.engine.windows.active) return null;
    const text = this.engine.windows.text ?? "";
    this.log.push(text);
    this.click();
    return text;
  }

  /** Ferme toutes les fenêtres en attente en les lisant ; rend les textes lus (au plus `maxWindows`). */
  drain(maxTicks = 400, maxWindows = 40): string[] {
    const read: string[] = [];
    for (let i = 0; i < maxTicks && read.length < maxWindows; i++) {
      const text = this.readWindow();
      if (text !== null) {
        read.push(text);
        i = 0;
        continue;
      }
      this.run(1);
      // plus de fenêtre pendant deux images consécutives : fini
      if (!this.engine.windows.active && this.engine.pendingWindowCount === 0) {
        this.run(1);
        if (!this.engine.windows.active && this.engine.pendingWindowCount === 0) break;
      }
    }
    this.run(24); // un clic de fermeture tombé dans le vide lance l'animation de refus du curseur (20 images)
    return read;
  }

  /**
   * Titre, distribution et récit : un clic à chaque attente (les textes lus vont dans `log`), jusqu'à ce que le héros soit dans la
   * salle de départ ; puis le texte d'introduction du niveau (événement différé 2000, 60 tics après l'entrée en salle 1) est lu.
   */
  skipIntro(maxTicks = 20000): string[] {
    const intro: string[] = [];
    for (let i = 0; i < maxTicks; i++) {
      const ready = this.engine.state?.hero && this.engine.state.loadedRoom && !this.engine.windows.active;
      if (ready && this.engine.frames > 300) break;
      const text = this.readWindow();
      if (text !== null) intro.push(text);
      else if (i % 40 === 0) this.click();
      else this.run(1);
    }
    // l'événement 2000 échoit 60 tics de monde (7 images chacun) après l'entrée en salle
    for (let i = 0; i < 700 && !this.engine.windows.active; i++) this.run(1);
    intro.push(...this.drain());
    this.run(30); // fin de l'animation de refus du curseur
    return intro;
  }

  /** Fenêtre de la salle à l'écran (origine des coordonnées du monde). */
  get origin(): { x: number; y: number } {
    const rect = this.engine.currentScene?.header;
    return { x: rect?.x ?? 8, y: rect?.y ?? 20 };
  }

  /** Choisit l'outil « bottes » (icône de la dernière case de la page 0) : un clic dans la salle fait marcher le héros. */
  useBoots(): void {
    if (this.engine.controller.tool.num !== 198) this.click(284, 10);
  }

  /** Clic « bottes » sur un point du monde `(x, y)` ; le héros marche jusqu'à la fin de son trajet ou du délai. */
  walkTo(x: number, y: number, maxTicks = 4000): void {
    this.useBoots();
    const { x: ox, y: oy } = this.origin;
    this.click(Math.round(x + ox), Math.round(y + oy));
    const hero = this.engine.state?.hero;
    for (let i = 0; i < maxTicks && hero?.path.defined && this.engine.state?.hero === hero; i += 5) this.run(5);
  }

  /**
   * Sort de la salle du côté `side` : le joueur clique au bord, à plusieurs hauteurs, jusqu'à ce que la salle change (il appuie
   * ensuite sur la flèche du côté pour finir de sortir). Rend vrai si la salle a changé.
   */
  leave(side: "up" | "right" | "down" | "left"): boolean {
    const state = this.state;
    const before = state.loadedRoom!.id;
    // la hauteur à l'écran dépend de la profondeur et du relief de chaque salle : on vise des points plus haut ou plus bas que le
    // héros (le moteur retient la case valide la plus proche) puis on pousse avec la flèche
    const attempts: [number, number][] = [];
    const hy = this.hero.y;
    const clamp = (y: number) => Math.max(2, Math.min(158, y));
    for (let k = 0; k < 27; k++) {
      if (side === "left" || side === "right") attempts.push([side === "left" ? 2 : 316, clamp(hy - 40 + k * 3)]);
      else for (const dy of side === "up" ? [-70, -45] : [30, 45]) attempts.push([4 + k * 12, clamp(hy + dy)]);
    }
    for (const [x, y] of attempts) {
      if (state.loadedRoom?.id !== before || !state.hero) break;
      this.walkTo(x, y, 1500);
      if (state.loadedRoom?.id === before) {
        this.host.key({ type: "nav", key: side });
        for (let i = 0; i < 60 && state.loadedRoom?.id === before; i++) this.run(5);
      }
      this.drain(20);
    }
    this.run(30);
    this.drain(20);
    return state.loadedRoom?.id !== before;
  }

  /**
   * Attend la fin de la marche du héros (trajet du clic ou réaction « trop loin ») et des animations qui le saisissent (chute à
   * l'eau, mort), en lisant les messages qui tombent ; rend les textes lus.
   */
  waitWalk(maxTicks = 3000): string[] {
    const read: string[] = [];
    const busy = () => {
      const hero = this.engine.state?.hero;
      return !!hero && (hero.path.defined || hero.ego === 6);
    };
    for (let i = 0; i < maxTicks && busy(); i += 5) {
      this.run(5);
      read.push(...this.drain(8));
    }
    // la commande rejouée à l'arrivée affiche son message quelques images plus tard
    this.run(6);
    read.push(...this.drain());
    return read;
  }

  /** Tape une commande, valide par Entrée, et rend les messages affichés en réponse (marche comprise). */
  say(line: string, settle = 4): string[] {
    if (this.engine.inputLine.open) {
      // une phrase refusée reste dans la ligne : Échap la ferme
      this.host.type("\x1b");
      this.run(2);
    }
    this.host.type(`${line}\r`);
    this.run(settle);
    return [...this.drain(), ...this.waitWalk()];
  }
}
