# Vidéos Smacker de SWIV 3D

Les 7 vidéos de `original/swiv3d/ANIMS/` (`BR_TER0..3`, `INTRO1`, `INTRO2`, `IPLAY`) sont des Smacker **SMK2**, 320×400, 8 bits indexé, sans drapeau (ni anneau, ni Y entrelacé / doublé). Le décodeur est partagé : `src/data/smacker.ts`. Les fichiers `.SCR` voisins sont lus par `src/games/swiv3d/data/scr.ts` (champs encore bruts, voir `re-index.md`).

## Valeurs observées

| Fichier | Images | Cadence brute | Durée d'une image | Audio |
|---|---:|---:|---:|---|
| `BR_TER0` | 406 | -7142 | 71,42 ms (14,0 i/s) | 11025 Hz mono 8 bits |
| `BR_TER1` | 343 | -7142 | 71,42 ms | 11025 Hz mono 8 bits |
| `BR_TER2` | 327 | -7100 | 71 ms (14,08 i/s) | 11025 Hz mono 8 bits |
| `BR_TER3` | 280 | -7142 | 71,42 ms | 11025 Hz mono 8 bits |
| `INTRO1`, `INTRO2`, `IPLAY` | 315, 957, 491 | -7100 | 71 ms | 22050 Hz stéréo 8 bits |

- Cadence : valeur > 0 = millisecondes par image ; valeur < 0 = 1/100000 s par image (valeur absolue) ; 0 = 10 images/s.
- Piste audio (champ « rate » de l'en-tête) : 24 bits bas = fréquence ; `0x80000000` compressé (DPCM), `0x40000000` piste présente, `0x20000000` 16 bits, `0x10000000` stéréo. SWIV n'utilise que `0xC0002B11` (mono, 11025 Hz) et `0xD0005622` (stéréo, 22050 Hz), toujours 8 bits compressés, sur la piste 0.
- Drapeaux d'en-tête : bit 0 anneau (une image de plus), bit 1 Y entrelacé, bit 2 Y doublé. Les deux derniers sont exposés par `SmackerFrame.yDouble` ; aucun fichier de SWIV ne les pose.
- Chaque image contient, dans l'ordre : palette (si bit 0 du type), pistes audio (bits 1 à 7), vidéo en blocs 4×4 (bicolore, plein, vide, uni). Les images vides conservent l'image précédente.

## Points d'implémentation

- Flux de bits : bit de poids faible d'abord. Les 4 arbres (MMAP, MCLR, FULL, TYPE) sont des arbres 16 bits construits à partir de deux sous-arbres 8 bits et de 3 valeurs d'échappement (cache) ; **le cache est remis à zéro à chaque image**.
- Palette : couleur neuve (6 bits → 8 bits par `v * 4 + (v >> 4)`), copie depuis la palette précédente, saut.
- Audio compressé : un arbre 8 bits par octet et par voie, valeurs initiales (voie droite lue en premier), puis différences.
- La variante SMK4 (blocs pleins en demi-résolution) et l'audio 16 bits sont implémentés d'après le format publié mais **non vérifiés** : aucun fichier de SWIV ne les utilise.

## API

- `parseSmacker(bytes)` : `SmackerFile` (taille, nombre d'images, `frameDurationMs`, `fps`, drapeaux, `audioTracks`).
- `new SmackerDecoder(bytes)` : `nextFrame()` renvoie `{ index, keyframe, pixels (largeur × hauteur), palette (256 × RVB 8 bits), paletteChanged, yDouble, audio }` puis `null` en fin de vidéo ; `audio[i]` correspond à `file.audioTracks[i]` : `{ samples: Int16Array entrelacé, rate, channels }` ou `null`. `reset()` revient à la première image, `position` / `done` donnent l'état.
- Les tampons renvoyés sont des copies, utilisables après l'image suivante.

## Vérification

Les 7 vidéos ont été comparées à `ffmpeg` : toutes les images (RVB) et tous les échantillons audio (PCM 16 bits) sont identiques, octet pour octet.
