/**
 * Table des gestionnaires de tick (nom de fonction vers code), assemblée à partir des tables de groupe (`group-N/index.ts`) et des
 * gestionnaires du cœur (joueur `player.ts`, personnages autonomes `character.ts`). Une fonction fournie deux fois est refusée ; une
 * fonction du catalogue que personne ne fournit devient une **souche** qui journalise son premier appel pour chaque hotspot (elle
 * tourne à chaque image) et ne fait rien d'autre ; un numéro hors catalogue est l'erreur « Unknown tick proc » de ScummVM.
 *
 * Source (ScummVM, GPL v3+) : `HotspotTickHandlers::getHandler` (engines/lure/hotspots.cpp).
 *
 * Convention de la vague L : comme `methods/index.ts` (`HANDLER_GROUPS`, un dossier par groupe, assemblage par le coordinateur).
 */

import type { LureContext } from "../context";
import type { Hotspot } from "../hotspot";
import { HANDLER_CATALOG, handlerInfo } from "./catalog";
import { GROUP_1_HANDLERS } from "./group-1/index";
import { GROUP_3_HANDLERS } from "./group-3/index";
import { GROUP_4_HANDLERS } from "./group-4/index";
import { GROUP_2_HANDLERS } from "./group-2/index";
import { CHARACTER_HANDLERS } from "./character";
import { PLAYER_HANDLERS } from "./player";
import { FIGHT_HANDLERS } from "../fights/index";
import { TALK_HANDLERS } from "../talk";

export type TickHandler = (ctx: LureContext, h: Hotspot) => void;

/** Table d'un groupe : nom de la fonction de ScummVM vers code. */
export type HandlerGroupTable = Readonly<Partial<Record<string, TickHandler>>>;

export const HANDLER_GROUPS: readonly HandlerGroupTable[] = [GROUP_1_HANDLERS, GROUP_3_HANDLERS, GROUP_4_HANDLERS, GROUP_2_HANDLERS, PLAYER_HANDLERS, CHARACTER_HANDLERS, TALK_HANDLERS, FIGHT_HANDLERS];

export class HandlerTable {
  private readonly byName = new Map<string, TickHandler>();
  private readonly stubbed = new Set<string>();
  private readonly logged = new Set<string>();

  constructor(
    private readonly ctx: LureContext,
    groups: readonly HandlerGroupTable[] = HANDLER_GROUPS,
  ) {
    for (const group of groups) {
      for (const [name, fn] of Object.entries(group)) {
        if (!fn) continue;
        if (!HANDLER_CATALOG.some((h) => h.name === name)) throw new Error(`gestionnaire ${name} hors du catalogue`);
        if (this.byName.has(name)) throw new Error(`gestionnaire ${name} fourni deux fois`);
        this.byName.set(name, fn);
      }
    }
    for (const info of HANDLER_CATALOG) {
      if (this.byName.has(info.name)) continue;
      this.stubbed.add(info.name);
      this.byName.set(info.name, (_c, h) => this.stub(info.name, info.group, h));
    }
  }

  /** Fonctions encore en souche. */
  get stubs(): string[] {
    return [...this.stubbed].sort();
  }

  /** `getHandler(id)` : lève pour un numéro inconnu, comme ScummVM. */
  check(id: number): void {
    if (!handlerInfo(id)) throw new Error(`gestionnaire de tick ${id} inconnu`);
  }

  run(id: number, h: Hotspot): void {
    const info = handlerInfo(id);
    if (!info) throw new Error(`gestionnaire de tick ${id} inconnu`);
    this.byName.get(info.name)!(this.ctx, h);
  }

  /** Appelle une fonction par son nom (un gestionnaire qui en appelle un autre : `jailorAnimHandler` → `standardCharacterAnimHandler`). */
  call(name: string, h: Hotspot): void {
    const fn = this.byName.get(name);
    if (!fn) throw new Error(`gestionnaire ${name} inconnu`);
    fn(this.ctx, h);
  }

  private stub(name: string, group: string, h: Hotspot): void {
    const key = `${name}:${h.hotspotId}`;
    if (this.logged.has(key)) return;
    this.logged.add(key);
    this.ctx.journal.log(`gestionnaire ${name} (${group}) non porté : hotspot ${h.hotspotId.toString(16)}`);
  }
}
