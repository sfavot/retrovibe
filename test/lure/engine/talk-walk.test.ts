import { describe, expect, it } from "vitest";
import { MAX_TALK_SELECTIONS, talkAskedKeys } from "../../../src/games/lure/engine/talk";
import { HotspotId } from "../../../src/games/lure/engine/ids";
import { Driver, hasOriginalFiles, makeEngine } from "./test-host";
import { speakerOf, walkConversation } from "./talk-helpers";

/**
 * Chaque dialogue de `0x3F12` (226) se parcourt sur les vrais fichiers : une partie neuve par dialogue, le personnage qui le cite dans
 * `0x3F11` (sinon Ratpouch) dans la pièce du joueur, et le joueur choisit à chaque écran l'option la moins choisie jusqu'à ce que toutes
 * celles qui ont été montrées l'aient été (douze passes au plus : une option n'est montrée que si sa condition est vraie dans l'état du
 * jeu, qu'un dialogue seul ne change pas toujours).
 */

/** Dialogues dont aucune option n'est montrée dans l'état du début du jeu : ScummVM planterait (pointeur nul), le moteur lève. */
const NO_OPTION_AT_START = new Set([0xddcc, 0xe5c2, 0xeaaa]);
/** Dialogue dont une séquence exige Goewin active (elle ne l'est qu'avec sa vague, L4) : l'erreur est celle de `requireActiveHotspot`. */
const NEEDS_GOEWIN = new Map([[0xd99e, /hotspot 3ef inactif/]]);
/** Goewin (3EF) n'est pas dans une animation valide hors de ses pièces : Ratpouch parle à sa place (seul le locuteur change). */
const GOEWIN = 0x3ef;

interface Report {
  id: number;
  entries: number;
  chosen: number;
  passes: number;
  ended: boolean;
  maxLines: number;
  oneTimeShownAgain: number[];
  error: string;
}

function explore(recordId: number): Report {
  const { engine, host } = makeEngine();
  new Driver(engine, host).ticks(3);
  const record = engine.data.talk.records.find((r) => r.recordId === recordId)!;
  let speaker = speakerOf(engine, recordId);
  if (speaker === GOEWIN) speaker = HotspotId.RATPOUCH;
  const counts = new Map<number, number>();
  const shown = new Set<number>();
  const picked = new Set<number>();
  const report: Report = { id: recordId, entries: record.entries.length, chosen: 0, passes: 0, ended: true, maxLines: 0, oneTimeShownAgain: [], error: "" };
  const oneTime = (k: number): boolean => (record.entries[k]!.descId & 0xc000) === 0x8000;
  try {
    for (; report.passes < 12; report.passes++) {
      const pickedBefore = new Set(picked);
      const r = walkConversation(engine, host, recordId, speaker, (lines, indexes) => {
        report.maxLines = Math.max(report.maxLines, lines.length);
        // Une option à usage unique déjà choisie dans un passage précédent ne revient pas.
        for (const k of indexes) if (oneTime(k) && pickedBefore.has(k)) report.oneTimeShownAgain.push(k);
        let best = 0;
        for (let i = 1; i < indexes.length; i++) if ((counts.get(indexes[i]!) ?? 0) < (counts.get(indexes[best]!) ?? 0)) best = i;
        const k = indexes[best]!;
        counts.set(k, (counts.get(k) ?? 0) + 1);
        picked.add(k);
        return best;
      });
      for (const k of r.shown) shown.add(k);
      if (!r.ended) report.ended = false;
      if ([...shown].every((k) => picked.has(k))) break;
    }
  } catch (e) {
    report.error = (e as Error).message;
  }
  report.chosen = talkAskedKeys(engine).filter((k) => Math.floor(k / 1024) === recordId).length;
  return report;
}

describe.skipIf(!hasOriginalFiles)("tous les dialogues de 0x3F11 / 0x3F12", () => {
  const reports: Report[] = [];

  it("se parcourent sans erreur ni boucle infinie", () => {
    const ids = makeEngine().engine.data.talk.records.map((r) => r.recordId);
    expect(ids).toHaveLength(226);
    for (const id of ids) reports.push(explore(id));

    const failed = reports.filter((r) => r.error !== "" && !NO_OPTION_AT_START.has(r.id) && !NEEDS_GOEWIN.get(r.id)?.test(r.error));
    expect(failed.map((r) => `${r.id.toString(16)} : ${r.error}`)).toEqual([]);
    for (const id of NO_OPTION_AT_START) expect(reports.find((r) => r.id === id)!.error).toMatch(/aucune option/);
    expect(reports.filter((r) => !r.ended).map((r) => r.id.toString(16))).toEqual([]);
  }, 120_000);

  it("au plus quatre lignes de choix à la fois (`MAX_TALK_SELECTIONS` : ScummVM n'en dessine pas plus)", () => {
    expect(Math.max(...reports.map((r) => r.maxLines))).toBeLessThanOrEqual(MAX_TALK_SELECTIONS);
  });

  it("une option à usage unique (bits 15 et 14 : posé au premier choix) ne revient pas", () => {
    expect(reports.flatMap((r) => r.oneTimeShownAgain.map((k) => `${r.id.toString(16)}#${k}`))).toEqual([]);
  });

  it("couverture : la grande majorité des entrées est choisie dès l'état du début du jeu", () => {
    const ok = reports.filter((r) => r.error === "");
    expect(ok.length).toBeGreaterThan(200);
    const entries = ok.reduce((n, r) => n + r.entries, 0);
    const chosen = ok.reduce((n, r) => n + r.chosen, 0);
    // Les autres ont une condition (pré-séquence) fausse au début du jeu : elles dépendent de ce que le joueur a fait avant.
    expect(chosen / entries).toBeGreaterThan(0.75);
  });
});
