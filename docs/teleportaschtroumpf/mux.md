# Vidéos MUX du Téléportaschtroumpf

Décodeur : `src/games/teleportaschtroumpf/data/mux.ts`. Spec de référence : <https://wiki.multimedia.cx/index.php/MUX>.
Validé contre le prototype `scripts/teleportaschtroumpf/proto/mux.py` (hash des pixels, voir `test/teleportaschtroumpf/mux.test.ts`).

## Format (tel qu'implémenté)

Little-endian. 233 fichiers : les 232 `.MUX` plus `S20/S20H/S20H` (sans extension, même format).

### En-tête (0x20 octets) puis table d'offsets

| Offset | Type | Champ |
|---|---|---|
| 0x00 | u32 | signature `0xAA07` |
| 0x04 | u16 | taille de l'en-tête (0x1800, table comprise) |
| 0x06 | u16 | nombre d'entrées de la table |
| 0x08, 0x0a | u16 ×2 | inconnus (toujours 0 dans les fichiers) |
| 0x0c | u16 | cadence : diviseur du PIT (1 193 182 Hz) |
| 0x0e | u16 | fréquence audio en Hz (0 = pas de son) |
| 0x10 | u32 | taille du tampon vidéo |
| 0x14 | u16 | taille du tampon son |
| 0x16 | u32 | taille du tampon de chunks (65 536) |
| 0x1a | u16 | nombre de tampons son (8) |
| 0x1c, 0x1e | u16 ×2 | largeur, hauteur (toujours 320×200) |
| 0x20 | u32 × n | offsets des chunks ; 2 bits de poids fort = drapeaux (ignorés) ; dernière entrée `0xFFFFFFFF` |

Le décodeur ne se sert que du premier offset et lit ensuite les chunks à la suite (la table ne sert qu'aux sauts).

### Chunks

`u8 type, u8 sous-type (toujours 0), u32 taille, données`.

| Type | Rôle |
|---|---|
| 07 (premier) / 06 | audio PCM 8 bits non signé, mono |
| 70 (premier) / 65 | palette : 768 octets RGB 8 bits |
| 6f (premier) / 64 | vidéo (le 64 n'apparaît dans aucun fichier) |
| 08 | marqueur de 1 ou 2 octets, sens inconnu (ex. ASCII `"12"` dans S27E) ; ignoré, exposé dans `MuxFrame.markers` |
| 05 | fin d'image, payload u16 = numéro d'image |
| 04 | fin de fichier |

Un type inconnu lève une erreur. Une image peut ne contenir aucun chunk vidéo (l'image précédente est conservée).

### Chunk vidéo

`u8 flags, u32 position de départ (en pixels), u32 taille « bits », u32 taille « couleurs »`, puis les données.

- `flags & 4` : tout le reste est compressé LZ ; décompressé = « bits » puis « couleurs ».
- `flags & 2` : image inter (le code de saut est autorisé).
- `flags & 1` (LZ partiel) et `flags & 8` : décrits sur le wiki mais absents des fichiers : le décodeur lève « non utilisé par ce jeu ».

**LZ** : mots u32 de drapeaux lus MSB d'abord ; on sort de la boucle interne quand le mot devient nul après décalage (le dernier bit est une sentinelle) ou en fin de source. Bit 1 : (quartet + 1) octets littéraux ; bit 0 : copie arrière, décalage = un octet, longueur = quartet + 2. Les quartets viennent de la source : octet lu, poids fort servi d'abord, poids faible gardé pour le quartet suivant.

**Pixels** : à partir de la position de départ, jusqu'à la fin de l'image, un flux de contrôle (bits, quartets et octets partagent le même flux ; bits en mots u32 LE lus MSB d'abord) donne une longueur de série, la couleur venant du flux « couleurs » (un octet par série) :

| Bits | Série |
|---|---|
| `0` | 1 pixel |
| `10` | quartet n : n + 4 pixels ; si n = 0, un octet + 20 |
| `110` | 2 pixels |
| `1110` | 3 pixels |
| `1111` (intra) | 4 pixels |
| `11110` (inter) | 4 pixels |
| `11111` (inter) | saut : un octet = nombre de pixels laissés tels quels |

L'image est conservée d'une image à l'autre (nécessaire pour l'inter).

### Vidéos en surimpression (`179a:0673` avec `0x1000`, sûr)

105 fichiers commencent par une image inter, sans image complète : S38A..E, les 30 vidéos de S39 et les 70 de S42 (habillage et vidéos de `154c:097b`). Ce ne sont que des deltas du personnage sur un fond. Avec `0x1000`, après chaque image, le lecteur recopie A à l'écran puis restaure A depuis le fond B (`179a:04e7`..`0501`, `12ec:037c` dans le sens de `13fc:0411`) : l'image suivante se décode sur le fond, et non sur l'image précédente. Seules les 128 premières couleurs de la vidéo sont chargées (`179a:023e`, 0x180 octets). Avant, l'appelant a passé l'écran courant en 128..255 (`13fc:0002(+1)` : couleurs 0..127 recopiées en 128..255, pixels + 0x80) et l'a figé en B (`265b:007c`, `154c:09fb`). Décodées image sur image, ces vidéos laissent une traînée. Port : `VideoBackdrop` (`engine/video.ts`), et `OverlayVideo` pour S38, dont le fond change en cours de vidéo.

## Relevé (233 fichiers)

- 21 015 chunks 05 (images), 20 901 chunks vidéo, 3 086 palettes, 5 123 + 222 chunks audio, 265 chunks 08.
- Flags vidéo présents : 2 (12 338 chunks), 4 (2 953), 6 (5 610). Aucun 1, 3, 8.
- Dimensions : toujours 320×200. Champs inconnus 0x08/0x0a : toujours 0.
- Diviseur : 9039 (230 fichiers) ; exceptions : S10A 19886, S52D0 14204, S52D1 8285.
- Fréquence audio : 18 867 Hz (219 fichiers), 19 230 (S30A, S52D0), 11 111 (S52D1), 0 (11 fichiers sans son, dont S20H).
- Audio total : 38,9 Mo.

## Cadence

Images par seconde = 1 193 182 / diviseur / 12, soit 11,0 pour 9039 (cas général), 5,0 pour S10A, 7,0 pour S52D0, 12,0 pour S52D1. Vérifié : le rapport (fréquence audio × images) / octets audio vaut 1/12 du taux du PIT dans les 4 groupes (0,079 à 0,083 ; un peu moins de 1/12 car la fin du film est parfois muette). Soit environ 1 715 octets audio par image à 18 867 Hz pour 11 images/s. Les chunks audio font environ 6 860 octets (≈ 4 images) ; S10A (5 images/s) : 15 093-15 094 octets.
`MuxHeader.framesPerSecond` expose cette valeur.

## API

`new MuxDecoder(bytes)` ; `header` ; `pixels` (image courante, persistante) ; `palette` (768 octets) ; `nextFrame()` → `{ index, paletteChanged, audio[], markers[] }` ou `null` ; `reset()`. Pas d'allocation par pixel ; le tampon de décompression LZ est réutilisé.

Le décodage d'un chunk vidéo est isolé dans `MuxVideoDecoder` : `decode(payload, pixels, width, height)` (payload = contenu d'un chunk 6f/64, en-tête de 13 octets compris ; `pixels` est modifié en place et doit persister d'une image à l'autre pour l'inter). `MuxDecoder` y délègue ; `mut.ts` l'utilise directement.
