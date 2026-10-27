# Formats de données de L'Odyssée des Zoombinis

Broderbund / TERC, 1996, Windows 3.1. Inventaire des fichiers : [files.md](files.md). Référence des octets et des adresses : [engine.md](engine.md) (les sections citées ci-dessous), écrans : [screens.md](screens.md). Lecteurs : `src/data/mohawk/` (communs au moteur Mohawk, partagés avec Mathémagique) et `src/games/zoombinis/data/` ; tests : `test/zoombinis/data.test.ts` (lit les vrais fichiers de `original/zoombinis/`, ignoré s'ils sont absents).

Tout est **big-endian**. Les 21 `.MHK` et `MIDIMAP.DAT` sont des archives Mohawk, au format décrit dans [../mathemagique/formats.md](../mathemagique/formats.md) (`MohawkArchive`) ; elles n'ont pas de noms de ressources. Les ressources communes avec Mathémagique ont les mêmes lecteurs : `SHPL` (`shpl.ts`, palette éclaircie à la lecture, voir [../mathemagique/shap.md](../mathemagique/shap.md)), `\0SND` de type `WAVE` (`wave.ts`, PCM 8 bits 11 025 Hz, aucun `MIDI`), `tMID` (`midi.ts`, 18 musiques de `MIDIMPC.MHK`), `STRL` (`strl.ts`, ici en Mac OS Roman : `parseStrl(bytes, "mac-roman")`). Les images `SHAP` et les `tPAL` n'existent pas dans Zoombinis.

## Ressources

| Tag | Ressources | Lecteur | Contenu |
|---|---:|---|---|
| `tBMP` | 174 | `src/data/mohawk/tbmp.ts` | image isolée ou planche multi-images (voir ci-dessous) |
| `SHPL` | 41 | `src/data/mohawk/shpl.ts` | palette du fond ; le premier mot est l'id de la ressource |
| `SCRB` | 1 784 | `script.ts` | séquences d'images d'objets (décor, interface, puzzles) |
| `SCRS` | 719 | `script.ts` | séquences d'images des Zoombinis et créatures assimilées |
| `NODE` | 9 | `node-path.ts` | points de passage d'un écran |
| `PATH` | 9 | `node-path.ts` | chemins entre points de passage |
| `REGS` | 79 | `regs.ts` | mots signés : ancrages des planches, tables d'épreuve |
| `CURS` | 5 | `curs.ts` | curseurs 16 × 16 de `ZOOMBINI.MHK` |
| `SYSX` | 2 | `sysx.ts` | messages MIDI courts de `MIDIMAP.DAT` |
| `\0SND` | 1 333 | `wave.ts` | sons |
| `tMID` | 18 | `midi.ts` | musiques de `MIDIMPC.MHK` (ids ≥ 30 000) |
| `STRL` | 40 | `strl.ts` | textes de `TEXTSTR.MHK` (Mac Roman) |

`archives.ts` donne les noms des archives, les tags constants et la table écran -> archive -> épreuve (`engine.md` §2.1 et §2.3). Convention : le fond d'un écran de jeu a l'id 1000 (`SHPL`, `tBMP`, `NODE`, `PATH`) ; l'id d'un groupe de formes est celui de son premier `SCRB`.

## `tBMP` — images — `tbmp.ts` (`decodeTbmp`, `decodeTbmpImages`, `isTbmpSheet`)

Entête de 8 octets `(largeur, hauteur, pas, drapeaux)` et algorithmes de `SHAP` (`shap.ts` : LZ 0x100, RLE par lignes 0x10, 8 bits). Drapeaux présents : 0x002, 0x012, 0x102, 0x112. `decodeTbmp` (image isolée) est inchangé pour Mathémagique.

| Variante | Ressources | Contenu |
|---|---:|---|
| image isolée (0x002, 0x012, 0x102, 0x112) | 64 (15 + 30 + 15 + 4) | une `Shape` |
| planche multi-images, drapeaux 0x002 | 83 | table puis sous-images |
| planche multi-images, drapeaux 0x102 | 27 | idem, table et sous-images compressées en LZ |

Planche : octets 0 `n` (nombre d'images, tient lieu de largeur), 2 hauteur sans usage, 4 pas = `(n + 3) & ~3`, 6 drapeaux, 8 `n` décalages u32 absolus (le premier vaut `8 + 4 n`), puis les sous-images, chacune un `SHAP` complet (0x012 : 6 558 ; 0x002 : 2 153 dans les planches brutes ; jamais de LZ) alignée sur 4 octets. Une planche 0x102 a, à partir de l'octet 8, l'entête LZ de `shap.ts` (10 octets) puis les données : une fois décompressées, elles contiennent la table et les sous-images, les décalages restant comptés comme si l'entête de 8 octets les précédait (décalage `o` = octet `o - 8` des données décompressées). La détection (`isTbmpSheet`) vérifie `largeur == n`, le pas, les drapeaux, le premier décalage et la croissance des décalages (après LZ pour 0x102) : les images isolées échouent à ce test. `decodeTbmpImages` rend une `Shape` pour une image isolée, les `n` sous-images pour une planche (la partie `w` d'un script est à l'indice `w - 1`). L'indice de couleur 0 est transparent pour les sprites.

Écart avec `engine.md` §5.2 : la planche en LZ n'y figure pas (il compte 83 planches et 8 711 images) ; le décompte mesuré est de 110 planches (83 + 27) et 10 068 images au total.

## `SCRB` / `SCRS` — scripts d'images — `script.ts` (`parseScrb`, `parseScrs`)

Voir `engine.md` §3. `SCRB` : u16 `n` ; `SCRS` : u16 `n`, u16 type de pose (0, 1, 2, 3, 0xffff ; rôle inconnu). Puis `n` images, chacune lue case par case, 24 cases au plus :

| Mot `w` (i16) | Contenu |
|---|---|
| `w > 0` | partie : indice 1-based dans la planche du groupe, puis i16 `x`, i16 `y` (pixels de l'écran 640 × 480) |
| `w == 0` | case vide : consomme aussi `x` et `y` |
| `w < 0` | terminateur. Octet bas = numéro d'évènement (0 = aucun ; le rappel du moteur reçoit `numéro - 1`) ; si `w < -0x100` (`0xfe..`), un mot suivant est l'id du `\0SND` |

Le lecteur rend, par image, `cells` (vides comprises), `event`, `soundId` et le mot terminateur brut. Dans un `SCRS`, les numéros `0xc9`…`0xd9` désignent des sons dépendant du Zoombini (`snoidVoiceCode` donne le code de voix, §3.7). Les cases se recalent avec les `REGS` du groupe quand il en a.

**Images de 24 cases** (point ouvert 3 d'`engine.md`). La boucle de lecture du moteur s'arrête à 24 cases et ne consomme pas le terminateur, qui est relu comme premier mot de l'image suivante. Le lecteur reproduit cette boucle : l'image de 24 cases est rendue avec `terminated: false` (`event` 0, pas de son), l'image suivante ne contient aucune case et porte le terminateur, et seules les `n` images annoncées sont lues, si bien que les dernières images réelles ne sont jamais atteintes (`trailingWords` > 0). Choix de fidélité : si l'original n'est pas tronqué ainsi (point à tester en jeu), c'est ce comportement qu'il faudra changer. Écart de décompte : 8 `SCRB` seulement sont touchés (`FERRY.MHK` 1517, 1518, 1519, 1523, 1524, 1527, 1529 et `LILLY.MHK` 10169), et non 18 ; aucun `SCRS` ne l'est. Tous les autres scripts se lisent exactement jusqu'au dernier octet.

## `NODE` / `PATH` — `node-path.ts`

| Tag | Contenu |
|---|---|
| `NODE` | u16 `n`, puis `n` couples u16 `x`, u16 `y` (pixels ; quelques points d'entrée sont hors de l'écran, jusqu'à x = 701) |
| `PATH` | u16 `n`, puis `n` blocs de 24 octets : indices de nœuds (1-based dans `NODE`) terminés par 0, bourrage à 0 |

Toujours l'id 1000, dans `BASECAMP`, `BCTWO`, `CAVES`, `HOTEL`, `LILLY`, `PICKER`, `PIZZA`, `SLIDES` et `TUNNELS` (inutilisées par `HOTEL` et `LILLY`). Les vitesses et règles de déplacement (point ouvert 10) ne sont pas lues ici.

## `REGS` — `regs.ts` (`parseRegs`, `parseAnchors`, `anchorPosition`)

Tableau de mots i16, sans structure imposée. Pour une planche `tBMP id` : `REGS id` = X et `REGS id + 1` = Y, un mot par sous-image indexé par `w` (mot 0 = 0), soit `(n + 1) × 2` octets ; une partie `(w, x, y)` est posée à `(x - X[w], y - Y[w])`. Les autres `REGS` (tables d'épreuve : `LILLY` 15000…, `MAZE2` 16000…, `FLEENS` 5000 / 5001…) restent des tableaux bruts, à interpréter par l'épreuve. Ancrages des Zoombinis : `tBMP` 3000 avec `REGS` 100 / 101, 3100 avec 102 / 103, 3200 avec 3200 / 3201.

## `CURS` — `curs.ts`

68 octets : 16 × u16 plan « image » (1 = noir, bit 15 = pixel de gauche), 16 × u16 plan « masque » (1 = opaque), u16 + u16 point chaud. Rendu : noir (image 1, masque 1), blanc (image 0, masque 1), transparent (masque 0). Le lecteur prend `x` = premier mot, `y` = second (point ouvert 12 : le code lit le second en premier). Hotspots lus : `CURS` 1 = (8, 6), `CURS` 2 à 5 = (0, 0).

## `SYSX` — `sysx.ts`

`MIDIMAP.DAT` : 2 ressources identiques (ids 1 et 0xffff) de 192 octets = 64 messages de 3 octets (état, données 1, données 2). Dans l'ordre : réinitialisation des contrôleurs (`Bn 79 00`) pour les 16 canaux, puis volume 127 (`Bn 07 7f`), expression 90 (`Bn 0b 5a`) et panoramique centré (`Bn 0a 40`), chacun pour les 16 canaux.

## Points ouverts qui touchent les lecteurs

- Images de 24 cases : comportement fidèle à la boucle documenté plus haut ; à valider en jeu.
- `SCRS` : le second mot d'entête (pose) est conservé tel quel ; la traduction des numéros de partie en indices de planche (points ouverts 2) n'est pas faite ici.
- Terminateurs : le sens des numéros d'évènement dépend de chaque épreuve (point ouvert 4) ; les lecteurs ne l'interprètent pas.
- `CURS` : ordre du point chaud supposé (point ouvert 12).
- `tBMP` de drapeaux ≥ 0x200 (décompresseurs externes) : absents des données, non gérés.
