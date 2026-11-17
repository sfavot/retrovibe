import { SQUARE } from "../../../src/games/asterix/game/state";
import { launch, type LaunchOptions, type Launched } from "../game-helpers";
import { MINIGAME_PLAYERS } from "../minigames/players";

/**
 * Robot joueur d'Astérix : une partie complète, du menu principal au menu principal, jouée comme un joueur sur le moteur de
 * test (clavier et souris simulés, temps simulé à 60 Hz). Il lit l'écran interactif courant (`Runtime.screen`) et y répond
 * selon sa politique ; il ne touche jamais à l'état du jeu.
 */
export interface RobotOptions extends LaunchOptions {
  /** Personnages à inscrire, dans l'ordre (1 à 4, parmi 0..5). */
  characters: number[];
  /** Durée choisie à l'écran des réglages : indice 0..3 (30, 60, 90, 120 minutes). */
  durationIndex: number;
  /** Vise la victoire (bonnes réponses, achats, mini-jeux gagnés) ou laisse le temps s'écouler (tout raté). */
  aim: "victory" | "timeout";
  /** Plafond de temps simulé, en secondes. */
  maxSeconds?: number;
  /** Journal des écrans (diagnostic). */
  log?: (message: string) => void;
}

export interface RobotReport {
  outcome: "victoire" | "temps écoulé" | "abandon" | "limite";
  rounds: number;
  simulatedSeconds: number;
  frames: number;
  /** Écrans interactifs rencontrés, avec leur nombre. */
  screens: Record<string, number>;
  /** Cases jouées par type. */
  squares: Record<number, number>;
  /** Mini-jeux portés joués par leur robot, par module. */
  minigames: Record<number, number>;
  missing: string[];
  winner: number;
  backToMenu: boolean;
  /** Sauvegardes écrites (une par tour). */
  saves: number;
}

export class Robot {
  private run!: Launched;
  private readonly screens: Record<string, number> = {};
  private readonly minigames: Record<number, number> = {};
  private registered = 0;

  constructor(private readonly options: RobotOptions) {}

  private note(screen: string): void {
    this.screens[screen] = (this.screens[screen] ?? 0) + 1;
    // Captures de diagnostic (`ASTERIX_SHOTS`) : la première apparition de chaque écran.
    if (this.screens[screen] === 1) this.run.shot(`ecran-${screen}`);
    this.options.log?.(`${(this.run.host.time / 1000).toFixed(1)} s : ${screen}`);
  }

  /** Répond à l'écran interactif courant. */
  private async answer(screen: string): Promise<void> {
    const { run, options } = this;
    const { rt } = run;
    const winning = options.aim === "victory";
    switch (screen) {
      case "menu":
        await run.tap("Space");
        break;
      case "players": {
        const count = rt.game.players.length;
        if (count < options.characters.length) {
          // Clic direct sur le personnage à inscrire (décision D11).
          const slot = rt.tables.characterSlots.find((s) => s.character === options.characters[count])!;
          await run.click(slot.x - 16, slot.y - 20);
        } else {
          if (count < 4) await run.tap("ArrowDown");
          await run.run(400);
          await run.tap("Space");
        }
        break;
      }
      case "levels":
        // Niveaux variés selon le rang d'inscription : haut ou bas sur la bulle Réflexion.
        if (this.registered % 3 === 1) await run.tap("ArrowUp");
        if (this.registered % 3 === 2) await run.tap("ArrowDown");
        this.registered++;
        await run.run(800);
        await run.tap("Space");
        break;
      case "settings":
        for (let d = 2; d !== options.durationIndex; d += Math.sign(options.durationIndex - d)) {
          await run.tap(options.durationIndex > d ? "ArrowRight" : "ArrowLeft");
          await run.run(300);
        }
        await run.tap("Space");
        break;
      case "turn":
      case "die":
      case "score":
      case "map":
      case "marble":
      case "pause":
      case "choosePlayer":
      case "soothsayer":
        await run.tap("Space");
        break;
      case "confirm":
        // Oui pour viser la victoire (sortir de prison, rattrapage, surprise), non sinon.
        // L'écran ne lit pas les directions pendant ses 20 premiers centièmes.
        await run.run(400);
        if (winning) {
          await run.tap("ArrowRight");
          await run.run(400);
        }
        await run.tap("Space");
        break;
      case "quiz": {
        const correct = rt.hint.correct as number;
        const wanted = winning ? correct : (correct + 1) % 3;
        for (let i = 0; i < wanted; i++) {
          await run.tap("ArrowDown");
          await run.run(300);
        }
        await run.tap("Space");
        break;
      }
      case "minigame": {
        // Mini-jeu porté : son robot le joue jusqu'au bout ; sinon l'écran provisoire, « Gagné » ou « Perdu ».
        const module = rt.hint.module as number;
        const player = MINIGAME_PLAYERS[module];
        if (player) {
          this.minigames[module] = (this.minigames[module] ?? 0) + 1;
          await player(run, winning);
        } else {
          if (!winning) {
            await run.tap("ArrowRight");
            await run.run(100);
          }
          await run.tap("Space");
        }
        break;
      }
      case "merchant": {
        // Clic direct sur le premier objet de l'étal que le joueur n'a pas.
        const player = rt.game.players[rt.game.current];
        const item = rt.tables.stall.find((s) => !player.objects[s.object]) ?? rt.tables.stall[0];
        await run.click(item.x - 16, item.y - 20);
        break;
      }
      case "spy": {
        // Vers le village avec tous ses objets, sinon vers un pays dont l'objet manque (clic direct sur la carte).
        const player = rt.game.players[rt.game.current];
        let target = 0;
        if (winning && player.objectCount < rt.game.objectsRequired) {
          const country = player.objects.findIndex((owned) => !owned);
          target = country * 6;
        }
        if (!winning) target = (player.pos + 5) % 54;
        if (rt.tables.board[target] === SQUARE.spy) target = (target + 1) % 54;
        const cell = rt.tables.mapCells[target];
        await run.click(cell.x * 29 + 12, cell.y * 21 + 6 + 10);
        break;
      }
      default:
        await run.tap("Space");
    }
  }

  async play(): Promise<RobotReport> {
    const { options } = this;
    const run = (this.run = await launch(options));
    const limit = (options.maxSeconds ?? 3 * 3600) * 1000;
    const squares: Record<number, number> = {};
    let saves = 0;
    let lastSave = "";
    let started = false;
    let outcome: RobotReport["outcome"] = "limite";
    let winner = -1;
    let rounds = 0;
    let backToMenu = false;
    let lastScreen = "";
    while (run.host.time < limit) {
      await run.frame();
      const screen = run.screen;
      const save = run.host.storage.get("retrovibe:asterix:game") ?? "";
      if (save !== lastSave) {
        if (save !== "") saves++;
        lastSave = save;
      }
      const game = run.game.runtime?.game;
      if (started && game) {
        rounds = Math.max(rounds, game.round);
        if (game.victory) {
          outcome = "victoire";
          winner = game.winner;
        } else if (game.over) outcome = "temps écoulé";
        else if (game.quit) outcome = "abandon";
      }
      if (screen === "" || screen === "end") {
        if (screen === "end" && process.env.ASTERIX_SHOTS && run.frames % 150 === 0) run.shot(`fin-${options.aim}-${Math.floor(run.frames / 150)}`);
        lastScreen = screen;
        continue;
      }
      if (screen === "menu") {
        if (started) {
          backToMenu = true;
          break;
        }
        started = true;
      }
      if (screen !== lastScreen) this.note(screen);
      lastScreen = screen;
      const before = screen === "die" ? run.rt.game.players[run.rt.game.current].pos : -1;
      await this.answer(screen);
      if (before >= 0) {
        // Après le dé : attend la fin du déplacement pour relever la case d'arrivée.
        await run.until(() => run.screen !== "die", 30_000);
        const player = run.rt.game.players[run.rt.game.current];
        if (player) {
          // Le pion avance d'une case toutes les 0,3 s : il est arrivé quand il ne bouge plus pendant 40 images.
          let position = player.pos;
          for (let still = 0; still < 40 && run.screen === ""; ) {
            await run.frame();
            still = player.pos === position ? still + 1 : 0;
            position = player.pos;
          }
          const type = run.rt.tables.board[player.pos];
          squares[type] = (squares[type] ?? 0) + 1;
          if (squares[type] === 1 && process.env.ASTERIX_SHOTS) {
            // Captures de diagnostic : trois instants de la première case de chaque type.
            for (const [label, frames] of [["a", 40], ["b", 80], ["c", 160]] as const) {
              for (let i = 0; i < frames && run.screen === ""; i++) await run.frame();
              run.shot(`case-${type}-${label}`);
            }
          }
        }
      }
    }
    return {
      outcome,
      rounds,
      simulatedSeconds: Math.round(run.host.time / 1000),
      frames: run.frames,
      screens: this.screens,
      squares,
      minigames: this.minigames,
      missing: [...new Set(run.game.runtime?.missing ?? [])],
      winner,
      backToMenu,
      saves,
    };
  }
}
