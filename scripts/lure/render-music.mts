// Rend des sons AdLib de Lure of the Temptress en WAV (16 bits, mono, 44 100 Hz), hors ligne, pour les écouter à côté de ScummVM.
// Usage : node scripts/lure/render-music.mts <dossier de sortie> [<nom>=<secondes>:<section>:<son>[@<début>][+<section>:<son>[@<début>]...] ...]
//   section : main (le jeu), intro, ending ; son : numéro de son tel que le jeu le donne (bit 7 = boucle, comme `soundNumber` de `0x3F18`) ;
//   début : seconde de lancement (0 par défaut). Le premier son est lancé comme une musique (source 0), les suivants comme des bruitages
//   (sources 1 à 9), les uns sur les autres : c'est ce qui se partage les 9 voix de l'OPL2. Les sons d'un même fichier sont d'une même section.
//   (défaut : piece=30:main:153 bruitage=6:main:21 intro=45:intro:0 melange=30:main:153+main:21@5+main:3@12+main:9@16)
// Les originaux sont lus dans `original/lure/`. Le gestionnaire de sons (`src/games/lure/audio/sound.ts`) écrit ses registres OPL2 tick par
// tick (250 Hz) ; l'émulateur `src/audio/opl2.ts` les applique à l'échantillon près, comme le worklet du navigateur. Les modules TypeScript
// sont chargés par Vite (imports sans extension).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";

const racine = resolve(import.meta.dirname, "../..");
const sortie = resolve(process.argv[2] ?? "lure-ecoute");
const DEFAUT = ["piece=30:main:153", "bruitage=6:main:21", "intro=45:intro:0", "melange=30:main:153+main:21@5+main:3@12+main:9@16"];

interface Demande {
  nom: string;
  secondes: number;
  section: "main" | "intro" | "ending";
  sons: { son: number; debut: number }[];
}

const demandes: Demande[] = (process.argv.length > 3 ? process.argv.slice(3) : DEFAUT).map((arg) => {
  const [nom, reste] = arg.split("=");
  const [secondes, ...sons] = reste.split(":");
  // « main:153@0+main:23@5 » a été découpé par « : » : on recolle puis on redécoupe par « + ».
  const parties = sons.join(":").split("+");
  let section: Demande["section"] | undefined;
  const liste = parties.map((p) => {
    const [sec, suite] = p.includes(":") ? p.split(":") : [section, p];
    section ??= sec as Demande["section"];
    const [son, debut] = suite.split("@");
    return { son: Number(son), debut: Number(debut ?? 0) };
  });
  return { nom, secondes: Number(secondes), section: section!, sons: liste };
});

const RATE = 44100;
const TICK_RATE = 250;
const server = await createServer({ root: racine, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
try {
  const { SoundManager } = await server.ssrLoadModule("/src/games/lure/audio/sound.ts");
  const { Opl2 } = await server.ssrLoadModule("/src/audio/opl2.ts");
  const { loadLureData } = await server.ssrLoadModule("/src/games/lure/data/lure-data.ts");
  const { readSoundSections } = await server.ssrLoadModule("/src/games/lure/data/sound.ts");
  const { DAT_FILE_NAME, DISK_FILE_NAMES } = await server.ssrLoadModule("/src/games/lure/data/container.ts");
  const lire = (nom: string) => new Uint8Array(readFileSync(resolve(racine, "original/lure", nom)));
  const data = loadLureData({ disks: DISK_FILE_NAMES.map(lire), dat: lire(DAT_FILE_NAME) });
  const sections = readSoundSections(data.resources);
  mkdirSync(sortie, { recursive: true });

  for (const { nom, secondes, section, sons } of demandes) {
    const writes: { tick: number; reg: number; value: number }[] = [];
    let tick = 0;
    const sink = { beginTick: (t: number) => (tick = t), write: (reg: number, value: number) => writes.push({ tick, reg, value }) };
    const sound = new SoundManager({ sections, descs: data.soundDescs, sink });
    sound.loadSection(section);
    const ticks = Math.ceil(secondes * TICK_RATE);
    const departs = sons.map((s, rang) => ({ ...s, rang, tick: Math.round(s.debut * TICK_RATE) }));
    for (let i = 1; i <= ticks; i++) {
      for (const d of departs) if (d.tick === i - 1) sound.playMusic(d.son, d.rang === 0);
      sound.tick();
    }

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
      generate(Math.round((t * RATE) / TICK_RATE));
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
    console.log(`${fichier} : ${section} ${sons.map((s) => `${s.son}@${s.debut}`).join(" + ")}, ${secondes} s, ${writes.length} écritures`);
  }
} finally {
  await server.close();
}
