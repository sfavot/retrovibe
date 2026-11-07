/**
 * Les nizibooms (`FLEENS.MHK`, écran 13, tâche H7 ; `docs/zoombinis/puzzles/fleens.md`, `docs/zoombinis/engine-ts.md`, « Nizibooms (tâche H7) »).
 * Épreuve sur le kit commun (`puzzle-kit.ts`) : le kit porte l'arrivée du groupe, le glisser-déposer, les boutons, l'enregistrement, l'aide F1 et le départ ; cet écran
 * porte les règles (`game/puzzles/fleens.ts`) et la mise en scène, dont le dessin des nizibooms, qui ne sont pas des Zoombinis.
 *
 * ## Déroulé (original : Enter `10e0:00ea`, Tick `10e0:06a8`, clic `10e0:0ae5`, événements `10e0:227e`, scripts `10e0:292a` et `10e0:1fd1`)
 *
 *  1. **Entrée** : fond et palette 300, groupes de formes 0 (1000 : branche aux cocons), 1 (1100 : repère de dépôt) et 2 (1200 : poussière et brillances), branche (`SCRB` 1000 +
 *     cocons déjà pleins), repère, 7 objets d'ambiance ; fabrication des nizibooms (`10e0:1b29` : règle cachée, trois spéciaux sur la branche, les autres sur la terrasse) ; arrivée du
 *     groupe en bas à gauche (200 puis 45 ticks) ; introduction : le premier Zoombini entre par `SCRS` 7035 + pieds. Personne de « sauvé » (`+0x127 = 0`).
 *  2. **Essai** : le joueur glisse un Zoombini sur le repère (438, 357, rayon de prise 100) ; il y court son parcours (`SCRS` 7000 + pieds, absolu, jusqu'à la file de (199, 120)).
 *     Événement 4 : son cousin de la terrasse se tourne vers lui (type 5) ; 6 : si le cousin est sur la branche, le cocon se remplit (`SCRB` 1000 + cocons) et le cousin s'en va ;
 *     7 : le repère se libère (un autre Zoombini peut être déposé, son essai attend la fin du précédent) ; 132 : les essais précédents reculent de 20 pixels et, quand la file de 7
 *     est pleine, le plus ancien sort à gauche (`SCRS` 7010).
 *  3. **Trois cocons** : le dernier essai joue `SCRS` 7005 + pieds ; événements 133 et 134 : les nizibooms de la terrasse s'enfuient (`SCRS` 4056 à 4058) ; événement 30 : séquence de
 *     clôture (`SCRB` 1004 + tirage de 0 à 2) ; à sa fin « Go » est actif et le groupe est « sauvé » (`1168:3dd0(0, 1)`), voix de réussite.
 *  4. **« Go »** : son 996, les Zoombinis partent à pied ; écran suivant (l'hôtel). **Carte** : abandon, groupe perdu.
 *
 * ## Écarts avec l'original (voir aussi `docs/zoombinis/puzzles/fleens.md`)
 *
 *  - repère de dépôt : un seul point (438, 357) de rayon 100 (`DS:11f4`, début absolu des `SCRS` 7000 : tous les parcours démarrent là) ; l'original ne montre pas de liste de dépôt
 *    séparée de celle d'attente et les 16 places d'attente (`DS:11b4`, 16 points : (56, 379) manquait à l'étude) seraient toutes occupées par un groupe de 16 ; **probable** ;
 *  - un Zoombini déjà essayé ne se reprend pas (l'original le laisse déplaçable sans nouvel essai, `[96fe]`) ;
 *  - les scripts de poursuite des nizibooms de la terrasse (`SCRS` 4004 + position, 4026 à 4050 : ils courent jusqu'à (429, 223) puis suivent le Zoombini) ne sont pas portés : le
 *    cousin d'un essai manqué ne fait que se tourner (`SCRS` 4003) ; ils reviendraient sinon à leur place par un saut non documenté ;
 *  - le cousin perché que l'essai trouve joue les `SCRS` 4020 + 2 (pos − 17) puis 4021 + 2 (pos − 17) (types 7 et 8) et disparaît : **probable** (l'original ne le montre pas) ;
 *  - pas de chargement progressif des 8 `SCRS` d'ambiance (`[7490]`, `10e0:0f51`) ni d'animation de joie des Zoombinis (`[7496]`, `292a(5)`) ni de réactions de groupe de l'événement 135 ;
 *  - le retour d'un Zoombini sorti de la file n'existe pas : il quitte l'écran par la gauche, sauvé ;
 *  - un groupe d'un seul Zoombini n'a pas de `SCRS` 7005 + pieds : la clôture est lancée à la fin de son parcours (7041 + pieds) ; **probable** ;
 *  - la voix 20036 (`0x4e44`) attendue avant de quitter n'est pas portée ; départ : tous les sauvés marchent vers (660, 357) (`SCRS` 7021 à 7030 non portés).
 */
import type { Archive } from "../../../../engine/mohawk/resources";
import { FEATURE_END, FEATURES, FeatureFlag, type Feature, type FeaturePart, type Features, type Sheet, createSheet } from "../../engine/features";
import { ZOOMBINIS_GAME } from "../../engine/game";
import type { Scene, SceneContext } from "../../engine/scene";
import { DIALOG } from "../../engine/dialog";
import { screenInfo } from "../../data/archives";
import type { Script } from "../../data/script";
import { currentLevel, dialogMemoryIndex } from "../../game/route";
import {
  FLEENS_RULE_BYTES,
  canGo,
  canTry,
  endClosure,
  goExit,
  prepareFleens,
  tryMember,
  type Cousin,
  type FleensState,
} from "../../game/puzzles/fleens";
import type { Zoombini } from "../../game/state";
import { createPuzzleKit, createTarget, sheetButtonImages, type DropInfo, type DropTarget, type KitMember, type PuzzleKit } from "../puzzle-kit";
import { closeScreen, openScreen } from "../screen-kit";
import { screenScripts } from "../snoid";
import { dialogChoice } from "../xfer";
import type { Point } from "../../data/zoombini";

const SCREEN = 13;

/** Fond et palette (`SHPL` / `tBMP` 300), planche des nizibooms 4000 (`REGS` 4000 / 4001), boutons 400, groupes de formes 1000, 1100, 1200. */
const BACKGROUND = 300;
const NIZIBOOM_SHEET = 4000;
const BUTTONS_SHEET = 400;
const GROUP_BRANCH = 1000;
const GROUP_MARK = 1100;
const GROUP_DUST = 1200;

/** `SCRB` : branche seule 1000, avec 1, 2, 3 cocons 1001 à 1003, clôtures 1004 à 1006, repère 1100, poussière 1200, brillances 1201 à 1206. */
const SCRB = { branch: 1000, closure: 1004, mark: 1100, dust: 1200 } as const;
/** Délais entre images (`11a8:0ad6` : 6 pour les objets de l'écran). */
const DELAY = 6;

/** Repère de dépôt (`DS:11f4`, premier mot de la liste) et rayon de prise (`DS:9706` = 100 : `10e0:006e`). */
const DROP_POINT: Point = { x: 438, y: 357 };
const DROP_RADIUS = 100;
/** Fin du parcours d'un essai : tête de la file (`SCRS` 7000 : dernière partie), recul d'un cran (`SCRS` 7016 : 179 → 159). */
const LINE_HEAD: Point = { x: 199, y: 120 };
const LINE_STEP = 20;
/** Fin de l'introduction du premier Zoombini (`DS:11f8`). */
const INTRO_END: Point = { x: 236, y: 395 };

/** Les 16 places d'attente du groupe (`DS:11b4`, `11a8:0ed9(1, tampon, 16)`), le membre `i` sur la place `i`. */
export const WAITING_PLACES: readonly Point[] = [
  { x: 238, y: 368 },
  { x: 185, y: 417 },
  { x: 155, y: 448 },
  { x: 197, y: 396 },
  { x: 160, y: 357 },
  { x: 164, y: 384 },
  { x: 150, y: 416 },
  { x: 116, y: 357 },
  { x: 130, y: 386 },
  { x: 109, y: 418 },
  { x: 117, y: 448 },
  { x: 74, y: 348 },
  { x: 89, y: 384 },
  { x: 67, y: 418 },
  { x: 76, y: 450 },
  { x: 56, y: 379 },
];

/** Table `DS:1420:011c…0140` : base des variantes de la planche 4000 par valeur d'attribut 1 à 5 (pieds, nez, yeux, cheveux). Les bodies sont les variantes 1 à 15 (base 0). */
export const NIZIBOOM_BASES = {
  feet: [275, 290, 305, 328, 347],
  nose: [15, 30, 45, 60, 75],
  eyes: [90, 109, 128, 147, 166],
  hair: [185, 203, 221, 239, 257],
} as const;

/** `SCRS` : attente (clignement), réaction à l'essai (type 5), enfuite (type 14), file du Zoombini, parcours d'essai, introduction. */
const SCRS = {
  blink: [4000, 4001],
  alert: 4003,
  perch: 4020,
  fleeFar: 4056,
  fleeMid: 4057,
  fleeNear: 4058,
  trial: 7000,
  trialLast: 7005,
  trialSingle: 7041,
  eject: 7010,
  back: 7015,
  intro: 7035,
} as const;
/** Événements (octet bas du terminateur − 1, `10e0:227e`). */
const EVENT = { turn: 0, alert: 4, dash: 5, perched: 6, free: 7, closure: 30, queue: 132, fleeNear: 133, fleeFar: 134, vanish: 137 } as const;
/** Attente d'un nizibooms : `+0x128` dépasse `[235c] + 16` = 80 (`10e0:0f9f`). */
const IDLE_LIMIT = 80;
/** Sortie : point hors écran à droite (`SCRS` 7026 à 7030 finissent en (657, 357)) ; écart entre départs. */
const EXIT_POINT: Point = { x: 660, y: 357 };
const EXIT_STEP = 45;

/** Un nizibooms à l'écran : une feature qui joue les `SCRS` 4000+ sur la planche 4000, aux attributs de son Zoombini transformés (`10e0:1194`). */
class Niziboom {
  readonly feature: Feature;
  /** Position de départ des scripts (`+0xa6`, `+0xa8`). */
  readonly home: Point;
  /** Décalage des scripts (`1168:3f76` : première partie − point d'ancrage). */
  private origin: Point = { x: 0, y: 0 };
  /** Sens (`+0xf2`) : 0 = comme dessiné (vers la gauche de l'écran), 1 = inverse. */
  facing: 0 | 1 = 0;
  /** Compteur d'attente (`+0x128`). */
  counter: number;
  /** Un script autre que l'attente est en cours, ou le nizibooms est parti. */
  busy = false;
  gone = false;
  private onEnd: (() => void) | undefined;

  constructor(
    private readonly run: FleensRun,
    readonly cousin: Cousin,
    private readonly sheet: Sheet,
    private readonly scripts: (id: number) => Script | undefined,
  ) {
    this.home = { x: cousin.origin[0], y: cousin.origin[1] };
    this.counter = cousin.idle;
    this.origin = this.offset(SCRS.blink[0], undefined);
    this.feature = run.features.create({
      depth: 1 + this.home.y / 1000,
      delay: DELAY,
      script: SCRS.blink[0],
      flags: FeatureFlag.other | FeatureFlag.firstImage | FeatureFlag.stopEachImage,
      source: (id) => {
        const script = scripts(id);
        return script && { script, group: 0 };
      },
      onImage: (feature, parts) => this.compose(feature, parts),
      onEvent: () => {},
    });
  }

  /** Décalage d'un script : sa première partie (image 0) tombe sur `home` ; avec `at`, sa dernière partie tombe sur `at`. */
  private offset(id: number, at: Point | undefined): Point {
    const script = this.scripts(id);
    if (!script) throw new Error(`Niziboom : SCRS ${id} introuvable`);
    const images = script.images;
    if (at) {
      const reference = [...images].reverse().find((image) => (image.cells[0]?.w ?? 0) > 0) ?? images[0];
      const first = reference?.cells[0];
      return first ? { x: at.x - first.x, y: at.y - first.y } : { x: 0, y: 0 };
    }
    const first = images[0]?.cells[0];
    return first ? { x: this.home.x - first.x, y: this.home.y - first.y } : { x: 0, y: 0 };
  }

  /** Cases d'une image (pose 3) : le corps (base 0), puis pieds, nez, yeux, cheveux par la table de leur valeur ; image `2 × variante − 1` (`2 ×` si l'objet est retourné). */
  private compose(feature: Feature, parts: FeaturePart[]): FeaturePart[] {
    const image = feature.script?.images[feature.image];
    if (!image) return parts;
    const [hair, eyes, nose, feet] = this.cousin.attrs;
    const bases = [0, NIZIBOOM_BASES.feet[feet - 1]!, NIZIBOOM_BASES.nose[nose - 1]!, NIZIBOOM_BASES.eyes[eyes - 1]!, NIZIBOOM_BASES.hair[hair - 1]!];
    const out: FeaturePart[] = [];
    for (let slot = 0; slot < image.cells.length && slot < bases.length; slot++) {
      const cell = image.cells[slot]!;
      if (cell.w <= 0) continue;
      const variant = bases[slot]! + cell.w;
      out.push({ w: 2 * variant - 1 + this.facing, x: this.origin.x + cell.x, y: this.origin.y + cell.y, sheet: this.sheet });
    }
    return out;
  }

  /** Joue un script (une fois s'il s'arrête à la fin ; `onEnd` à sa fin). Sans `at` il démarre sur `home`. */
  play(id: number, options: { at?: Point; loop?: boolean; onEnd?: () => void } = {}): void {
    if (this.gone) return;
    this.busy = true;
    this.origin = this.offset(id, options.at);
    this.onEnd = options.onEnd;
    const f = this.run.features;
    this.feature.flags = FeatureFlag.other | (options.loop ? 0 : FeatureFlag.stopAtEnd);
    this.feature.onEvent = (_image, n) => this.event(n);
    f.setScript(this.feature, id);
  }

  /** Pose d'attente : première image de `SCRS` 4000, immobile, sur `home`. */
  rest(): void {
    if (this.gone) return;
    this.busy = false;
    this.facing = 0;
    this.onEnd = undefined;
    this.origin = this.offset(SCRS.blink[0], undefined);
    this.feature.flags = FeatureFlag.other | FeatureFlag.stopEachImage;
    this.feature.onEvent = () => {};
    this.run.features.setScript(this.feature, SCRS.blink[0]);
  }

  private event(n: number): void {
    if (n === FEATURE_END) {
      const done = this.onEnd;
      this.onEnd = undefined;
      done?.();
      return;
    }
    // Événement 0 : bascule le sens du regard (`+0xf2`).
    if (n === EVENT.turn) this.facing = this.facing === 0 ? 1 : 0;
  }

  /** Retire le nizibooms de l'écran. */
  remove(): void {
    if (this.gone) return;
    this.gone = true;
    this.busy = true;
    this.run.features.destroy(this.feature);
  }
}

/** Un essai en cours ou en attente. */
interface Trial {
  member: KitMember;
}

/** Fenêtre sur l'épreuve en cours, pour les tests. */
export interface FleensProbe {
  readonly kit: PuzzleKit;
  readonly state: FleensState;
  readonly nizibooms: readonly { readonly cousin: Cousin; readonly feature: Feature; readonly gone: boolean }[];
  readonly branch: Feature;
  readonly dropTarget: DropTarget;
  /** Essai en cours (`[7338]`) et essais en attente. */
  readonly trial: KitMember | null;
  readonly pending: number;
  /** `[7384]` : l'introduction joue. */
  readonly introPlaying: boolean;
  /** Séquence de clôture lancée / terminée (`[7380]`). */
  readonly closureStarted: boolean;
  readonly level: number;
  /** Membres dans la file des essais, du plus ancien au plus récent. */
  readonly line: readonly KitMember[];
  readonly leaving: boolean;
}

export type FleensScene = Scene & { readonly probe: FleensProbe | null };

class FleensRun implements FleensProbe {
  readonly kit: PuzzleKit;
  readonly state: FleensState;
  readonly features: Features;
  readonly nizibooms: Niziboom[] = [];
  readonly branch: Feature;
  readonly dropTarget: DropTarget;
  readonly level: number;
  trial: KitMember | null = null;
  introPlaying = false;
  closureStarted = false;
  leaving = false;

  private readonly party: Zoombini[];
  private readonly pendingTrials: Trial[] = [];
  /** Essais déjà faits (un Zoombini ne se reprend pas) et file des essais (membres, du plus ancien au plus récent). */
  private readonly tried = new Set<number>();
  private readonly queue: KitMember[] = [];
  private readonly scripts: (id: number) => Script | undefined;
  private pendingPose: number | null = null;
  private finished = false;

  constructor(
    readonly ctx: SceneContext,
    archive: Archive,
  ) {
    const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
    const { game, session } = zoombinis;
    session.screen = SCREEN;
    this.level = currentLevel(game, session, SCREEN);
    openScreen(ctx, archive, { background: BACKGROUND });
    this.features = ctx.services.get(FEATURES);
    this.party = game.group.members.filter((z) => z.present).map((z) => ({ ...z, attrs: [...z.attrs] as Zoombini["attrs"], state: z.state.slice() }));
    this.scripts = screenScripts(archive);

    // Décor, dans l'ordre de `10e0:00ea` : la branche (derrière tout), le repère de dépôt, les 7 objets d'ambiance ; puis les nizibooms et les Zoombinis.
    const f = this.features;
    f.defineGroup(0, GROUP_BRANCH);
    f.defineGroup(1, GROUP_MARK);
    f.defineGroup(2, GROUP_DUST);
    f.setScripts(SCRB.branch, 7);
    f.addScripts(SCRB.mark, 1);
    f.addScripts(SCRB.dust, 7);
    const F = FeatureFlag;
    this.branch = f.create({ script: SCRB.branch, delay: DELAY, flags: F.stopAtEnd | F.active | F.firstImage });
    f.create({ script: SCRB.mark, delay: DELAY, flags: F.staticFirst | F.noReplay | F.active | F.firstImage });

    // `10e0:1b29` : règle cachée (octets 0x0C à 0x13 de la partie, conservés d'une entrée à l'autre aux niveaux 0 et 2), spéciaux, nizibooms.
    const rule = Uint8Array.from(game.fleensRule);
    this.state = prepareFleens(this.party, this.level, rule, ctx.rng);
    for (let i = 0; i < FLEENS_RULE_BYTES; i++) game.fleensRule[i] = rule[i]!;

    // Poussière (1200, une fois) et brillances (1201 à 1206, en boucle).
    f.create({ script: SCRB.dust, delay: DELAY, flags: F.flag4000000 | F.stopAtEnd | F.noReplay });
    for (let k = 1; k <= 6; k++) f.create({ script: SCRB.dust + k, delay: DELAY, flags: F.flag4000000 });

    const sheet = createSheet(archive, NIZIBOOM_SHEET, true);
    for (const cousin of this.state.cousins) this.nizibooms.push(new Niziboom(this, cousin, sheet, this.scripts));
    // Cocons déjà pleins (groupes de moins de 3 Zoombinis) : image finale du script correspondant.
    if (this.state.cocoons > 0) {
      f.setScript(this.branch, SCRB.branch + this.state.cocoons);
      f.seek(this.branch, -1);
    }

    this.dropTarget = createTarget(DROP_POINT);
    const buttons = sheetButtonImages(archive.tbmpImages(BUTTONS_SHEET));
    this.kit = createPuzzleKit(ctx, {
      screen: SCREEN,
      party: this.party,
      places: WAITING_PLACES,
      targets: () => [this.dropTarget],
      radius: DROP_RADIUS,
      snoid: { scripts: this.scripts },
      exitWalk: { ...EXIT_POINT, step: EXIT_STEP },
      buttons: {
        map: { images: buttons.map },
        go: { images: buttons.go, onPress: () => this.pressGo() },
      },
      canPick: (member) => this.canPick(member),
      decide: (drop) => this.decide(drop),
      onDrop: (drop) => this.dropped(drop),
    });
    this.kit.arrive({ startDelay: 200, step: 45 });
    // `1168:3dd0(0, 0)` : personne n'est sauvé (`+0x127 = 0`).
    this.kit.markAll(false);
    this.startIntro();
    this.kit.playMusic();

    // Voix d'aide `[a2c4]` : 20080 à la première visite du niveau 1, sinon 20079 (20079 ou 20080 aux niveaux 1 et 3).
    const slot = dialogMemoryIndex(SCREEN);
    let choice = 0;
    if (slot >= 0) {
      const result = dialogChoice(game.dialogMemory[slot]!, this.level, session.training !== 0);
      game.dialogMemory[slot] = result.memory;
      choice = result.choice;
    }
    if (choice === 2) this.kit.introVoice = 20080;
    else if (this.level === 1 || this.level === 3) this.kit.introVoice = ctx.rng.range(20079, 20080);
    else this.kit.introVoice = 20079;
    ctx.requestPresent();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Fenêtre pour les tests

  get pending(): number {
    return this.pendingTrials.length;
  }

  get line(): readonly KitMember[] {
    return this.queue;
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Introduction (`10e0:00ea` fin, `292a(1)`)

  /** Le premier Zoombini du groupe entre par `SCRS` 7035 + pieds et finit sur (236, 395) ; la saisie reste fermée (`[7384]`) jusqu'à la fin du script. */
  private startIntro(): void {
    const first = this.kit.members[0];
    if (!first) return;
    const { snoid } = first;
    this.introPlaying = true;
    snoid.onEvent = undefined;
    snoid.onEnd = () => {
      snoid.onEnd = undefined;
      this.introPlaying = false;
      snoid.idle();
    };
    snoid.play(SCRS.intro + snoid.traits.feet, FeatureFlag.stopAtEnd, { kind: "normal", at: INTRO_END });
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Prise et dépôt (`10e0:0ae5` région 3)

  /** `[7384] == 0`, `[9702] < 1`, `[7324] < 3` ; un Zoombini déjà essayé ne se reprend pas. */
  private canPick(member: KitMember): boolean {
    if (this.introPlaying || this.leaving || this.finished) return false;
    if (this.kit.walking >= 1 || !canTry(this.state)) return false;
    return !this.tried.has(member.index) && !member.snoid.destroyed;
  }

  private decide(drop: DropInfo): boolean {
    return drop.target === this.dropTarget;
  }

  /** Dépôt sur le repère : l'essai part tout de suite, ou attend la fin de celui en cours (`[7338]`). */
  private dropped(drop: DropInfo): void {
    this.pendingTrials.push({ member: drop.member });
    this.nextTrial();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Essai (`10e0:06a8`, événements de `10e0:227e`)

  private nextTrial(): void {
    if (this.trial || this.pendingTrials.length === 0) return;
    const { member } = this.pendingTrials.shift()!;
    const result = tryMember(this.state, member.index);
    if (!result) {
      // Refusé (déjà trois cocons) : il retourne à sa place d'attente.
      this.release(member);
      const place = member.waiting;
      if (place) this.kit.walk(member, { x: place.x, y: place.y }, () => (place.owner = member));
      this.nextTrial();
      return;
    }
    this.trial = member;
    this.tried.add(member.index);
    const cousin = this.nizibooms.find((n) => n.cousin.member === member.index);
    const previous = [...this.queue];
    const { snoid } = member;
    const feet = snoid.traits.feet;
    // Script d'essai : `292a(2)` (7041 + pieds pour un Zoombini seul, 7005 + pieds au troisième cocon, sinon 7000 + pieds).
    const id = (this.state.single ? SCRS.trialSingle : result.cocoons >= 3 ? SCRS.trialLast : SCRS.trial) + feet - 1;
    this.pendingPose = null;
    snoid.onEnd = () => {
      snoid.onEnd = undefined;
      this.trialEnded(member, result.done);
    };
    snoid.onEvent = (n) => this.trialEvent(n, member, cousin, result, previous);
    // Le parcours part de (438, 357) et finit à la tête de la file (199, 120) : absolu (voir l'en-tête).
    snoid.play(id, FeatureFlag.stopAtEnd, { kind: "normal", at: LINE_HEAD });
    this.queue.push(member);
  }

  private trialEvent(n: number, member: KitMember, cousin: Niziboom | undefined, result: { special: boolean; cocoons: number; ejected: number | null }, previous: KitMember[]): void {
    const { snoid } = member;
    switch (n) {
      case EVENT.turn:
        // Bascule du regard, puis pose en attente (`+0xf2`, `1168:4dc9`).
        snoid.setFacing(snoid.facing === 0 ? 1 : 0);
        if (this.pendingPose !== null) {
          snoid.setPose(this.pendingPose);
          this.pendingPose = null;
        }
        break;
      case EVENT.alert:
        // Essai manqué : le cousin de la terrasse se tourne vers le Zoombini (type 5).
        if (cousin && !result.special && !cousin.busy && !cousin.gone) cousin.play(SCRS.alert, { onEnd: () => cousin.rest() });
        break;
      case EVENT.perched:
        if (result.special) this.cocoon(cousin, result.cocoons);
        break;
      case EVENT.free:
        // `1168:170f(1, 0)` : le repère se libère.
        this.release(member);
        break;
      case EVENT.queue:
        this.advanceLine(previous, result.ejected);
        break;
      case EVENT.fleeNear:
        this.flee((c) => c.position < 4);
        break;
      case EVENT.fleeFar:
        this.flee((c) => c.position >= 4 && c.position < 17);
        break;
      case EVENT.closure:
        this.startClosure();
        break;
      case EVENT.vanish:
        // `+0xE0 = 0` : le Zoombini seul disparaît avec son cousin (perdu, voir `tryMember`) ; il finit son script sans être dessiné.
        snoid.feature.flags |= FeatureFlag.noDraw;
        this.features.invalidate();
        break;
      default:
        if (n >= 240 && n <= 243) this.pendingPose = n - 239;
        else if (n >= 250 && n <= 253) snoid.setPose(n - 250);
    }
  }

  private release(member: KitMember): void {
    if (this.dropTarget.owner === member) this.dropTarget.owner = null;
    if (member.target === this.dropTarget) member.target = null;
  }

  /** Le cocon se remplit (`SCRB` 1000 + cocons) et le cousin perché s'en va (types 7 puis 8). */
  private cocoon(cousin: Niziboom | undefined, cocoons: number): void {
    this.features.setScript(this.branch, SCRB.branch + cocoons);
    if (!cousin || cousin.gone) return;
    const k = cousin.cousin.position - 17;
    cousin.play(SCRS.perch + 2 * k, {
      onEnd: () => cousin.play(SCRS.perch + 2 * k + 1, { onEnd: () => cousin.remove() }),
    });
  }

  /** Événement 132 : les essais précédents reculent d'un cran ; avec 7 essais le plus ancien sort à gauche (`SCRS` 7010, puis 7010 + pieds). */
  private advanceLine(previous: KitMember[], ejected: number | null): void {
    const alive = previous.filter((m) => !m.snoid.destroyed);
    alive.forEach((m) => {
      const at = { x: m.snoid.position.x - LINE_STEP, y: m.snoid.position.y };
      const { snoid } = m;
      const gone = ejected !== null && m.index === ejected;
      snoid.onEvent = undefined;
      snoid.onEnd = () => {
        snoid.onEnd = undefined;
        if (gone) this.leaveLeft(m);
        else snoid.idle();
      };
      snoid.play(SCRS.back + snoid.traits.feet, FeatureFlag.stopAtEnd, { kind: "normal", at });
    });
    if (ejected !== null) {
      const index = this.queue.findIndex((m) => m.index === ejected);
      if (index >= 0) this.queue.splice(index, 1);
    }
  }

  private leaveLeft(member: KitMember): void {
    const { snoid } = member;
    snoid.onEnd = () => {
      snoid.onEnd = undefined;
      snoid.onEnd = () => {
        snoid.onEnd = undefined;
        snoid.destroy();
      };
      snoid.play(SCRS.eject + snoid.traits.feet, FeatureFlag.stopAtEnd, { kind: "normal" });
    };
    snoid.play(SCRS.eject, FeatureFlag.stopAtEnd, { kind: "normal", at: { ...snoid.position } });
  }

  /** Fin de l'essai (événement −1) : le verrou tombe ; trois cocons sans événement 30 (Zoombini seul) : la clôture démarre. */
  private trialEnded(member: KitMember, done: boolean): void {
    const { snoid } = member;
    snoid.setFacing(0);
    snoid.setPose(null);
    snoid.onEvent = undefined;
    if (this.state.vanished.includes(member.index)) snoid.destroy();
    else if (!snoid.destroyed) snoid.idle();
    this.trial = null;
    if (done && !this.closureStarted) this.startClosure();
    this.nextTrial();
  }

  /** Les nizibooms de la terrasse s'enfuient (`1fd1(14)` : `SCRS` 4058 avant la position 4, 4057 avant 12, sinon 4056), puis disparaissent. */
  private flee(select: (cousin: Cousin) => boolean): void {
    for (const niz of this.nizibooms) {
      const c = niz.cousin;
      if (niz.gone || niz.busy || c.special || !select(c)) continue;
      const id = c.position < 4 ? SCRS.fleeNear : c.position < 12 ? SCRS.fleeMid : SCRS.fleeFar;
      niz.play(id, { onEnd: () => niz.remove() });
    }
  }

  // --- Clôture (`10e0:2f0d`) ---

  private startClosure(): void {
    if (this.closureStarted) return;
    this.closureStarted = true;
    this.flee(() => true);
    const f = this.features;
    const id = SCRB.closure + this.ctx.rng.range(0, 2);
    const closure: Feature = f.create({
      script: id,
      delay: DELAY,
      flags: FeatureFlag.flag4000000 | FeatureFlag.stopAtEnd | FeatureFlag.active,
      onEvent: (_image, n) => {
        if (n === FEATURE_END) {
          f.destroy(closure);
          this.closed();
        }
      },
    });
  }

  /** Fin de la clôture (`[7380] = 1`) : « Go » actif, tout le groupe est sauvé (`3dd0(0, 1)`), commentaire. */
  private closed(): void {
    endClosure(this.state);
    this.saveAll();
    this.kit.goEnabled = canGo(this.state);
    if (this.state.vanished.length === 0) {
      this.kit.playSuccessVoice();
      return;
    }
    // Un disparu : commentaire de regret si `rand(0..4) ≤ niveau` ou plus de trois visites (`S+0x38 & 0xFFF`).
    const { game } = this.ctx.services.get(ZOOMBINIS_GAME);
    const slot = dialogMemoryIndex(SCREEN);
    const visits = slot >= 0 ? game.dialogMemory[slot]! & 0xfff : 0;
    if (this.ctx.rng.range(0, 4) <= this.level || visits > 3) this.kit.playRegretVoice();
  }

  /** `1168:3dd0(0, 1)` puis les disparus (événement 137) ne comptent pas. */
  private saveAll(): void {
    this.kit.markAll(true);
    const exit = goExit(this.state);
    const lost = exit ? exit.lost : this.state.vanished;
    for (const index of lost) {
      const member = this.kit.members[index];
      if (member) member.zoombini.present = false;
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Tick (`10e0:06a8`)

  tick(): void {
    this.kit.tick();
    if (this.finished || this.kit.finishing || this.kit.left) return;
    if (this.ctx.services.tryGet(DIALOG)?.isOpen) return;
    this.tickIdle();
    this.nextTrial();
  }

  /** Attente individuelle (`10e0:0f9f`) : compteur `+0x128` ; passé 80, `rand(1..100) < 51` joue `SCRS` 4000, sinon 4001, puis le compteur repart à 1. Rien pendant un essai (`[235c] = 0`). */
  private tickIdle(): void {
    if (this.trial || this.pendingTrials.length > 0 || this.closureStarted) return;
    for (const niz of this.nizibooms) {
      if (niz.gone || niz.busy) continue;
      niz.counter += 1;
      if (niz.counter <= IDLE_LIMIT) continue;
      niz.counter = 1;
      const id = this.ctx.rng.range(1, 100) < 51 ? SCRS.blink[0] : SCRS.blink[1];
      niz.play(id, { onEnd: () => niz.rest() });
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // « Go » (`10e0:0ae5` région 2)

  /** Actif seulement avec trois cocons et la clôture finie (le kit grise le bouton sinon) : le groupe sauvé part à pied. */
  private pressGo(): boolean {
    if (!canGo(this.state) || this.leaving) return true;
    this.leaving = true;
    this.saveAll();
    this.kit.pressGo();
    return true;
  }

  leaveScene(): void {
    this.kit.leave();
  }
}

/** Écran des nizibooms (`FLEENS.MHK`, écran 13). */
export function createFleensScene(): FleensScene {
  const name = screenInfo(SCREEN)?.archive;
  if (!name) throw new Error("createFleensScene : pas d'archive pour l'écran 13");
  let archive: Archive;
  let run: FleensRun | null = null;
  return {
    get probe() {
      return run;
    },
    async load(ctx: SceneContext) {
      archive = await ctx.resources.open(name);
    },
    enter(ctx: SceneContext) {
      run = new FleensRun(ctx, archive);
    },
    leave(ctx: SceneContext) {
      run?.leaveScene();
      run = null;
      closeScreen(ctx);
    },
    tick() {
      run?.tick();
    },
    key(event, ctx: SceneContext) {
      if (!run || run.kit.left) return false;
      if (event.ctrl || event.alt) return false;
      if (ctx.services.tryGet(DIALOG)?.isOpen) return false;
      return run.kit.key(event);
    },
  };
}
