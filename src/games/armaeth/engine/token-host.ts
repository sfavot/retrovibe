import { CMD_LOOP, CMD_START, type Sequencer } from "../audio/sequencer";
import type { GameObject, WorldState } from "./state";
import type {
  DebugKind,
  ListFamily,
  ListOp,
  ObjectAction,
  SoundKind,
  TextRequest,
  TokenHost,
} from "./tokens";

/**
 * Hôte des jetons de script d'*Armaeth* (`TokenHost`, 35 méthodes) au-dessus du moteur : états, compositeur, séquenceur,
 * fenêtres de texte, salles. Chaque méthode cite le jeton qui l'appelle (`docs/armaeth/parser.md` § 11.4). Les jetons que
 * `CM1` à `CM4` n'emploient pas (groupes 7 et 9 pour la plupart, débogage) sont des stubs marqués `// à brancher`.
 */

/** Ce que l'hôte de jetons demande au moteur (implémenté par `ArmaethEngine`). */
export interface TokenHostEngine {
  /** Monde chargé, ou `null` avant `rsv -1` (titre, distribution, récit). */
  readonly state: WorldState | null;
  readonly sequencer: Sequencer;
  /** `gm_get_message` : texte du message, ou `undefined` s'il n'existe pas. */
  messageText(messageClass: number, id: number): string | undefined;
  bell(): void;
  openWindow(request: TextRequest): void;
  advanceWindow(): boolean;
  closeWindow(): void;
  /** `cmd` : affiche la phrase dans la boîte de saisie, sans l'exécuter. */
  echoCommand(text: string): void;
  /** `gm_parse_command` + `gm_execute_command`. */
  submitCommand(text: string): void;
  setTextColors(a: number, b: number, c: number): void;
  /** `lir` : dessine la scène en plein écran sans changer de salle. */
  drawScene(sceneId: number): void;
  /** `gm_savegame_slot(mode)` : -1 recommencer, 0 restaurer, 1 sauvegarder. */
  saveSlot(mode: number): void;
  /** `gm_snapshot_world` : écrit (`save`) ou relit (`load`) le monde dans le fichier temporaire. */
  snapshot(op: "save" | "load"): void;
  /** `cle` : ouvre la porte de chapitre et efface les procédures mémorisées. */
  setGate(family: number, value: number): void;
  /** `lum` : niveau imposé (`4ae2`) et plafond (`4ae4`, `undefined` = aucun). */
  setLight(level: number, cap: number | undefined): void;
  shiftPalette(r: number, g: number, b: number): void;
  /** `1a37:0002` : relance l'animation de l'objet après un changement d'apparence. */
  refreshObject(obj: GameObject): void;
  resetMotion(obj: GameObject): void;
  /** `1aba:000e`. */
  place(obj: GameObject, mode: number): number;
  pathTo(obj: GameObject, x: number, y: number, p: number, plane: number): boolean;
  /** `trf`, `mov` : salle voulue ; `sendHero` envoie aussi le héros (`+0x3F ← 6`). */
  sendToRoom(roomId: number, sendHero: boolean): void;
  quit(): void;
  /** `dictionnaire n` / `dic` (`23f1:000c`) : rend vrai si la valeur est prise. */
  setDictionaryLetters(n: number): boolean;
  /** `117d:0002`, jetons `ad*` : crée un objet depuis le modèle `DEF` de la ressource (`id`) de la famille (0 INT, 1 DEC, 2 OBJ). */
  createFromDef(family: 0 | 1 | 2, id: number): GameObject | undefined;
}

export class EngineTokenHost implements TokenHost {
  constructor(private readonly engine: TokenHostEngine) {}

  private get state(): WorldState | null {
    return this.engine.state;
  }

  bell(): void {
    this.engine.bell();
  }

  // --- objets ---
  resolveObject(num: number): GameObject | undefined {
    return this.state?.resolveObject(num);
  }

  writeObjectField(obj: GameObject, offset: number, size: 1 | 2, value: number): void {
    this.state?.writeField(obj, offset, size, value);
  }

  refreshObject(obj: GameObject): void {
    this.engine.refreshObject(obj);
  }

  /** hypothèse (parser.md § 11.4) : `fct` pose ou retire le pointeur ; ici `Gst` dit si l'objet en a un, et la procédure est résolue de nouveau. */
  setBehaviour(obj: GameObject, enabled: boolean): void {
    obj.gst = enabled ? 7 : 0;
    obj.behavior = null;
  }

  objectAction(action: ObjectAction, obj: GameObject | undefined, args: readonly number[]): void {
    if (!obj) return;
    switch (action) {
      case "xpy": {
        // `+0x54 ← a0`, `+0x58 ← a1`, `+0x56 ← a2`, `+0x53 ← a3`, `+0x5A ← a4` (chaque argument >= 0), puis `1aba:000e`.
        const fields: [number, 1 | 2][] = [
          [0x54, 2],
          [0x58, 2],
          [0x56, 2],
          [0x53, 1],
          [0x5a, 1],
        ];
        fields.forEach(([offset, size], i) => {
          if (args[i] >= 0) this.state?.writeField(obj, offset, size, args[i]);
        });
        this.engine.place(obj, 1); // hypothèse : mode de placement 1 (le mode du jeton n'est pas établi)
        break;
      }
      case "trj":
        // `+0x70 ← a0`, `+0x74 ← a1`, `+0x72 ← a2` (X, P, Y), plan a3.
        if (!this.engine.pathTo(obj, args[0], args[2], args[1], Math.max(0, args[3]))) this.engine.bell();
        break;
      case "raz":
        this.engine.resetMotion(obj);
        break;
      case "mov": {
        // `+0x3F ← 6`, `19dc:0000` vers la salle a0.
        const room = this.state?.roomById(args[0]);
        if (room && this.state) {
          obj.info = 6;
          if (obj.typ !== 0) this.state.moveToRoom(obj, room);
        }
        break;
      }
      case "get": {
        // `11dc:0226` : `a0` = `Num` du conteneur (`1a7b:03b0`), `a1` = l'objet ; `19dc:0000(conteneur, objet, mode 2)` s'ils diffèrent
        const holder = this.state?.findByNum(args[0]);
        if (holder && holder !== obj) this.moveInto(obj, holder);
        break;
      }
      case "let": {
        // `11dc:0282` (hypothèse) : le contenu de `Num a0` de l'objet est posé là où l'objet se trouve (`19dc:0000`, `Cod` de l'objet)
        const item = obj.contents.find((o) => o.num === args[0]);
        if (!item || !this.state) break;
        if (obj.holder) this.moveInto(item, obj.holder);
        else if (obj.room) {
          this.state.moveToRoom(item, obj.room);
          this.engine.place(item, 1);
        }
        break;
      }
      case "chr": // non établi : `23a2:0002(objet, a3)` arme une minuterie dont le sens de `a3` n'est pas relevé
        break;
    }
  }

  /** Range `obj` dans `holder` (`19dc:0000`, mode 2) sans créer de cycle. */
  private moveInto(obj: GameObject, holder: GameObject): void {
    try {
      this.state?.moveToContainer(obj, holder);
    } catch {
      this.engine.bell();
    }
  }

  /** Liste d'objets du groupe 7 : `int` = interface (`4c0e`), `dec` = décors (`salle + 0x26`), `obj` = objets (`salle + 0x22`). */
  private listFor(family: ListFamily): GameObject[] {
    const state = this.state;
    if (!state) return [];
    if (family === "int") return state.interfaceObjects;
    const room = state.loadedRoom ?? state.wantedRoom;
    return (family === "dec" ? room?.listB : room?.listA) ?? [];
  }

  /**
   * Groupe 7 (`117d:0002`, hypothèses de `parser.md` § 11.4) : `create` crée l'objet du modèle `DEF` (`a0`) dans la salle ou la liste
   * d'interface, et le désigne comme héros si `a2` est non nul ; `delete` supprime l'objet de `Num a0` (-1 : le héros) ; `select`
   * désigne l'objet de `Num a0` comme héros ; `releaseSelect` relâche d'abord le héros ; `release` retire le contrôle de `Num a0` ;
   * `next` désigne l'objet qui suit le héros dans la liste (retour au début). `clear` (`gm_destroy_scene_objects`) et `list`
   * (`21ad:000a`) ne sont pas établis.
   */
  objectList(op: ListOp, family: ListFamily, args: readonly number[]): void {
    const state = this.state;
    if (!state) return;
    const list = this.listFor(family);
    const find = (num: number) => (num === -1 ? (state.hero ?? undefined) : list.find((o) => o.num === num));
    switch (op) {
      case "create": {
        if (args[0] < 1) break; // « numéro non précisé »
        const obj = this.engine.createFromDef(family === "int" ? 0 : family === "dec" ? 1 : 2, args[0]);
        if (obj && args[2] > 0) state.setHero(obj);
        break;
      }
      case "delete": {
        const obj = find(args[0]);
        if (obj) state.deleteObject(obj);
        break;
      }
      case "releaseSelect":
      case "select": {
        const obj = find(args[0]);
        if (op === "releaseSelect") state.setHero(null);
        if (obj) state.setHero(obj);
        break;
      }
      case "release": {
        const obj = find(args[0]);
        if (obj && obj === state.hero) state.setHero(null);
        break;
      }
      case "next": {
        if (list.length === 0) break;
        const at = state.hero ? list.indexOf(state.hero) : -1;
        state.setHero(list[(at + 1) % list.length]!);
        break;
      }
      case "clear": // non établi
      case "list": // non établi (mise en forme de `21ad:000a`)
        break;
    }
  }

  sequence(_step: 1 | 2 | 3, _arg: number): void {
    // sans objet : `sl1`..`sl3` pilotent les joyaux `INT 5` (`1611:*`), jamais créés en partie (interface.md § 3.4)
  }

  // --- texte ---
  getMessage(messageClass: number, id: number): string | undefined {
    return this.engine.messageText(messageClass, id);
  }

  showText(request: TextRequest): void {
    this.engine.openWindow(request);
  }

  advanceText(): boolean {
    return this.engine.advanceWindow();
  }

  closeText(): void {
    this.engine.closeWindow();
  }

  echoCommand(text: string): void {
    this.engine.echoCommand(text);
  }

  executeCommand(text: string): void {
    this.engine.submitCommand(text);
  }

  setTextColors(a: number, b: number, c: number): void {
    this.engine.setTextColors(a, b, c);
  }

  // --- monde et scène ---
  setChapterLevel(chapterLevel: number): void {
    if (this.state) this.state.chapterLevel = chapterLevel;
  }

  setDestinationRoom(roomId: number, sendHero: boolean): void {
    this.engine.sendToRoom(roomId, sendHero);
  }

  loadScene(sceneId: number): void {
    this.engine.drawScene(sceneId);
  }

  snapshotStack(_size: number): void {
    // sans objet : la pile d'annulation du pilote vidéo est celle du compositeur
  }

  saveSlot(mode: number): void {
    this.engine.saveSlot(mode);
  }

  worldFile(op: "save" | "load"): void {
    this.engine.snapshot(op);
  }

  worldOperation(_op: "sub" | "sal", _arg: number): void {
    // non établi : `sub` (purge d'objets « marqués » puis rechargement depuis le fichier temporaire) et `sal` (mots de la table des
    // salles dont `mot +10 / 100 == a0`) sont des hypothèses de `parser.md` § 11.4, absentes de `CM1` à `CM4`
  }

  setHandlerGate(family: number, value: number): void {
    this.engine.setGate(family, value);
  }

  setClock(hour: number, minute: number, ticks: number): void {
    const clock = this.state?.clock;
    if (!clock) return;
    clock.hour = hour;
    clock.minute = minute;
    clock.ticks = ticks;
  }

  setSpeedDivider(delay: number): void {
    if (this.state) this.state.cadence.delay = delay;
  }

  // --- affichage et son ---
  setLight(level: number, aux: number): void {
    // `lum a b` : `b` absent vaut 0xFFFF et `197e:0008` compare `4ae4` en entier signé (`if (4ae4 < L) L = 4ae4`) : le plafond est -1, la
    // lumière ne dépasse jamais d'un cran la palette normale (sans plafond, une torche dans une salle éclairée blanchit l'écran)
    this.engine.setLight(level, aux);
  }

  shiftPalette(r: number, v: number, b: number): void {
    this.engine.shiftPalette(r, v, b);
  }

  resetDriver(): void {
    // sans objet : bloc de liaison du pilote vidéo (`sec`)
  }

  driverInit(): void {
    // sans objet : `isr`
  }

  initVideo(): void {
    // sans objet : `mod`, mode 13h
  }

  setDiskFlag(_value: number): void {
    // sans objet : `dsk`, indicateur de lecteur
  }

  setMouseEnabled(_enabled: boolean): void {
    // le drapeau est tenu par `ScriptFlags.mouse`, lu par l'automate de scripts
  }

  sound(kind: SoundKind, args: readonly number[]): void {
    const sequencer = this.engine.sequencer;
    const set = (i: number) => args[i] !== undefined && args[i] !== -1;
    switch (kind) {
      case "mus": {
        // `mus id classe numéro boucle drapeaux force` -> `gm_sound_play`.
        const flags = set(4) ? args[4] : 0;
        sequencer.play(args[0], args[1], args[2], {
          loop: set(3) && args[3] !== 0,
          fadeOut: (flags & 1) !== 0,
          fadeIn: (flags & 2) !== 0,
          force: !set(5) || args[5] !== 0,
        });
        break;
      }
      case "brt": // `brt classe numéro priorité boucle` -> `gm_sound_select_track`
        sequencer.selectTrack(args[0], args[1], set(2) ? args[2] : 0, set(3) && args[3] !== 0);
        break;
      case "msl":
        sequencer.setMuted(set(0) && args[0] === 0);
        break;
      case "mst":
        if (set(0) && args[0] !== 0) sequencer.stopAll();
        break;
      case "fbt": {
        // `snd_start_track(a0, a1, a2 < 0 ? 0x80 : 0xA0)` (`40f7:156b`) : effet d'indice `a0` sur les voix `a1`, bouclé si `a2` >= 0
        if (!set(0) || sequencer.isMuted) break;
        sequencer.driver.startEffect(args[0], set(1) ? args[1] : 1, CMD_START | (args[2] >= 0 && set(2) ? CMD_LOOP : 0), 0);
        break;
      }
      case "buz":
      case "adl":
      case "rol": // choix du pilote : le port n'a que l'OPL2
        break;
    }
  }

  // --- débogage et sortie ---
  debug(kind: DebugKind, obj: GameObject | undefined, args: readonly number[]): void {
    // `dic` (`23f1:000c`, probable) règle les lettres significatives ; `exp` (`1664:0004`, hypothèse) désigne l'objet dont le contenu
    // s'affiche. Les autres jetons ouvrent des fenêtres de débogage (`inf`, `loc`, `dec`, `img`, `pos`, `vue`) : sans objet en jeu.
    if (kind === "dic") this.engine.setDictionaryLetters(args[0]);
    else if (kind === "exp" && this.state) this.state.selected = obj ?? null;
  }

  quit(): void {
    this.engine.quit();
  }
}
