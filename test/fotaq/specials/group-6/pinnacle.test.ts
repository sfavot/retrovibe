import { describe, expect, it } from "vitest";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";

/** Pièce 7 : objet de destination (n° du jeu), pièce d'arrivée, objet d'entrée, morceau (`handlePinnacleRoom`). */
const DESTINATIONS = [
  { object: 42, name: "Site du crash", room: 6, entry: 39, song: 3 },
  { object: 43, name: "Jungle", room: 10, entry: 60, song: 3 },
  { object: 44, name: "embarcadère", room: 42, entry: 304, song: 7 },
  { object: 47, name: "Bob le Marchand", room: 20, entry: 135, song: 6 },
  { object: 41, name: "Camp de la Flöda", room: 22, entry: 165, song: 16 },
];

/** Un point de souris (le décor défile avec la souris : défilement = abscisse) où la zone visée est `zone` (0 : aucune). */
function pointOn(w: Walkthrough, zone: number): { x: number; y: number } {
  for (let y = 0; y < 150; y += 2) {
    for (let x = 0; x < 320; x += 2) if (w.engine.grid.findObjectUnderCursor(x, y, x) === zone) return { x, y };
  }
  throw new Error(`aucun point ne vise la zone ${zone}`);
}

function hover(w: Walkthrough, object: number): void {
  const { x, y } = pointOn(w, object - w.engine.currentRoomData);
  w.host.push({ type: "pointer", x, y, buttons: 0 });
  w.wait(2);
}

describe.skipIf(!hasOriginalFiles)("groupe 6 : le piton (pièce 7, changeToSpecialRoom)", () => {
  it("la pièce attend le joueur : la caméra est libre, Joe et la montagne suivent la souris, le défilement aussi", () => {
    const w = new Walkthrough({ room: 7 });
    w.wait(30);
    expect(w.engine.busy).toBe(true);
    expect(w.stage.bobs.cameraBob).toBe(-1);
    w.host.push({ type: "pointer", x: 180, y: 40, buttons: 0 });
    w.wait(2);
    expect(w.engine.horizontalScroll).toBe(180);
    const joe = w.stage.bobs.bob(6);
    expect(joe.x).toBe(Math.trunc((3 * 180) / 4) + 200);
    expect(joe.frameNum).toBe(Math.trunc(180 / 36) + 45);
    expect(w.stage.bobs.bob(7).x).toBe(joe.x);
    expect(w.engine.warnings).toEqual([]);
  });

  for (const destination of DESTINATIONS) {
    it(`survoler « ${destination.name} » affiche « Aller vers… » ; cliquer mène à la pièce ${destination.room} par l'objet ${destination.entry}`, () => {
      const w = new Walkthrough({ room: 7 });
      w.wait(30);
      hover(w, destination.object);
      const text = w.stage.display.textAt(5).text;
      expect(text).toContain(w.engine.objectName(w.engine.state.objects[destination.object].name));
      expect(w.engine.state.entryObject).toBe(destination.entry);
      const songs = w.host.songs.length;
      w.host.push({ type: "pointer", x: w.engine.input.mouseX, y: w.engine.input.mouseY, buttons: 1 });
      w.host.push({ type: "pointer", x: w.engine.input.mouseX, y: w.engine.input.mouseY, buttons: 0 });
      w.waitForRoom(destination.room, 600);
      expect(w.host.songs.slice(songs)).toContain(destination.song);
      expect(w.stage.bobs.cameraBob).toBe(0);
      expect(w.stage.display.textAt(5).text).toBe("");
      expect(w.engine.state.entryObject).toBe(destination.entry);
      expect(w.engine.warnings).toEqual([]);
    });
  }

  it("un clic avant d'avoir visé un objet n'est pas perdu (reproduit ScummVM) : il part dès qu'un objet est visé", () => {
    const w = new Walkthrough({ room: 7 });
    w.wait(30);
    const empty = pointOn(w, 0);
    w.host.push({ type: "pointer", ...empty, buttons: 1 });
    w.host.push({ type: "pointer", ...empty, buttons: 0 });
    w.wait(5);
    expect(w.room).toBe(7);
    hover(w, 42);
    w.waitForRoom(6, 600);
  });
});
