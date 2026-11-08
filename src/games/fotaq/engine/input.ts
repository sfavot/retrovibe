/**
 * Entrées du moteur (`docs/fotaq/engine.md`, § 4) : souris, verbe tapé au clavier, demandes de passer une cinématique ou une
 * réplique. Réécriture de `Input` (engines/queen/input.cpp, input.h, ScummVM).
 *
 * Comme ScummVM : un appui de bouton s'ajoute au masque `mouseButton` jusqu'à ce que la commande le lise (`updatePlayer`) ; la
 * dernière action reçue pendant une image (`_inKey`) est traduite par `checkKeys` une fois par image en un verbe (`keyVerb`) ou en
 * demande de passage (`cutawayQuit`, `talkQuit`). Un clic droit pendant un dialogue le passe (`talkQuit`).
 *
 * Écarts : le mode rapide n'est activé que par la logique de la vague L (pas de touche) ; pas d'économiseur d'écran ; la sauvegarde rapide de ScummVM est laissée à l'hôte.
 */

import type { FotaqAction, FotaqInput } from "./host";
import { MouseButton } from "./host";
import { Verb } from "./state";

/** Verbe tapé de chaque action (`Input::_verbActions` et `checkKeys`). */
const ACTION_VERBS: Partial<Record<FotaqAction, number>> = {
  open: Verb.Open,
  close: Verb.Close,
  move: Verb.Move,
  give: Verb.Give,
  look: Verb.LookAt,
  pickUp: Verb.PickUp,
  talk: Verb.TalkTo,
  use: Verb.Use,
  inventory1: Verb.Inventory1,
  inventory2: Verb.Inventory1 + 1,
  inventory3: Verb.Inventory1 + 2,
  inventory4: Verb.Inventory4,
  scrollUp: Verb.ScrollUp,
  scrollDown: Verb.ScrollDown,
  skipText: Verb.SkipText,
};

export class Input {
  /** Position de la souris (écran 320 x 200). */
  mouseX = 0;
  mouseY = 0;
  /** Appuis non encore lus (`_mouseButton`, masque de `MouseButton`). */
  mouseButton = 0;
  /** Verbe tapé au clavier (`_keyVerb`). */
  keyVerb: number = Verb.None;
  /** Une cinématique est en cours (`_cutawayRunning`) : la commande du joueur est suspendue. */
  cutawayRunning = false;
  /** La cinématique ou le dialogue en cours peut être passé (`_canQuit`). */
  canQuit = false;
  /** Passage de la cinématique demandé (`_cutawayQuit`) ; remis à faux par la cinématique à sa fin. */
  cutawayQuit = false;
  /** Un dialogue est en cours (`_dialogueRunning`, Joe en mode `Speak`). */
  dialogueRunning = false;
  /** Passage du dialogue ou de la réplique demandé (`_talkQuit`) ; remis à faux par le dialogue. */
  talkQuit = false;
  /** Mode rapide (`_fastMode`) : les panoramiques de l'introduction vont dix fois plus vite (`fastMode`, `FAST_RATIO`). */
  fastMode = false;
  private buttons = 0;
  private inKey: FotaqAction | null = null;

  /** Un appui sur Échap aurait un effet (`checkKeys`) : cinématique ou dialogue en cours, et passable. */
  get canSkip(): boolean {
    return this.canQuit && (this.cutawayRunning || this.dialogueRunning);
  }

  /** Reçoit les entrées de l'hôte (`Input::delay`). */
  receive(events: readonly FotaqInput[]): void {
    for (const event of events) {
      if (event.type === "action") {
        this.inKey = event.action;
        continue;
      }
      this.mouseX = event.x;
      this.mouseY = event.y;
      const pressed = event.buttons & ~this.buttons;
      this.buttons = event.buttons;
      if (pressed & MouseButton.Left) this.mouseButton |= MouseButton.Left;
      if (pressed & MouseButton.Right) {
        this.mouseButton |= MouseButton.Right;
        if (this.dialogueRunning) this.talkQuit = true;
      }
    }
  }

  /** Traduit l'action reçue pendant l'image (`Input::checkKeys`), une fois par image. */
  checkKeys(): void {
    const action = this.inKey;
    this.inKey = null;
    if (action === null) return;
    if (action === "skipCutaway") {
      if (this.canQuit) {
        if (this.cutawayRunning) this.cutawayQuit = true;
        if (this.dialogueRunning) this.talkQuit = true;
      }
    } else if (action === "journal") {
      if (this.cutawayRunning) {
        if (this.canQuit) {
          this.keyVerb = Verb.UseJournal;
          this.cutawayQuit = true;
          this.talkQuit = true;
        }
      } else {
        this.keyVerb = Verb.UseJournal;
        if (this.canQuit) this.talkQuit = true;
      }
    } else {
      this.keyVerb = ACTION_VERBS[action] ?? Verb.None;
    }
  }

  /**
   * Remet à zéro tout ce qui est en cours (chargement d'une partie) : appuis non lus, verbe tapé, cinématique, dialogue, mode rapide.
   * La position et l'état des boutons de la souris sont ceux de la main de la joueuse : ils restent.
   */
  reset(): void {
    this.mouseButton = 0;
    this.keyVerb = Verb.None;
    this.cutawayRunning = false;
    this.canQuit = false;
    this.cutawayQuit = false;
    this.dialogueRunning = false;
    this.talkQuit = false;
    this.fastMode = false;
    this.inKey = null;
  }

  /** Lit et efface les appuis de souris (`mouseButton` puis `clearMouseButton`). */
  takeMouseButton(): number {
    const pressed = this.mouseButton;
    this.mouseButton = 0;
    return pressed;
  }

  /** Une demande de passage est en cours (lue par le `SequenceRunner` dans les parties sautables). */
  skipRequested(): boolean {
    return this.cutawayQuit || this.talkQuit;
  }
}
