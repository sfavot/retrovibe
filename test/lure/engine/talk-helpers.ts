import type { LureEngine } from "../../../src/games/lure/engine/game";
import { HotspotId, TickProc } from "../../../src/games/lure/engine/ids";
import { startTalk } from "../../../src/games/lure/engine/verbs";
import { talkSelectView } from "../../../src/games/lure/engine/talk";
import { TalkState } from "../../../src/games/lure/engine/world";
import { Driver, type TestHost } from "./test-host";

/** Personnage qui cite le dialogue dans `0x3F11`, sinon `fallback` (dialogues imposés par un script ou « Donne »). */
export function speakerOf(engine: LureEngine, recordId: number, fallback: number = HotspotId.RATPOUCH): number {
  for (const h of engine.data.talkHeaders.headers) if (h.entries.includes(recordId)) return h.hotspotId;
  return fallback;
}

export interface WalkResult {
  /** Conversation terminée (`talkState` revenu à `NONE`). */
  ended: boolean;
  ticks: number;
  /** Rangs des entrées choisies, dans l'ordre. */
  picked: number[];
  /** Rangs des entrées montrées sur un écran de choix. */
  shown: Set<number>;
  /** Nombre d'écrans de choix. */
  screens: number;
}

/**
 * Place le personnage dans la pièce du joueur et lance le dialogue `recordId`. `choose(count, lines, counts)` rend le rang (0 à count - 1)
 * de l'option à prendre sur l'écran de choix. Les boîtes de texte sont fermées d'un clic.
 */
export function startConversation(engine: LureEngine, speaker: number, recordId: number): void {
  const world = engine.world;
  const character = world.requireHotspot(speaker);
  character.roomNumber = engine.room.roomNumber;
  if (!world.getActiveHotspot(speaker)) world.activateHotspot(speaker);
  // Les gestionnaires propres aux personnages (vague L) sont encore des souches qui ne comptent pas la bulle à rebours (`handleTalkDialog`) :
  // le personnage de test prend le gestionnaire standard, qui le fait et le retient pendant la conversation.
  world.requireActiveHotspot(speaker).setTickProc(TickProc.STANDARD_CHARACTER);
  const player = world.requireActiveHotspot(HotspotId.PLAYER);
  startTalk(engine, player, character, recordId);
}

export function walkConversation(
  engine: LureEngine,
  host: TestHost,
  recordId: number,
  speaker: number,
  choose: (labels: string[], recordEntryIndexes: number[]) => number,
  maxTicks = 6000,
): WalkResult {
  const d = new Driver(engine, host);
  const result: WalkResult = { ended: false, ticks: 0, picked: [], shown: new Set(), screens: 0 };
  startConversation(engine, speaker, recordId);
  const world = engine.world;
  for (let i = 0; i < maxTicks; i++) {
    result.ticks++;
    if (engine.dialogText !== null) {
      d.click(160, 100);
      continue;
    }
    if (engine.busy) {
      d.click(160, 100);
      continue;
    }
    if (world.talkState === TalkState.SELECT) {
      const view = talkSelectView(engine)!;
      const indexes = view.entries;
      result.screens++;
      for (const k of indexes) result.shown.add(k);
      const pick = choose(view.lines, indexes);
      result.picked.push(indexes[pick]!);
      d.click(10, (pick + 1) * 8 + 2);
      continue;
    }
    engine.tick();
    if (world.talkState === TalkState.NONE && world.activeTalkData === null) {
      result.ended = true;
      break;
    }
  }
  return result;
}
