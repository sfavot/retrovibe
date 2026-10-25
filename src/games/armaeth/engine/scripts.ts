import type { CmRecord } from "../data/commands";
import { isScriptLine } from "./parser";
import {
  type DispatchResult,
  type ScriptControl,
  type ScriptFlags,
  type TokenHost,
  type TokenWait,
  TokenInterpreter,
  createScriptFlags,
} from "./tokens";

/**
 * Automate des scripts `CM1..CM4` d'*Armaeth* (`gm_cm_script_step` `1346:0004`, `docs/armaeth/parser.md` § 12). Pur et non
 * bloquant : l'original exécute les scripts en boucle (`cnt 7`) en attendant sur place les fenêtres de texte et `wat` ;
 * ici ces attentes sont des états explicites que `tick()` (un tic BIOS, 18,2 Hz) et `input()` font avancer.
 *
 * États de `step(n)` : 0 ouvre `CM1`, 4 `CM2`, 5 `CM3`, 9 `CM4`, 6 et 7 `CM3` (7 mémorise « avec conseils »), 1 lit et
 * exécute, 2 reprise après un tic, 3 ferme, 8 fin de `CM3` (enchaîne `CM4` si 7 a servi, sinon ferme).
 */

export type ScriptNumber = 1 | 2 | 3 | 4;
/** Enregistrements décodés (`parseCm`) des quatre fichiers `A1FCM1..4.SYS`. */
export type ScriptSet = Readonly<Record<ScriptNumber, readonly CmRecord[]>>;

/** Événements qui font avancer une attente. */
export type ScriptInput =
  | { type: "click" }
  | { type: "key"; key: "enter" | "escape" | "other" }
  /** F8 pendant un script : saute jusqu'au prochain `fin` (§ 12.4). */
  | { type: "skip" };

export type ScriptStatus = "idle" | "running" | "waiting-ticks" | "waiting-text" | "yielded" | "ended";

export interface ScriptRunnerOptions {
  flags?: ScriptFlags;
  /** Appelé après chaque jeton exécuté (journal, débogage, tests). */
  onToken?: (record: CmRecord, result: DispatchResult) => void;
}

/** Fichier ouvert par chaque état d'ouverture. */
const OPEN_STATES: Readonly<Record<number, ScriptNumber>> = { 0: 1, 4: 2, 5: 3, 6: 3, 7: 3, 9: 4 };

export class ScriptRunner implements ScriptControl {
  readonly flags: ScriptFlags;
  readonly interpreter: TokenInterpreter;

  private script: readonly CmRecord[] | null = null;
  private position = 0;
  /** État 7 utilisé : la fin de `CM3` (état 8) enchaîne sur `CM4`. */
  private withTips = false;
  private wait: TokenWait | null = null;
  /** Tics (ou délai de lecture) restants de l'attente en cours. */
  private waitLeft = 0;
  /** Mot « répétition » de l'enregistrement exécuté, décrémenté à chaque rappel (état 2). */
  private rep = 0;
  /** Le script a rendu la main (`cnt` nul et `rep` ≥ 1) et attend les rappels de l'état 2. */
  private yielded = false;
  private pumping = false;
  /** Compte les ouvertures et fermetures de script, pour détecter qu'un jeton `sys` a changé de script. */
  private generation = 0;

  constructor(
    host: TokenHost,
    private readonly scripts: ScriptSet,
    private readonly options: ScriptRunnerOptions = {},
  ) {
    this.flags = options.flags ?? createScriptFlags();
    this.interpreter = new TokenInterpreter(host, this, this.flags);
  }

  // --- déclencheurs (§ 12.5) -------------------------------------------------------------------------------------

  /** `CM1` : amorçage du moteur, silencieux (`1005:005a`, état 0). */
  runInit(): void {
    this.step(0);
  }

  /** `CM2` : récit d'introduction, avant la partie (`1005:01e0`, état 4). */
  runIntro(): void {
    this.step(4);
  }

  /** `CM3` : fin d'épisode ou mort (état 6) ; `withTips` = état 7, qui enchaîne sur `CM4` à la fin (jamais utilisé par le jeu). */
  runEpisodeEnd(withTips = false): void {
    this.step(withTips ? 7 : 6);
  }

  /** `CM4` : conseils de jeu puis sortie, sur `quitter` / `terminer` (`1503:0000`, état 9). */
  runQuitTips(): void {
    this.step(9);
  }

  /**
   * Ligne `/jeton arguments` de la saisie (§ 11.3), déjà normalisée. Ignorée pendant un script ou une attente
   * (« le texte tapé pendant un script est ignoré »). Retourne vrai si un jeton a été exécuté avec succès.
   */
  runCommand(line: string): boolean {
    if (!isScriptLine(line) || this.flags.running || this.wait || this.flags.quit) return false;
    return this.apply(this.interpreter.runLine(line));
  }

  // --- automate -------------------------------------------------------------------------------------------------

  /** `gm_cm_script_step(état)` ; aussi appelé par le jeton `sys`. */
  step(state: number): void {
    const open = OPEN_STATES[state];
    if (open !== undefined) {
      if (state === 6 || state === 7) this.withTips = state === 7;
      this.open(open);
      return;
    }
    switch (state) {
      case 1:
        this.pump();
        break;
      case 2:
        this.resume();
        break;
      case 3:
        this.close();
        break;
      case 8:
        if (this.withTips) {
          this.withTips = false;
          this.open(4);
        } else this.close();
        break;
      default:
        break;
    }
  }

  /** Un tic BIOS : fait avancer l'attente en cours ou le rappel de l'état 2. */
  tick(): void {
    if (this.flags.quit) return;
    if (this.wait) {
      this.waitLeft -= 1;
      if (this.waitLeft <= 0) this.timeout();
    } else if (this.yielded) this.resume();
  }

  input(event: ScriptInput): void {
    if (this.flags.quit) return;
    if (event.type === "skip") {
      if (!this.flags.running) return;
      this.flags.skip = true;
      this.cancelWait();
      this.yielded = false;
      this.pump();
      return;
    }
    if (this.wait?.kind !== "text") return;
    // `1db5:003e` : clic gauche ou droit (si la souris est active), Entrée ou Échap ; toute autre touche sonne.
    const confirm = event.type === "click" ? this.flags.mouse : event.key === "enter" || event.key === "escape";
    if (confirm) this.confirmText();
    else if (event.type === "key") this.interpreter.host.bell();
  }

  get status(): ScriptStatus {
    if (this.flags.quit) return "ended";
    if (this.wait) return this.wait.kind === "ticks" ? "waiting-ticks" : "waiting-text";
    if (this.yielded) return "yielded";
    return this.flags.running ? "running" : "idle";
  }

  /** Un script est en cours (`DGROUP:4b34`). */
  get running(): boolean {
    return this.flags.running;
  }

  // --- interne ----------------------------------------------------------------------------------------------------

  /** Ouverture (`1346:003a`) : le héros ne répond plus, `4b42 = 4b38 = 4b36 ← 0`, puis lecture. */
  private open(number: ScriptNumber): void {
    this.cancelWait();
    this.generation++;
    this.script = this.scripts[number];
    this.position = 0;
    this.rep = 0;
    this.yielded = false;
    Object.assign(this.flags, { running: true, heroControl: false, paused: false, skip: false, cnt: 0 });
    this.pump();
  }

  /**
   * État 3 : ferme le fichier ; `4b34 = 4b42 = 4b38 ← 0`, `4b50 ← 7`, `4b36 ← 7`. Le niveau de groupe retombe à 0 : les
   * quatre scripts font déjà `dgs 0` avant `sys 3` / `sys 8` ; la remise à zéro ici couvre aussi la fin par `EOF` (écart assumé).
   */
  private close(): void {
    this.generation++;
    this.script = null;
    this.yielded = false;
    Object.assign(this.flags, { running: false, paused: false, skip: false, heroControl: true, cnt: 7, dgs: 0 });
  }

  /** État 1 en boucle : lit et exécute jusqu'à une attente, un rappel à attendre, la fin ou la sortie du jeu. */
  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.flags.running && !this.flags.quit && !this.wait && !this.yielded) this.readExecute();
    } finally {
      this.pumping = false;
    }
  }

  private readExecute(): void {
    const record = this.script?.[this.position++];
    if (!record) {
      this.close(); // EOF : état 3
      return;
    }
    // Mode saut : seuls les `fin` (groupe 0, jeton 0) sont exécutés.
    const generation = this.generation;
    if (!this.flags.skip || (record.group === 0 && record.token === 0)) {
      const result = this.interpreter.dispatch(record.group, record.token, record.args, record.text);
      this.options.onToken?.(record, result);
      if (result.wait) this.startWait(result.wait);
    }
    // Un `sys` a fermé ou rouvert un script (le nouvel état prime) ; sinon `cnt` ≠ 0 : on enchaîne.
    if (generation !== this.generation || !this.flags.running || this.flags.cnt !== 0) return;
    this.rep = record.repeat;
    this.yielded = true;
    this.resume();
  }

  /** État 2 : `rep--` ; si `rep` valait 0 ou en mode saut on enchaîne, sinon on rend la main (rien si pause). */
  private resume(): void {
    if (!this.flags.running || this.flags.paused || this.flags.quit) return;
    const was = this.rep;
    this.rep -= 1;
    if (was > 0 && !this.flags.skip) return;
    this.yielded = false;
    this.pump();
  }

  private startWait(wait: TokenWait): void {
    this.wait = wait;
    this.waitLeft = wait.kind === "ticks" ? wait.ticks : wait.delay;
  }

  private cancelWait(): void {
    if (this.wait?.kind === "text") this.interpreter.host.closeText();
    this.wait = null;
  }

  /** Délai écoulé : fin d'une attente de tics, ou page suivante d'un texte à lecture automatique. */
  private timeout(): void {
    const wait = this.wait;
    if (wait?.kind === "ticks") {
      this.wait = null;
      wait.then?.();
      this.pump();
    } else if (wait?.kind === "text" && wait.delay > 0) this.confirmText();
  }

  /** Page suivante, ou fin du texte et reprise du script. */
  private confirmText(): void {
    const wait = this.wait;
    if (wait?.kind !== "text") return;
    if (this.interpreter.host.advanceText()) {
      this.waitLeft = wait.delay;
      return;
    }
    this.wait = null;
    this.pump();
  }

  /** Résultat d'une ligne tapée : une attente éventuelle est prise en charge comme celle d'un script. */
  private apply(result: DispatchResult): boolean {
    if (result.wait) this.startWait(result.wait);
    return result.ok;
  }
}
