// Écrit une sauvegarde `SVG001.SVG` pour l'Armaeth d'origine (banc DOSBox-X) : salle 8, le héros sur la pile de bois (sol 65) en
// (X, 146, 127) avec la clef d'or (6) en poche. Sert au test du couloir de la pile et du coffret (`docs/armaeth/dosbox.md` § 4.5) :
// X pair (216) ou impair (217).
// Usage : npx vite-node scripts/armaeth/dosbox/craft-room8.mts <dossier de sortie> <X>
//   puis : scripts/armaeth/dosbox/run.sh -x -s scripts/armaeth/dosbox/scenarios/coffret.txt -i <dossier>/SVG001.SVG -d 100 -p "70 80 90"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadWorldState, serializeWorld } from "../../../src/games/armaeth/engine/save";

const out = resolve(process.argv[2] ?? ".");
const x = Number(process.argv[3] ?? 216);
mkdirSync(out, { recursive: true });
const cd = resolve(import.meta.dirname, "../../../archives/armaeth/cd/ARMAETH.FRE");
const state = loadWorldState(new Uint8Array(readFileSync(resolve(cd, "A1FCFG.SYS"))));
const hero = state.hero!;
state.moveToRoom(hero, state.roomById(8)!);
[hero.x, hero.y, hero.p, hero.ground] = [x, 146, 127, 65]; // la position où la glissade et la marche amènent le robot (X pair)
state.currentRoom = 8;
const key = state.findByNum(6)!;
state.moveToContainer(key, hero);
key.presence = 8; // dans l'inventaire
writeFileSync(resolve(out, "SVG001.SVG"), serializeWorld(state));
