import { describe, expect, it } from "vitest";
import { BootSequence, HOLD_MS, type BootStep } from "../../../src/games/swiv3d/screens/boot";

const names = (seq: BootSequence): string => {
  const step: BootStep | null = seq.step;
  if (!step) return "fin";
  return step.kind === "video" ? step.name : step.screen ? `écran ${step.screen}` : "attente";
};

describe("séquence de démarrage", () => {
  it("joue IPLAY, 3,5 s, les écrans 1004 et 1005 de 3,5 s chacun, puis INTRO1 et INTRO2", () => {
    const seq = new BootSequence();
    expect(names(seq)).toBe("IPLAY");
    seq.videoEnded(false);
    expect(names(seq)).toBe("attente");
    seq.update(HOLD_MS - 1);
    expect(names(seq)).toBe("attente");
    seq.update(1);
    expect(names(seq)).toBe("écran 1004");
    seq.update(HOLD_MS - 1);
    expect(names(seq)).toBe("écran 1004");
    seq.update(1);
    expect(names(seq)).toBe("écran 1005");
    seq.update(HOLD_MS);
    expect(names(seq)).toBe("INTRO1");
    seq.videoEnded(false);
    expect(names(seq)).toBe("INTRO2");
    seq.videoEnded(false);
    expect(names(seq)).toBe("fin");
    expect(seq.done).toBe(true);
  });

  it("ne joue INTRO2 que si INTRO1 n'a pas été interrompue", () => {
    const seq = new BootSequence(false);
    expect(names(seq)).toBe("INTRO1");
    seq.videoEnded(true);
    expect(names(seq)).toBe("fin");
  });

  it("une touche passe une attente (confort du port), pas une vidéo", () => {
    const seq = new BootSequence();
    seq.skip();
    expect(names(seq)).toBe("IPLAY");
    seq.videoEnded(false);
    seq.skip();
    expect(names(seq)).toBe("écran 1004");
    seq.skip();
    expect(names(seq)).toBe("écran 1005");
  });

  it("interrompre IPLAY passe aussi l'attente de sa dernière image", () => {
    const seq = new BootSequence();
    seq.videoEnded(true);
    expect(names(seq)).toBe("écran 1004");
  });

  it("l'horloge n'avance pas pendant une vidéo, et repart de zéro à chaque attente", () => {
    const seq = new BootSequence();
    seq.update(10_000);
    expect(names(seq)).toBe("IPLAY");
    seq.videoEnded(false);
    seq.update(3000);
    expect(seq.elapsedMs).toBe(3000);
    seq.update(500);
    expect(seq.elapsedMs).toBe(0);
  });

  it("« Revoir l'intro » saute les logos", () => {
    expect(names(new BootSequence(false))).toBe("INTRO1");
  });
});
