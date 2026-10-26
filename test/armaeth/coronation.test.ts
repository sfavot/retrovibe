import { describe, expect, it } from "vitest";
import { MessageTable, messageId } from "../../src/games/armaeth/data/text";
import { hasOriginalFiles, readOriginal } from "./helpers";
import { Player } from "./player";

/**
 * Le couronnement (`2c83:0004`, `27ed:0194`, `2caf:000e`) joué de bout en bout sur le moteur complet : la dalle du trône est replacée
 * fermée (sans quoi le trou des cases 81 sert de sol à l'acteur, qui reste bloqué au pied des marches), l'acteur gravit les marches
 * (`Mob 2` à l'étape 4), puis le verdict (`S50`, `14cf:000c(0x32)`) et le message `S55` (`2caf:0232..023a`) concluent la partie.
 * Le monde de départ est modifié (dalle ouverte, couronne portée) : test isolé, le robot du parcours n'écrit jamais l'état.
 */
describe.skipIf(!hasOriginalFiles)("couronnement : marche vers le trône, verdict et fin de partie", () => {
  const table = hasOriginalFiles ? new MessageTable(readOriginal("A1FTMS.SYS"), readOriginal("A1FMSG.SYS")) : null;
  const text = (cls: string, n: number): string => table!.messages(messageId(cls, n));

  it("la dalle ouverte est replacée fermée, l'acteur atteint le trône, puis S50 (verdict) et S55", () => {
    const p = new Player({ seed: 1 });
    p.skipIntro();
    const slab = p.state.findByNum(104)!;
    slab.ego = 3; // ouverte : `Y` plus haut de `Tim = 0x16`
    slab.y = 0x8b - 0x16;
    const crown = p.state.createObject({ typ: 2, num: 328, pickable: 7, presence: 8 });
    p.state.moveToContainer(crown, p.hero);

    p.say("porter la couronne");
    expect(p.state.hero?.num).toBe(333);
    expect(slab.ego).toBe(0); // `27ed:0194` : fermée, `Y = 0x8B`
    expect(slab.y).toBe(0x8b);

    const read: string[] = [];
    for (let i = 0; i < 120 && !p.state.gameOver; i++) {
      p.run(50);
      read.push(...p.drain(2));
    }
    read.push(...p.drain(2));
    expect(p.state.gameOver).toBe(true);
    expect(p.state.hero).toBeNull();
    expect(p.state.score).toBeGreaterThanOrEqual(50);
    expect(p.state.loadedRoom!.id).toBe(108);
    // l'écran du verdict commence par `S50` ; il est suivi de `S55`
    const verdict = read.findIndex((t) => t.startsWith(text("S", 50).slice(0, 40)));
    const last = read.findIndex((t) => t.startsWith(text("S", 55).slice(0, 40)));
    expect(verdict).toBeGreaterThanOrEqual(0);
    expect(last).toBeGreaterThan(verdict);
  });
});
