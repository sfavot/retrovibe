import { describe, expect, it } from "vitest";
import { VideoPlayer, framesDue } from "../../../src/games/swiv3d/ui/video";
import { hasOriginalFiles, readOriginal } from "../helpers";

describe("cadence des vidéos", () => {
  it("montre la première image à 0 ms, puis une par durée d'image, jusqu'à la dernière", () => {
    expect(framesDue(-1, 71, 10)).toBe(0);
    expect(framesDue(0, 71, 10)).toBe(1);
    expect(framesDue(70, 71, 10)).toBe(1);
    expect(framesDue(71, 71, 10)).toBe(2);
    expect(framesDue(1e9, 71, 10)).toBe(10);
  });
});

describe.skipIf(!hasOriginalFiles)("lecture de BR_TER0 (sans son)", () => {
  const bytes = readOriginal("ANIMS/BR_TER0.SMK");

  it("décode à la cadence de l'en-tête (71,42 ms), numérote les images à partir de 1 et finit sur la dernière", () => {
    const player = new VideoPlayer(bytes, null);
    const fb = new Uint8Array(320 * 400);
    expect(player.frameCount).toBe(406);
    // le départ est avancé de 120 ms : rien avant
    expect(player.update(1000, fb)).toBeNull();
    expect(player.update(1000 + 119, fb)).toBeNull();
    expect(player.update(1000 + 120, fb)?.number).toBe(1);
    expect(player.update(1000 + 120 + 71, fb)).toBeNull(); // 71 ms < 71,42 : pas de nouvelle image
    expect(player.update(1000 + 120 + 72, fb)?.number).toBe(2);
    // un retard rattrape par paquets, sans dépasser le temps écoulé
    const late = player.update(1000 + 120 + 71.42 * 20 + 1, fb);
    expect(late?.number).toBeGreaterThan(2);
    expect(late?.number).toBeLessThanOrEqual(21);
    expect(late?.palette).toHaveLength(768);
    expect(fb.some((v) => v !== 0)).toBe(true);
    expect(player.ended).toBe(false);
  });

  it("finit quand toutes les images ont eu leur durée, et garde la dernière dans le tampon", () => {
    const player = new VideoPlayer(bytes, null);
    const fb = new Uint8Array(320 * 400);
    let now = 0;
    let last = 0;
    for (; !player.ended && now < 60_000; now += 40) last = player.update(now, fb)?.number ?? last;
    expect(player.ended).toBe(true);
    expect(last).toBe(406);
    expect(now).toBeGreaterThan(406 * 71);
    expect(now).toBeLessThan(406 * 71.5 + 400);
  });

  it("stop() arrête la lecture", () => {
    const player = new VideoPlayer(bytes, null);
    player.stop();
    expect(player.ended).toBe(true);
    expect(player.update(5000, new Uint8Array(320 * 400))).toBeNull();
  });
});
