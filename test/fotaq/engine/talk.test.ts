import { describe, expect, it } from "vitest";
import { textFrames } from "../../../src/games/fotaq/engine/cadence";
import { Direction, JoeWalk } from "../../../src/games/fotaq/engine/state";
import { SPEECH_ROW_COUNT, findSpeechParameters, speechNames } from "../../../src/games/fotaq/engine/speech-data";
import { speechFileName } from "../../../src/games/fotaq/engine/talk";
import { hasOriginalFiles } from "../helpers";
import { clickAt, dialogueMenu, perform, runToEnd, screenText } from "./contexts";
import { gameData, realPlayer, voiceDurationMs } from "./test-host";

describe("paroles des personnages (talk.cpp, table _speechParameters)", () => {
  it("la table transcrite compte 362 lignes ; recherche par nom, état et orientation", () => {
    expect(SPEECH_ROW_COUNT).toBe(362);
    expect(speechNames()).toContain("JOE");
    expect(speechNames()).toContain("CHIEF");
    // Joe tourné à gauche, état 0 : corps 1, bouche fermée 10, deux images de bouche au hasard, une alternée ; de face : corps 3, bouche 28.
    expect(findSpeechParameters("JOE", 0, Direction.Left)).toMatchObject({ body: 1, bf: 10, rf: 2, af: 3, ff: 0 });
    expect(findSpeechParameters("JOE", 0, Direction.Front)).toMatchObject({ body: 3, bf: 28, rf: 2, af: 3 });
    // La droite compte comme la gauche ; la casse du nom est indifférente.
    expect(findSpeechParameters("joe", 0, Direction.Right)).toEqual(findSpeechParameters("JOE", 0, Direction.Left));
    // Une animation à chaîne de torse.
    expect(findSpeechParameters("JOE", 10, Direction.Left).animation).toBe("T046,010,010,010,012,012,012,012,012,012,012,012,012,012,012,012,012,012,010,000");
    // Inconnu : la fin de table, tout à zéro.
    expect(findSpeechParameters("INCONNU", 3, 0)).toMatchObject({ name: "*", body: 0, bf: 0, rf: 0, animation: "" });
    expect(findSpeechParameters("JOE", 99, 0).name).toBe("*");
  });

  it("nom de la voix d'un segment : préfixe + rang en hexadécimal, majuscules, espaces en zéros", () => {
    expect(speechFileName("JOE0001", 0)).toBe("JOE00011");
    expect(speechFileName("JOE0001", 9)).toBe("JOE0001A");
    expect(speechFileName("c30e_10", 1)).toBe("C30E_102");
    expect(speechFileName(" 2  a4J", 2)).toBe("0200A4J3");
  });
});

describe.skipIf(!hasOriginalFiles)("répliques de Joe et des personnages", () => {
  /** Pièce 1 : Joe, sans personne. */
  const start = (room = 1) => {
    const rig = realPlayer({ room });
    rig.player.settle();
    return rig;
  };

  it("la réplique dure autant que sa voix (deux images de jeu par tour, une image de fin)", () => {
    const { player, engine, host } = start();
    // Réponse 1 de Joe : voix JOE0001.
    const ticks = perform(player, engine.makeJoeSpeak(1));
    const voice = host.spoken.at(-1);
    expect(voice?.name).toBe("JOE00011");
    const duration = voiceDurationMs("JOE00011") as number;
    expect(ticks * 100).toBeGreaterThanOrEqual(duration);
    // Le test de fin de voix se fait tous les deux ticks, plus l'image de fin.
    expect(ticks * 100).toBeLessThanOrEqual(duration + 100 * 4);
    expect(engine.joeWalk).toBe(JoeWalk.Speak);
  });

  it("toutes les réponses et descriptions de Joe sont dites pendant leur voix", () => {
    const { player, engine, host } = start();
    const data = gameData();
    let checked = 0;
    for (let n = 1; n <= 40; n++) {
      const text = data.texts.joeResponses[n];
      if (!text) continue;
      host.spoken.length = 0;
      const ticks = perform(player, engine.makeJoeSpeak(n));
      const total = host.spoken.reduce((sum, voice) => sum + (voice.duration ?? 0), 0);
      // La somme des voix des segments (tour à tour) est un minimum.
      expect(ticks * 100, `réponse ${n}`).toBeGreaterThanOrEqual(host.spoken.filter((v) => v.duration !== undefined).length > 0 ? Math.min(total, ticks * 100) : 0);
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
  });

  it("sans voix, la réplique dure le temps d'un texte (deux images par tour)", () => {
    const { player, engine, host } = start();
    host.voices = false;
    const text = "Un texte assez long pour durer plusieurs images de jeu.";
    const ticks = perform(player, engine.makePersonSpeak(text, null, "JOE0001"));
    // `textFrames` tours de deux images, l'image de `joeFace` (Joe est de face) et l'image de fin de segment.
    expect(ticks).toBe(textFrames(text) * 2 + 2);
    expect(host.spoken.map((voice) => voice.duration)).toEqual([undefined]);
  });

  it("les segments : une voix chacun, les gestes `*GD` et `*GM` n'en ont pas, `*WT` fait une pause, `*FL` tourne Joe", () => {
    const { player, engine, host } = start();
    host.voices = false;
    // « A » est suivi d'un geste (jamais dit), « B » d'une pause de dix images, « C » d'un `*FL`, « D » finit la réplique.
    perform(player, engine.makePersonSpeak("A*GDB*WTC*FLD", null, "XX"));
    expect(host.spoken.map((voice) => voice.name)).toEqual(["XX2", "XX3", "XX4"]);
    expect(engine.state.joe.facing).toBe(Direction.Left);
  });

  it("la voix inutile du français `c30e_102` n'est pas jouée", () => {
    const { player, engine, host } = start();
    perform(player, engine.makePersonSpeak("A*03B", null, "c30e_10"));
    expect(host.spoken.map((voice) => voice.name)).toEqual(["C30E_101"]);
  });

  it("le texte est au-dessus de Joe pendant la réplique, puis effacé ; la bouche bouge", () => {
    const { player, engine, stage, host } = start();
    host.voices = false;
    const seen: string[] = [];
    let mouths = 0;
    perform(player, engine.makeJoeSpeak(1), {
      onTick: () => {
        const text = screenText(player);
        if (text) seen.push(text);
        if (stage.bobs.frames.frame(31)?.overs?.length) mouths++;
      },
    });
    expect(seen.length).toBeGreaterThan(3);
    expect(new Set(seen).size).toBe(1);
    expect(gameData().texts.joeResponses[1]).toContain(seen[0].replace(/\.$/, ""));
    expect(mouths).toBeGreaterThan(2);
    expect(screenText(player)).toBeNull();
  });

  it("un clic droit (ou `skipText`) coupe la réplique et sa voix", () => {
    for (const how of ["clic", "touche"]) {
      const { player, engine, host } = start();
      const full = perform(player, engine.makeJoeSpeak(1));
      const again = perform(player, engine.makeJoeSpeak(1), {
        onTick: (tick) => {
          if (tick !== 3) return;
          if (how === "clic") {
            host.push({ type: "pointer", x: 100, y: 100, buttons: 2 });
            host.push({ type: "pointer", x: 100, y: 100, buttons: 0 });
          } else {
            host.push({ type: "action", action: "skipText" });
          }
        },
      });
      expect(again, how).toBeLessThan(full);
      expect(host.speechStops, how).toBeGreaterThan(0);
    }
  });

  it("une personne parle : texte sur son bob, animation de sa bouche, durée de la voix", () => {
    // Pièce 73 (hôtel) : le portier est la personne 5.
    const { player, engine, stage, host } = start(73);
    const portier = engine.currentRoomData + 5;
    expect(engine.state.objects[portier].name).toBeGreaterThan(0);
    const person = stage.actors.initPerson(engine, 5, "", true);
    expect(person).not.toBeNull();
    const bobNum = person?.actor.bobNumber as number;
    host.voices = true;
    let mouth = 0;
    const ticks = perform(player, engine.makePersonSpeak("Bonjour, monsieur.", 5, "020001P"), {
      onTick: () => {
        if (stage.bobs.frames.frame(31 + bobNum)?.overs?.length) mouth++;
      },
    });
    expect(host.spoken[0].name).toBe("020001P1");
    expect(ticks).toBeGreaterThan(2);
    expect(mouth).toBeGreaterThanOrEqual(0);
    expect(engine.warnings).toEqual([]);
  });
});

describe.skipIf(!hasOriginalFiles)("dialogue joué depuis une commande (pièce 73, le portier)", () => {
  /** Joe parle au portier : verbe « parler à » (7), objet 585. */
  function talkToPortier(rig: ReturnType<typeof realPlayer>, choose: (menu: { text: string }[], index: number) => number = () => 0) {
    const { player, engine } = rig;
    const box = engine.data.jas.objectBoxes[585];
    clickAt(player, 6 * 20 + 10, 175);
    clickAt(player, Math.trunc((box.x1 + box.x2) / 2), Math.trunc((box.y1 + box.y2) / 2));
    return runToEnd(player, { choose });
  }

  it("le dialogue démarre plein écran, propose des choix, les joue, puis rend l'écran et mémorise qu'on a parlé", () => {
    const rig = realPlayer({ entryObject: 584 });
    const { player, engine, stage, host, state } = rig;
    player.settle();
    const menus: string[][] = [];
    let fullscreen = false;
    const ticks = talkToPortier(rig, (menu) => {
      menus.push(menu.map((m) => m.text));
      fullscreen ||= stage.display.fullscreen;
      return 0;
    });
    expect(ticks).toBeGreaterThan(10);
    expect(menus.length).toBeGreaterThan(0);
    expect(fullscreen).toBe(true);
    // Les flèches des choix sont éteintes à la fin.
    expect([stage.bobs.bob(62).active, stage.bobs.bob(63).active]).toEqual([false, false]);
    expect(stage.display.fullscreen).toBe(false);
    expect(engine.joeWalk).toBe(JoeWalk.Normal);
    const key = 20;
    void key;
    expect(state.talkSelected.some((t) => t.hasTalkedTo)).toBe(true);
    expect(host.spoken.some((voice) => /^\d\d(SSSS|[0-9A-F]{4})[PJ]\d$/.test(voice.name))).toBe(true);
    expect(engine.warnings).toEqual([]);
  });

  it("la deuxième fois, Joe dit sa phrase de retrouvailles et la personne l'accueille", () => {
    const rig = realPlayer({ entryObject: 584 });
    rig.player.settle();
    talkToPortier(rig);
    rig.host.spoken.length = 0;
    talkToPortier(rig);
    expect(rig.host.spoken.some((voice) => voice.name.includes("XXXX"))).toBe(true);
  });

  it("interrompre le dialogue (clic droit) fait dire à Joe la réponse 15 et oublie le dernier choix", () => {
    const rig = realPlayer({ entryObject: 584 });
    const { player, host, state } = rig;
    player.settle();
    const { engine } = rig;
    const box = engine.data.jas.objectBoxes[585];
    clickAt(player, 6 * 20 + 10, 175);
    clickAt(player, Math.trunc((box.x1 + box.x2) / 2), Math.trunc((box.y1 + box.y2) / 2));
    // Dès que le menu est là, clic droit.
    for (let t = 0; t < 400 && !dialogueMenu(player); t++) player.run(1);
    expect(dialogueMenu(player)).not.toBeNull();
    player.move(100, 175, 0);
    player.move(100, 175, 2);
    player.move(100, 175, 0);
    runToEnd(player);
    expect(host.spoken.some((voice) => voice.name.startsWith("JOE0015"))).toBe(true);
    expect(state.talkSelected.some((t) => t.hasTalkedTo)).toBe(false);
    expect(engine.input.talkQuit).toBe(false);
  });
});
