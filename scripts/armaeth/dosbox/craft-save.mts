// Écrit une sauvegarde `SVG001.SVG` pour l'Armaeth d'origine (banc DOSBox-X) : salle 105, porte 111 fermée à clef (`Ego 0`), Prytwen
// absent, le héros devant la porte avec la clef d'or (6) en poche. Sert au test de la mauvaise clef (`docs/armaeth/dosbox.md` § 4.2).
// Usage : npx vite-node scripts/armaeth/dosbox/craft-save.mts <dossier de sortie>
//   puis : scripts/armaeth/dosbox/run.sh -x -t 6 -s scripts/armaeth/dosbox/scenarios/wrong-key.txt -i <dossier>/SVG001.SVG -d 95 -p "75 79 81"
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadWorldState, serializeWorld } from "../../../src/games/armaeth/engine/save";

const out = resolve(process.argv[2] ?? ".");
const cd = resolve(import.meta.dirname, "../../../archives/armaeth/cd/ARMAETH.FRE");
const state = loadWorldState(new Uint8Array(readFileSync(resolve(cd, "A1FCFG.SYS"))));
const hero = state.hero!;
const room = state.roomById(105)!;
state.moveToRoom(state.findByNum(101)!, state.roomById(104)!); // Prytwen : sans lui, « trop loin » ne le fait pas marcher
state.findByNum(111)!.ego = 0;
state.moveToRoom(hero, room);
[hero.x, hero.y, hero.p, hero.ground] = [112, 54, 28, 2]; // à portée du battant (112, 52, 24)
state.currentRoom = 105;
const key = state.findByNum(6)!;
state.moveToContainer(key, hero);
key.presence = 8; // dans l'inventaire (sans cela l'original ne la voit pas « tenue »)
writeFileSync(resolve(out, "SVG001.SVG"), serializeWorld(state));
