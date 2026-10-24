# Images `SHAP`, formes et palettes `SHPL` (Math Workshop)

Lecteurs : `src/games/mathemagique/data/{shap,shpl,palette,tbmp,tpal}.ts`, tests : `test/mathemagique/images.test.ts`, rendu de contrôle : `scripts/mathemagique/render-samples.mts`. Adresses `sélecteur:offset` de la décompilation de `MATH` (voir [re-index.md](re-index.md)). « Hypothèse » marque ce qui n'est pas prouvé par le code de `MATH`.

Résultat : les **16 258** `SHAP` des 18 `.DAT` se décodent sans erreur ; les 844 `SHPL` se lisent ; les écrans rendus (titre, hall, logo, photos) ont les bonnes couleurs et aucun cisaillement.

## Vue d'ensemble

- Une `SHAP` est une image **indexée** (8 bits, ou 1 bit pour des masques), sans palette propre. Tout est **big-endian**.
- Pipeline de lecture dans `MATH` : LZ à la lecture de la ressource, puis RLE par ligne au moment du dessin.
- La palette est une table globale de 256 entrées en mémoire (`DS:8bda`), alimentée par les ressources `SHPL`. Il n'y a **aucune palette codée en dur** dans `MATH` ni de `tPAL` pour les `.DAT`.
- La transparence est l'**index 0**.

## Entête d'une `SHAP`

| Octets | Champ | Rôle |
|---|---|---|
| 0 | u16 largeur | pixels par ligne |
| 2 | u16 hauteur | |
| 4 | u16 pas | octets par ligne du bitmap décompressé. 8 bits : largeur arrondie au multiple de 4 (RLE : sans objet, voir plus bas). 1 bit : `⌈largeur/8⌉` arrondi au multiple de 4 |
| 6 | u16 drapeaux | voir ci-dessous |
| 8 | (si 0x100) u32 taille décompressée | |
| 12 | (si 0x100) u32 taille compressée | |
| 16 | (si 0x100) u16 taille d'anneau | toujours `0x0400` |
| 18 (ou 8 sans LZ) | données | |

Preuve : `10d8:5ff3` lit `w`, `h`, `pitch`, `flags` aux octets 0, 2, 4, 6 (via `10b0:0630`, échange des octets d'un mot) et passe les données à `octet 8` ; `10d8:ad2c` lit le mot à l'octet 16 (doit valoir `0x400`) et le u32 à l'octet 8 (`10b0:05de`).

Drapeaux (valeurs observées sur les 16 258 images : `0x112` 14 458, `0x000` 944, `0x102` 695, `0x002` 68, `0x100` 80, `0x012` 13) :

| Bit | Sens |
|---|---|
| 0-2 | profondeur : 0 = 1 bit par pixel (masque), 2 = 8 bits (hypothèse sur la valeur 2 : seule autre valeur vue, avec le pas multiple de 4) |
| 0x010 | **RLE** par ligne |
| 0x100 | **LZ** : les données sont précédées des 10 octets décrits ci-dessus |

Les bits `0xf00` sont l'« état de compression » : `10d8:ad2c` (appelée par `10a8:0379` à la lecture d'une `SHAP`, et par `1088:1a35`) ne traite que `(flags & 0xf00) == 0x100` avec mot d'anneau `0x400`, alloue `taille décompressée + 8`, recopie l'entête de 8 octets, **efface le drapeau LZ**, puis décompresse après l'entête. Le dessin (`10d8:5ff3`) refuse tout `flags & 0xf00` restant : c'est ce qui prouve que le LZ précède le RLE.

Cas particuliers : 5 `SHAP` de 12 octets (1×1, brutes, pas 4 : `0001 0001 0004 0002` + 4 octets) ; la taille déclarée par l'archive est souvent arrondie au secteur, la fin est du bourrage.

## LZ (`10d8:ae3a`)

LZSS à anneau de 1024 octets. Décodage vérifié sur le désassemblage (`ae3a` : anneau de `0x400` octets mis à zéro, position d'écriture initiale `0x3be`, masque `0x3ff`) :

```
anneau[1024] = 0 ; w = 0x3be ; drapeaux = 0
tant que sortie < taille décompressée :
  si (drapeaux & 0xff00) == 0 : drapeaux = lire_octet() | 0xff00
  bit = drapeaux & 1 ; drapeaux >>= 1
  si bit : b = lire_octet() ; sortie += b ; anneau[w] = b ; w = (w+1) & 0x3ff
  sinon  : hi = lire_octet() ; lo = lire_octet()      (u16 BE = hi<<8 | lo)
           p = ((hi<<8) | lo) & 0x3ff ; n = (hi >> 2) + 3
           répéter n fois : b = anneau[p] ; p = (p+1) & 0x3ff ; sortie += b ; anneau[w] = b ; w = (w+1) & 0x3ff
```

C'est l'algorithme « LZ » des archives Mohawk (ScummVM : `MohawkBitmap::unpackLZ`, dictionnaire `0x400`), sans la complication de la position absolue : `p` est directement l'index dans l'anneau. Le flux compressé consommé est inférieur de 0 à 17 octets à la « taille compressée » de l'entête (le codeur déclare la fin du dernier groupe de 8 éléments) ; 42 ressources sont plus courtes que la taille déclarée dans l'entête (taille de l'archive arrondie vers le bas), sans conséquence pour le décodage.

## RLE (drapeau 0x010)

Après le LZ (ou directement si seul 0x010 est présent), le bitmap est stocké ligne par ligne :

```
pour chaque ligne :
  taille = u16 BE                       (octets de la ligne, compteur compris : permet de sauter une ligne)
  tant que x < largeur :
    code = lire_octet() ; n = (code & 0x7f) + 1
    si code & 0x80 : répéter n fois l'octet suivant
    sinon           : copier n octets
  se placer à (début de ligne + taille)
```

Preuve : `10d8:45d1` (dessin RLE, fonction sans appelant direct, atteinte par une table de méthodes) saute les lignes rognées en lisant `u16 BE` et en avançant (`4677`–`467e`), lit pour chaque ligne le `u16 BE` de fin (`48eb`–`48f6`) puis, par code, `BTR DX,7` (bit 7) et `INC DX` (longueur - 1 + 1) : bit 7 positionné = répétition (`INC ESI` : saute l'octet de valeur), sinon copie (`ADD ESI,EDX`). Le pas de l'entête ne sert pas au décodage RLE (la source est lue en continu).

## Dessin, modes et transparence

`10d8:5ff3` (appelée par `1090:0c25`, `10a8:0ce4`, `1018:058e`) construit l'appel à la méthode `+0x38` d'un objet de contexte (`10d8:5484`, découpage par rectangles) avec un **mode de dessin** : l'octet de réglage du sprite (`1090:0c25` : quartet bas ; la valeur 10 est remplacée par 8). Les blitters sont :

| Fonction | Source |
|---|---|
| `10d8:4438` | bitmap brut 8 bits (`flags & 0x10 == 0`) |
| `10d8:45d1` | bitmap RLE |
| `10d8:494d` | masque 1 bit, bit de poids fort à gauche, mots de 32 bits : dessine une **couleur unie** (paramètre du dessin, hypothèse sur son origine) là où le bit vaut 1 |

Modes de `10d8:4438` (table de sauts `10d8:4517`) : 0 copie, 1 AND, 2 OR, 3 XOR, 4 NOT, 5 AND NOT, 6 OR NOT, 7 XOR NOT, **8 copie en sautant les octets sources égaux à 0**. La table de `10d8:45d1` (`CS:468d`) est la même ; son mode 8 saute les **répétitions** de 0 (octet `3c 00`/`74` dans le gestionnaire `4873`), alors que les copies littérales sont recopiées telles quelles (hypothèse : lecture directe des octets du gestionnaire, non désassemblé par Ghidra).

Conséquence : **index 0 = transparent** en mode 8. Les fonds d'écran n'utilisent jamais l'index 0 ; les sprites ont des coins à 0 (test `images.test.ts`).

Pas de point d'accroche (« hotspot ») dans l'entête : la position vient du script de l'écran (`\0SCR`, `1090:0c25` ajoute les décalages du sprite). Les curseurs sont des ressources `CURS` séparées.

## Palette

### Où elle est construite

- Table globale de **256 entrées de 4 octets** (R, G, B, 0) à `DS:8bda` ; une copie de secours à `DS:8fda` (`10a8:0e86` copie `n` entrées de l'une vers l'autre).
- Une `SHPL` chargée (`10a8:0640`) écrit ses entrées à `DS:8bda + premier_index × 4`, puis appelle `1098:0857` qui **éclaircit** chaque composante non nulle : `v ← v + 31 − ⌊v / 8⌋` (0 reste 0, 255 reste 255). Sans cet éclaircissement les couleurs sont trop sombres ; avec, les écrans rendus sont corrects. C'est la seule conversion.
- Windows reçoit la table via `CreatePalette` (`10d8:6c4c` : `LOGPALETTE` de version `0x300`, 256 entrées, copiées d'un tampon : hypothèse que la source est `DS:8bda`) ; les entrées sont donc des `PALETTEENTRY` (R, G, B, drapeaux), ce que confirment les données (`ff ff ff 00`).
- `10d8:6c84` bascule `SetSystemPaletteUse` : le jeu prend la palette système (hypothèse : `SYSPAL_NOSTATIC`, index 0 noir et 255 blanc comme point de départ ; `palette.ts` part de cet état).

### Contenu d'un `SHPL`

| Octets | Champ | Preuve |
|---|---|---|
| 0 | u16 id de la première `SHAP` de la liste (= id du SHPL ; 841 cas sur 844, 3 orphelins) | `1018:0ac2` boucle sur `id` … `id + n − 1` avec la balise `SHAP` ; `1088:1a35` demande `id + i − 1` |
| 2 | u16 nombre `n` de `SHAP` consécutives | même boucle ; `10a8:0640` le renvoie (taille du « shape array », `10a8:0200`) |
| 4 | u16 premier index de palette | `10a8:0640` : offset de destination `4 × index` |
| 6 | u16 nombre d'entrées `c` | longueur de la recopie (`c × 4` octets) |
| 8 | `c` × (R, G, B, 0) | |

Plages observées : **10 + 236** entrées (palette d'un écran complet : index 10 à 245, les 10 premières et dernières places sont celles du système) ; **216 + 15…17** (palette de photo, niveaux de gris) ; **255 + 1** ; **154 + 40/80** ; `c = 0` (8 octets : la forme utilise la palette en cours). Construction : appliquer dans l'ordre le SHPL du fond de l'écran, puis ceux des sprites ajoutés (le SHPL d'un sprite de `MAINSCRN.DAT` redéfinit seulement 216-232 ou l'index 255).

## `MPC/PVG.MHK` : `tBMP` et `tPAL`

Module hors de `MATH` (jamais analysé) ; formats déduits des données (hypothèses) :

- **`tBMP`** (128) : exactement le format `SHAP` (entête 8 octets, LZ, RLE) ; les 128 se décodent (fonds 512×384, boutons, textes…). `tbmp.ts` délègue à `shap.ts`.
- **`tPAL`** (8) : u16 premier index (10), u16 nombre (22 ou 236), puis entrées (R, G, B, 0) ; 2 048 octets dont le reste est du bourrage. Les valeurs brutes donnent un menu correct : l'éclaircissement de `1098:0857` ne leur est pas appliqué (`applyShpl(..., false)`).
- `tWAV` : voir [formats.md](formats.md).

## Points ouverts

- La méthode de dessin qui choisit entre `4438`, `45d1` et `494d` (vtable +0x38 de l'objet de contexte, 1 bit : couleur unie) n'a pas été localisée ; le choix par drapeaux est une hypothèse.
- Code de profondeur 2 = 8 bits : hypothèse (aucune autre valeur vue, jamais de valeur 1, 3, 4).
- Zéros isolés dans les copies littérales d'un sprite RLE en mode 8 (voir plus haut) : à vérifier au rendu d'un sprite à bords dentelés.
