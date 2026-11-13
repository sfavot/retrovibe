import { describe, expect, it } from "vitest";
import { spriteKeyOf } from "../../src/games/armaeth/engine/animation";
import { Player } from "./player";

/**
 * Panneau de contenu (`1664:0057`) : les objets contenus dans un conteneur (coffre, dépouille…) sont dessinés au-dessus du
 * panneau. Leur sprite est une image choisie (même pour un objet statique, `Mob == 0`) : le panneau est tracé dans la page
 * d'arrière-plan à chaque image, donc le contenu reste dans la passe dynamique de `drawList`, et sa profondeur (`P`) doit
 * dépasser celle du fond hors scène (199) pour être visible dans les salles dont l'image n'occupe pas tout l'écran (ex. la
 * cabane). Les pixels transparents du sprite doivent laisser voir le fond du panneau, pas le fond hors scène.
 */

/** Pixels opaques (≠ 0xFF) du sprite `obj` qui coïncident avec l'écran présenté, à sa position courante. */
function opaqueMatches(player: Player, obj: { x: number; y: number; anim: { frame: number } }, num: number): { opaque: number; match: number } {
  const sprite = player.engine.sprites.get(spriteKeyOf({ typ: 2, num, animId: 0 })!)!;
  const frame = sprite.frames[obj.anim.frame];
  const screen = player.host.lastFrame!.pixels;
  const left = obj.x - (frame.width >> 1);
  const top = obj.y - frame.height + 1;
  let opaque = 0;
  let match = 0;
  for (let r = 0; r < frame.height; r++) {
    for (let c = 0; c < frame.width; c++) {
      const value = frame.pixels[r * frame.width + c];
      if (value === 0xff) continue;
      opaque++;
      const sx = left + c;
      const sy = top + r;
      if (sx < 0 || sy < 0 || sx >= 320 || sy >= 200) continue;
      if (screen[sy * 320 + sx] === value) match++;
    }
  }
  return { opaque, match };
}

describe("panneau de contenu", () => {
  it("affiche le sprite d'un objet contenu dans un coffre ouvert, sans fond noir autour", () => {
    const p = new Player();
    p.skipIntro();
    const state = p.state;

    // La cabane (salle 3) a une scène réduite (x 56..264, y 50..150) : le panneau (haut d'écran) est hors de l'image.
    p.engine.sendToRoom(3, true);
    for (let i = 0; i < 20 && state.loadedRoom?.id !== 3; i++) p.run(1);
    expect(state.loadedRoom?.id).toBe(3);

    const chest = state.findByNum(21)!;
    const key = state.findByNum(22)!;
    const hero = p.hero;
    hero.x = chest.x;
    hero.y = chest.y;
    hero.p = chest.p;
    hero.plane = chest.plane;

    p.say("ouvrir le coffre");
    expect(chest.ego).toBe(2);
    p.say("regarder dans le coffre");
    expect(state.selected).toBe(chest);
    p.run(3);

    expect(key.presence).toBe(0x0b); // posé dans le panneau
    expect(key.anim.frame).toBeGreaterThanOrEqual(0); // image choisie
    const { opaque, match } = opaqueMatches(p, key, 22);
    expect(opaque).toBeGreaterThan(0);
    expect(match).toBe(opaque); // le sprite est entièrement dessiné au-dessus du panneau

    // Les pixels transparents du sprite laissent voir le fond du panneau (couleur 250), pas le fond hors-scène (221).
    const sprite = p.engine.sprites.get(spriteKeyOf({ typ: 2, num: 22, animId: 0 })!)!;
    const frame = sprite.frames[key.anim.frame];
    const screen = p.host.lastFrame!.pixels;
    const left = key.x - (frame.width >> 1);
    const top = key.y - frame.height + 1;
    let transparentSeen = 0;
    for (let r = 0; r < frame.height; r++) {
      for (let c = 0; c < frame.width; c++) {
        if (frame.pixels[r * frame.width + c] !== 0xff) continue;
        const sx = left + c;
        const sy = top + r;
        if (sx < 0 || sy < 0 || sx >= 320 || sy >= 200) continue;
        transparentSeen++;
        expect(screen[sy * 320 + sx]).toBe(250);
      }
    }
    expect(transparentSeen).toBeGreaterThan(0);
  });
});
