# Format `.HY8` (sprites)

Note technique du décodeur `src/games/teleportaschtroumpf/data/hy8.ts` (`parseHy8`). 33 fichiers dans `DATA/Sxx/SxxY/`, tous décodés. Les adresses `seg:off` renvoient à `archives/teleportaschtroumpf/re/` (`decomp/`, `disasm.txt`).

Un HY8 contient des images indexées (palette de la scène), des **sprites composés** (listes d'images avec position) et des **animations** (listes de sprites). Le moteur ne manipule jamais une image seule : il dessine un sprite par son index.

## Disposition

En-tête de 6 u32 little-endian `h[0..5]` :

| Champ | Contenu |
|---|---|
| `h[0]` | 0x18 : début de la table de sprites (toujours) |
| `h[1]` | début de la table d'images |
| `h[2]` | début de la table d'animations |
| `h[3]` | début de la section finale (12 octets) |
| `h[4]` | 0 partout (dans les variantes XA2 non utilisées, c'est une palette) |
| `h[5]` | fin des données = taille du fichier dans les 33 cas |

Ordre dans le fichier : en-tête, sprites, images, animations, section finale. Les sections se suivent sans trou, à l'exception des 2 octets de remplissage décrits plus bas.

Les trois tables ont la même forme : u32 relatifs au début de la table, nombre d'entrées = `premier offset / 4`.

## Images (table à `h[1]`)

- Chaque image est précédée d'un **mot d'attributs** u16 (premier offset de la table = 4·n + 2 : celui de la première image ; puis 2 octets entre deux images). Le blit le lit en `[SI-4]` et le combine au mot d'index (`317b:0279`, `XOR CX,[SI-4]`, puis `TEST CH,0x80`) : **0x8000 = image stockée en miroir horizontal**, retournée à l'affichage sans décaler sa position. Valeurs rencontrées : 0 (1097 images) et 0x8000 (39 : `s01a000s.hy8` 34..51, 53..63 et 112..117 ; 2 dans `s30c001s.hy8` et `s31a000s.hy8`). Sûr. Le décodeur rend ces images déjà retournées. (Lecture antérieure, fausse : « 2 octets de remplissage jamais lus » ; elle donnait un Schtroumpf tourné à l'envers en course, en saut, impatient et à l'arrivée.)
- Image : `[largeur/16][hauteur]` (u8, u8), puis pour chaque ligne `[nb spans]` suivi des spans, puis 1 octet d'écart de fin.
- Span : `[skip][n4][n1]`, puis `4·n4 + n1` pixels. `skip` pixels transparents sont sautés avant. Le pixel 0 est transparent (le blit ignore ce qui n'est pas écrit).
- Écart de fin : vaut exactement `largeur - x` (x = position après le dernier span). Vérifié sur les 1136 images des 33 fichiers : aucun écart différent, aucun débordement de ligne, offsets strictement croissants et dans le fichier. Le décodeur lève une erreur sinon.

Preuve RE (blit `317b:01cc`) : la routine lit `largeur/16` et `hauteur` en `317b:0233`..`0241`, puis par ligne `MOV DH,[SI]` (nb spans, `317b:03a9`), `MOV CL,[SI]; ADD DI,CX` (skip), `MOV BX,[SI+1]` (n4 en BL, n1 en BH), `MOV CL,BL; SHL CX,1; REP MOVSW` (4·n4 octets, `317b:03b6`..`03ba`), `MOV CL,BH; REP MOVSB` (n1 octets), et en fin de ligne `MOV CL,[SI]; ADD DI,CX; ADD DI,BP` avec `BP = 320 - largeur` : l'octet d'écart est donc bien le saut jusqu'à la fin de ligne. Variantes : bit 0x4000 du paramètre = mode opaque (les trous sont remplis de 0, `317b:0451`), bit 0x8000 = miroir en x (`317b:027c`, relit chaque ligne à l'envers).

## Sprites composés (table à 0x18)

Lecteur : `31fe:0481` (`FUN_31fe_0481(index, x, y, hy8)`, une quarantaine d'appelants, par exemple `265b:000d`, `1c78:0005`, `2bd4:0093`). Elle calcule `base + 0x18 + u32[0x18 + 4·(index & 0xfff)]` (`31fe:048b`..`049c`), puis lit un enregistrement :

```
[mode u8][nb parties u8]
nb parties × {
  [type u8][nb points u8][a u8][b u8]
  nb points × (x, y)        // i8,i8 si mode = 0x10 ; i16,i16 si mode = 0x00
}
```

- `mode` : 0x10 = coordonnées sur 8 bits signés, 0x00 = sur 16 bits. Dans `31fe:0411`, chaque différence d'octet de mode (`CS:0x16`) corrige à chaud le code : le bit 0x10 transforme `LODSW` (`AD`) en `LODSB` (`AC`) + `CBW` (`98`) aux adresses `31fe:04e6`/`04de` (XOR de `0x0801`). Les bits 0x80 et 0x20 insèrent `NEG AX` sur x / y (XOR de `0x4867`) : ils proviennent surtout des bits 0x8000 / 0x2000 du premier paramètre (miroirs). Dans les fichiers, `mode` ne vaut que 0x10 (806 sprites) ou 0x00 (25 sprites).
- `type` : indice dans la table de sauts en `CS:0x19` de `31fe` (octets `17 08 54 08 b2 08 b2 08 3e 07 7e 07 c2 07 ed 07`) : 0 = `31fe:0817` (sous-sprite, rappelle `31fe:0481` avec `a` et `b`), 1 = `31fe:0854` (image), 2 et 3 = `31fe:08b2`, 4 à 7 = routines vectorielles (`073e`, `077e`, `07c2`, `07ed` : segments, rectangle, polygones, via `32xx`/`31d5`). Les 1441 parties des 33 fichiers sont toutes de type 1 avec un seul point. Le décodeur ne gère que les types 0 et 1 et refuse les autres.
- Type 1 (image, `31fe:0854`) : `a` = poids faible de l'index d'image, `b` = bits 8 à 11 de l'index (4 bits bas) + drapeaux (4 bits hauts). Le moteur passe `AX = a | ((b ^ drapeaux_sprite) << 8)` au blit, qui masque l'index par `0xfff` (`317b:01f5`). Seul le drapeau 0x80 (miroir x) apparaît dans les données (40 parties). Le point est relatif à la position demandée : x = bord gauche, y = **ligne du bas** de l'image (`317b:024b` : `ligne du haut = y - hauteur + 1`). Si miroir x, `x -= largeur` (`31fe:087b`, `32a1:0006` renvoie 16 × largeur/16), si miroir y, `y += hauteur` (`32a1:004e`). **Sauf pour une image stockée en miroir** (mot d'attributs 0x8000) : son point reste le bord gauche, miroir ou non. Constaté sur les données (2026-10-24), pas relu dans le code : avec `x -= largeur` partout, toutes les poses tournées à gauche de `s01a000s.hy8` qui utilisent ces images (saut, course, impatience, arrivée) et l'oiseau du décor qui vole vers la droite étaient décalés de 32 pixels (l'impatience à gauche sautait de 45 pixels d'une image à l'autre) ; sans ce décalage, chaque animation gauche est le miroir exact de celle de droite (test `hy8.test.ts`). Probable.
- Le moteur ne lit que le premier point d'une partie ; `Hy8Part.points` expose tous les points du fichier.

Les sprites sont indexés comme les entrées de la table : un fichier a en général plus de sprites que d'images (S01A000S : 181 sprites pour 138 images).

## Animations (table à `h[2]`)

Lecteur : `12d7:0083` (initialisation : lit `u32` à `hy8 + 8`, soit `h[2]`, et le range en `+4` de l'objet), `12d7:0008` (choix de l'animation n : `section + u32[4n]`, nb de frames = octet 1 de l'enregistrement, première frame = enregistrement + 2), `12d7:00c1` (avance d'une frame). `12d7:0144` est un simple alias de `12d7:0008`. Exemples d'appel : `1c78:0005` (S22), `2bd4:0093`.

```
[octet 0 u8, toujours 0][nb frames u8]
nb frames × 8 octets { [u16 sprite|drapeaux][u16 = 1][i16 dx][i16 dy] }
```

- `12d7:00c1` (`12d7:00e9`..`00fe`) recopie `u16[0]` dans `+0x18` de l'objet : c'est le premier argument de `31fe:0481` (index de sprite sur 12 bits, drapeaux miroir 0x8000 / 0x2000 sur les bits hauts), par exemple `FUN_31fe_0481(uRam0003ccf4, 0x46, 0xb0, hy8)` en `1c78:0005`.
- Le compteur de frames passe à 0 quand il atteint le total (`12d7:0120`), l'animation boucle donc ; le jeu teste ce retour à 0 pour détecter la fin (`iRam0003cd16 == 0` en `1c78:0005`).
- `u16[1]` est copié en `+0x1a`, `dx`/`dy` sont cumulés en `+0x1c`/`+0x1e` (`12d7:00d2`, `12d7:00e1`) : aucun code étudié ne lit ces champs. Dans les 742 frames des fichiers, `u16[1]` vaut toujours 1 et `dx = dy = 0`. Leur rôle (durée ? déplacement par frame ?) est une supposition.
- Les animations vides (`00 00`) existent : S02A000S (1 animation sans frame), S33A001S (36 sur 37).

## Section finale (`h[3]`..`h[5]`)

12 octets `0a 00 00 00 00 00 00 00 00 00 00 00` dans les 33 fichiers. Aucun accès à `hy8 + 0xc` n'a été trouvé (`12d7:0083` ne lit que `+8`, `31fe:0854` que `+4`, `31fe:0481` que `+0`). Rôle inconnu, exposé brut (`Hy8.trailer`).

## Points restant incertains

- Rôle de `u16[1]`, `dx`, `dy` des frames d'animation, et de l'octet 0 d'une animation (toujours 0).
- Section finale de 12 octets.
- Drapeau 0x2000 d'un index de sprite ou d'une partie (miroir y) : défini dans `31fe`, absent des données ; non vérifié dans le blit.
- Les types de partie 2 à 7 (jamais utilisés par les fichiers) : sémantique déduite de la table de sauts seulement.

## Vérifications

- `test/teleportaschtroumpf/hy8.test.ts` : 33 fichiers décodés, 138 / 17 / 1 images pour S01A000S / S08A000S / S25A000S, dimensions, SHA-1 de pixels croisés avec `scripts/teleportaschtroumpf/proto/hy8.py`, sprites et animations de S02A000S, S22A000S, S33A001S, données invalides.
- Contrôle exhaustif hors dépôt sur les 33 fichiers : tables de sprites et d'animations contiguës et sans trou, références d'image / de sprite / d'animation toutes valides.
