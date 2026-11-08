// Rend des morceaux AdLib de Flight of the Amazon Queen en WAV (16 bits, mono, 44 100 Hz), hors ligne, pour les écouter à côté de ScummVM.
// Usage : node scripts/fotaq/render-music.mts <dossier de sortie> [<nom>=<indice du morceau d'AQBANK.MUS>[:<secondes>] ...]
//   (défaut : title=20:30 jungle=16:30 hotel=31:24 ; l'indice est celui de `AQBANK.MUS`, à partir de 0 = « numéro de la table - 1 »)
// Le pilote (`src/games/fotaq/audio/`) écrit ses registres OPL2 tick par tick (250 Hz) ; l'émulateur `src/audio/opl2.ts` les applique
// à l'échantillon près, comme le worklet du navigateur. Les modules TypeScript sont chargés par Vite (imports sans extension).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";

const racine = resolve(import.meta.dirname, "../..");
const sortie = resolve(process.argv[2] ?? "fotaq-ecoute");
const demandes = (process.argv.length > 3 ? process.argv.slice(3) : ["title=20:30", "jungle=16:30", "hotel=31:24"]).map((arg) => {
  const [nom, reste] = arg.split("=");
  const [indice, secondes] = reste.split(":");
  return { nom, indice: Number(indice), secondes: Number(secondes ?? 30) };
});

const RATE = 44100;
const server = await createServer({ root: racine, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
try {
  const { QueenMusic, QUEEN_TICK_RATE } = await server.ssrLoadModule("/src/games/fotaq/audio/music.ts");
  const { readAdLibBank } = await server.ssrLoadModule("/src/games/fotaq/data/music.ts");
  const { Opl2 } = await server.ssrLoadModule("/src/audio/opl2.ts");
  const bank = readAdLibBank(new Uint8Array(readFileSync(resolve(racine, "original/fotaq/AQBANK.MUS"))));
  mkdirSync(sortie, { recursive: true });

  for (const { nom, indice, secondes } of demandes) {
    const writes: { tick: number; reg: number; value: number }[] = [];
    let tick = 0;
    const sink = { beginTick: (t: number) => (tick = t), write: (reg: number, value: number) => writes.push({ tick, reg, value }) };
    const music = new QueenMusic({ bank, sink, random: () => 0 });
    music.playSong(indice);
    const ticks = Math.ceil(secondes * QUEEN_TICK_RATE);
    for (let i = 0; i < ticks; i++) music.tick();

    const chip = new Opl2(RATE);
    const pcm = new Int16Array(secondes * RATE);
    let position = 0;
    let next = 0;
    const generate = (until: number) => {
      const end = Math.min(until, pcm.length);
      if (end > position) chip.generate(pcm, position, end - position);
      position = Math.max(position, end);
    };
    for (let t = 0; t <= ticks; t++) {
      generate(Math.round((t * RATE) / QUEEN_TICK_RATE));
      while (next < writes.length && writes[next].tick <= t) chip.writeReg(writes[next].reg, writes[next++].value);
    }
    generate(pcm.length);

    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + pcm.byteLength, 4);
    header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(RATE, 24);
    header.writeUInt32LE(RATE * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(pcm.byteLength, 40);
    const fichier = resolve(sortie, `${nom}.wav`);
    writeFileSync(fichier, Buffer.concat([header, Buffer.from(pcm.buffer)]));
    console.log(`${fichier} : morceau ${indice}, ${secondes} s, ${writes.length} écritures`);
  }
} finally {
  await server.close();
}
