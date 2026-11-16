# Gabriel Knight : formats des fichiers

Légende : **vérifié** par script sur les vrais fichiers (CD extrait dans le scratchpad, scripts Python lancés en `python3 -I`, rien d'exécuté) ; **lu** dans les octets, les chaînes de `SIERRA.EXE` ou une documentation externe, cohérent sur quelques exemples sans validation exhaustive ; **supposé** (connaissance générale de SCI, à confirmer en lisant ScummVM).
Source : CD français de *Gabriel Knight: Sins of the Fathers* (Sierra, 1993). `VERSION` : « 1.000.000 / Gabriel Knight French CD / May 3, 1994 » ; `RESOURCE.CFG` : `language = 33` (français ; le fichier n'est pas versionné : l'interpréteur range cette valeur dans `printLang` de l'objet du jeu au démarrage, `engine.md` § 2). Interpréteur `SIERRA.EXE` : DOS/4G, daté « Nov 23 1993 20:36:03 » (vérifié).
**Moteur : SCI2 (premier SCI32)**, pas SCI1.1 : scripts et heaps séparés, graphismes par plans et éléments d'écran (`AddPlane`, `AddScreenItem`, `FrameOut`), pas de pics vectoriels, pas d'analyseur de phrases (vérifié : types de ressources, § 9 ; table des noyaux, § 15).
Références externes : ScummVM `engines/sci` (GPL v3 ou ultérieure) et son wiki SCI. L'étude initiale n'en avait rien lu (ce qui venait de mémoire est marqué **supposé**) ; **la vague D (lecteurs) a lu les fichiers cités en tête de chaque module de `src/games/gk1/data/`** : ce qui en vient est marqué « lu (ScummVM) ». Convention de reprise : `plan.md`.
**Depuis la vague D, « vérifié » désigne aussi les tests de `test/gk1/data/`**, qui relisent les fichiers de `original/gk1/` avec les lecteurs TypeScript et retrouvent les comptes de ce document.
Scripts d'étude (hors dépôt, scratchpad `tools/`) : `gk1lib.py` (map, en-tête de volume, LZS, SOL), `fmt_probe*.py` (comptes de ce document), `misc.py`, `audio.py`.

## 1. Contenu du CD (vérifié)

| Chemin | Octets | Rôle |
| --- | --- | --- |
| `RESOURCE.MAP`, `RESOURCE.000` | 11 Ko ; 12,7 Mo | **ressources** (§ 2) : vues, pics, scripts, heaps, messages français, sons MIDI, polices, palettes |
| `ALT.MAP`, `RESOURCE.ALT` | 364 ; 3,4 Mo | 59 vues en haute résolution (§ 13) |
| `RESOURCE.SFX` | 13,0 Mo | 186 WAV (bruitages, musiques numérisées), indexés par la map 65535 (§ 11) |
| `AUD/RESOURCE.AUD` + 31 fichiers `@…` et `#…` | ~120 Mo | voix anglaises (7 469 clips SOL) et leurs patchs en base 36 (§ 11) |
| `SFX/*.WAV` | 24,8 Mo | 46 WAV, ressources audio par numéro (§ 11) |
| `PATCHES/316.SND`, `803.SND` | 98 ; 98 | patchs de ressources sound (§ 14) ; `PATCHES/A` : 1 octet, sans intérêt |
| `SEQ/*.SEQ` | 10,7 Mo | 25 cinématiques (§ 12) |
| `SIERRA.EXE` | 672 Ko | interpréteur ; **non exécuté**, sert de documentation (chaînes : § 15) |
| `*.DRV` | petits | pilotes son et vidéo (`ADL`, `GENMIDI`, `MT32`, `DAC*`, `VGA`, `VESA`…), non lus |

**Utile au portage** : `RESOURCE.MAP/000`, `ALT.MAP`/`RESOURCE.ALT`, `PATCHES/*.SND`, `SEQ/`, et l'audio converti à l'extraction (`plan.md`). **Ignoré** : installateur (`INSTALL.*`, `BOOTDISK.EXE`, `GKCHECK.BAT`), `VESATEST.EXE`, pilotes, `SIERRA.ERR`, `README`/`LISEZMOI`.

## 2. RESOURCE.MAP et volume (vérifié)

```
RESOURCE.MAP : { u8 type ; u16 offset } … jusqu'à type 0xFF (son offset = fin du fichier) ; 4 octets 34 12 00 00 (lus par personne) ;
  par type, entrées de 6 octets : u16 numéro ; u32 offset dans RESOURCE.000
RESOURCE.000, à chaque offset, en-tête de 13 octets :
  u8 type | u16 numéro | u32 taille compressée (sans l'en-tête) | u32 taille décompressée | u16 méthode
```
1 892 entrées, dont 7 doublons (vues 663 et 9591, pic 900, scripts et heaps 93 et 94), soit 1 885 ressources distinctes. Méthodes : **32 = LZS** (1 814), **0 = brut** (78 : les 74 maps et 4 scripts). Les 1 892 se décompressent à la taille annoncée, et leurs en-têtes et données pavent `RESOURCE.000` du premier au dernier octet, sans trou ni recouvrement (vérifié).

| Type | Nom | Nb distincts | Décompressé | § |
| --- | --- | --- | --- | --- |
| 0x80 | view | 837 | 19,3 Mo | 4 |
| 0x81 | pic | 158 | 6,4 Mo | 5 |
| 0x82 / 0x91 | script / heap | 213 / 213 (mêmes numéros) | 0,68 / 0,25 Mo | 8 |
| 0x84 | sound | 288 | 1,2 Mo | 10 |
| 0x86 | vocab | 4 (994, 996, 997, 998) | 20 Ko | 8 |
| 0x87 | font | 11 (0, 1, 2, 3, 4, 7, 8, 30, 40, 999, 9561) | 29 Ko | 7 |
| 0x89 | patch | 3 (1, 3, 4) | 26 Ko | 10 |
| 0x8b | palette | 7 (260, 330, 370, 500, 510, 999, 3301) | 6 Ko | 6 |
| 0x8f | message | 77 | 1,0 Mo | 9 |
| 0x90 | map | 74 (73 modules audio36 + 65535) | 58 Ko | 11 |

Absents : text (0x83), cursor (0x88), bitmap (0x8a), et `vocab 999` (les noms des noyaux sont dans l'exe, § 15). Les curseurs sont des vues (`SetCursor`, lu).
**Doublons** (vérifié) : les deux copies de chacune des 7 ressources se décompressent en octets identiques ; le choix est donc sans effet. Le lecteur garde **la dernière entrée**, comme ScummVM (`readResourceMapSCI1` : une ressource de volume déjà connue est remplacée par la nouvelle entrée, jamais un patch).

## 3. Compression LZS (vérifié)

Méthode 32 (« STACpack »). Flux de bits, poids fort d'abord :
- bit 0 : un octet littéral (8 bits) ;
- bit 1 : copie. Bit suivant 1 : distance sur 7 bits (**0 = fin du flux**) ; 0 : distance sur 11 bits. Puis la longueur : 2 bits (0 à 2 → 2 à 4) ; si 3, encore 2 bits (0 à 2 → 5 à 7) ; si 3, 8 + somme de quartets, tant que le quartet vaut 15.
- La copie se fait octet par octet (les zones peuvent se chevaucher).
- Le marqueur de fin est présent dans les 1 814 flux, exactement à la taille annoncée (vérifié : le lecteur l'exige).

Lecteur : `data/lzs.ts` (prototype : `lzs()` de `gk1lib.py`). Pas d'autre méthode dans ce CD (ni LZW ni Huffman ni DCL).

## 4. Vues (vérifié sur 837 vues, 15 698 cels)

```
En-tête : u16 taille d'en-tête (16, sans ce champ) | u8 nb boucles | u8 0 | u8 1 | u8 résolution (0 ici ; 1 ou 2 dans RESOURCE.ALT, § 13)
          u16 nb cels au total | u32 offset de la palette | u8 taille d'un en-tête de boucle (16) | u8 taille d'un en-tête de cel (36) | u16 0 | u16 0
Boucle (16 octets, à partir de 2 + taille d'en-tête) : u8 boucle source (0xFF = aucune) | u8 miroir | u8 nb cels | … | u32 offset des cels @12
Cel (36 octets) : u16 largeur | u16 hauteur | i16 origine x | i16 origine y | u8 couleur transparente | u8 compression (0x8A, ou 0 = brut)
                  u16 @10 drapeaux (0 partout) | u32 @12 taille des deux flux | u32 @16 taille du flux de contrôle | u32 @20 palette (0) | u32 @24 offset du contrôle (ou des pixels bruts) | u32 @28 offset des littéraux | u32 @32 offset de la table des lignes
Bloc            : marqueur de 6 octets u8 0 | u8 étiquette | u32 taille, devant chaque bloc : 3 = palette, 4 = données des cels, 5 = tables des lignes (taille 0)
```
- Les tailles d'en-tête sont identiques partout (16, 16, 36). **Toutes les vues ont une palette embarquée** (format du § 6).
- **Disposition, sans aucun octet inexpliqué** (vérifié sur les 837 vues et les 59 de `RESOURCE.ALT`) : en-tête, en-têtes de boucles, en-têtes de cels, puis trois blocs marqués : palette (la taille du marqueur est celle de la palette), données des cels (taille = distance au marqueur suivant), tables des lignes. L'interpréteur n'a pas besoin des marqueurs : tout s'atteint par offset. Octet @4 de l'en-tête : 1 quand la vue a des cels compressés, 0 pour les 15 vues brutes de `RESOURCE.ALT` (vérifié). Octets 3 à 11 d'une boucle : `FF FF FF FF 03 00 00 00 00` partout (non lus).
- 148 boucles renvoient à une autre (octet 0 ≠ 0xFF) : pas de cels propres (vérifié). 147 ont l'octet « miroir » à 1 : dessin retourné horizontalement (lu, ScummVM `CelObjView`) ; **une seule l'a à 0** : mêmes cels, non retournés.
- **RLE 0x8A, deux flux** (vérifié : les 15 698 cels se décodent ligne par ligne à la largeur exacte, sans dépasser le flux de contrôle) : octet de contrôle `c` ; bit 7 nul : copie `c` littéraux ; bits 7-6 = `10` : répète 1 littéral `c & 0x3F` fois ; `11` : `c & 0x3F` pixels transparents (aucun littéral lu). La table des lignes donne `hauteur` offsets u32 dans le flux de contrôle, puis `hauteur` dans les littéraux (vérifié : chaque entrée égale la position atteinte par le décodage séquentiel ; utile pour le dessin rogné ou mis à l'échelle). Le décodage consomme exactement la taille @16 de contrôle et `@12 − @16` de littéraux (vérifié sur tous les cels).
- **Origine d'un cel de vue (vérifié au rendu, vague G1 ; ScummVM `CelObjView` et `ScreenItem::calcRects`)** : les champs @4 et @6 (nommés « origine » dans le tableau ci-dessus) sont un **décalage** `(dx, dy)`, pas le point d'ancrage. L'ancrage dans le cel vaut `(largeur / 2 − dx, hauteur − dy − 1)` (division entière) ; le cel se dessine à `position − ancrage × échelle`, et pour un cel retourné l'ancrage x devient `largeur − ancrage x − 1`. Exemples : la marche de Gabriel (vue 0, cels 43×56, décalage (2, 0)) s'ancre en (19, 55), en bas au milieu ; les boutons de l'écran titre (vue 100, 35×10, décalage (17, 9)) et la vue 26 (145×88, décalage (72, 87)) s'ancrent en (0, 0), en haut à gauche : c'est ce qui les place là où on les voit. Un cel de pic garde ses champs tels quels, toujours (0, 0).
- **Miroir au rendu (vérifié, vague G1)** : une boucle qui renvoie à une autre avec l'octet « miroir » à 1 se dessine retournée, colonne `largeur − 1 − x` ; `OnMe` et `SetNowSeen` suivent le même retournement. La boucle renvoyée avec l'octet à 0 montre les cels de sa source à l'endroit (lu : même code, sans retournement ; aucune scène du démarrage ne l'utilise).
- **Couleurs de remplacement** (lu, ScummVM `MAPPER_NoMap`) : un cel de vue qui contient une couleur de 236 à 254 autre que sa couleur transparente ne dessine aucun pixel de 236 à 255 tant qu'aucun `RemapColors` n'est actif (vague G2).
- Drapeaux @10 (lu, ScummVM) : `0x80` = renseignés, `0x01` = pixels transparents, `0x02` = couleurs de remplacement. Toujours 0 ici : le moteur doit analyser les pixels lui-même s'il en a besoin (`RemapColors`).

## 5. Pics (vérifié sur 158 pics)

```
En-tête (14 octets) : u16 14 | u8 nb cels | u8 @3 (1 si des cels sont compressés : 108 pics ; 0 : 50 ; vérifié) | u16 taille d'un en-tête de cel (42) | u32 offset de la palette | u16 0 | u16 0 (résolution : 320×200)
Cel (42 octets) : comme un cel de vue jusqu'à @32, puis i16 @36 priorité | i16 @38 x | i16 @40 y
```
- Un pic est une pile de cels bitmap : 102 pics en ont 1, les autres 2 à 11. Le cel 0 est le fond (priorité −1000 dans les 158 pics) ; les suivants portent une priorité (53, 64, 74, 85, 95, 106, 116, 121, 127, 138, 148, 159, 169, 180, ou 1000) et une position : ce sont les avant-plans qui masquent les acteurs (lu).
- Compression : 0x8A (297 cels) ou 0 = brut (162 cels : `largeur × hauteur` octets à l'offset @24). **Toutes les pics ont une palette.** Origine (0, 0) et position dans l'écran pour les 459 cels (vérifié).
- **Disposition sans octet inexpliqué** (vérifié sur les 158 pics) : mêmes blocs marqués que les vues (§ 4) ; le bloc 5 manque dans les 50 pics dont tous les cels sont bruts.
- Tailles du cel 0 : 320×190 (95), 320×146 (24), 320×124 (14), 320×200 (8), 240×106 (8)… : coordonnées **320×200** (champs de résolution à 0). Pas de données vectorielles, pas de carte de priorité ni de contrôle séparée (les zones de marche sont des polygones dans les scripts : `AvoidPath`, `InPolygon`, § 15).

## 6. Palettes (vérifié pour les tailles, lu pour les champs)

Même bloc dans les ressources palette, à la fin des vues et des pics, et en tête des SEQ. Deux tailles : **1 057 octets** (4 octets par couleur : `utilisée, R, V, B`) et **802 octets** (3 octets : `R, V, B`).
```
En-tête de 13 octets : 0x0E au premier octet ; u8 @10 nb de palettes (1) ; puis un u16 par palette (taille de son entrée) ; puis entrée de 22 octets :
  u8 @10 première couleur | u16 @14 nb couleurs | u8 @16 « utilisée » par défaut | u8 @17 format (0 = 4 octets, 1 = 3 octets) | u32 @18 version
```
**Les 7 ressources palette, les palettes des 837 + 59 vues, des 158 pics et des 25 SEQ se lisent ainsi jusqu'à leur dernier octet** (vérifié) : 255 couleurs à partir de 0 (la couleur 255 n'est jamais définie), version 0. Les octets 2 à 9 de l'en-tête et 0 à 9 de l'entrée changent d'une ressource à l'autre (c'est ce qui distinguait les palettes 500 et 3301) : mémoire non initialisée de l'outil d'origine, que ni l'interpréteur ni ScummVM (`HunkPalette`) ne lisent. Composantes sur 8 bits (lu, ScummVM). Drapeau « utilisée » : 1 pour toute couleur définie ; une couleur à 0 ne doit pas être fusionnée dans la palette courante (lu, ScummVM). Cycles (`PalCycle`), variations (`PalVary`, fondus et nuit) et couleurs de remplacement (`RemapColors`) sont des calculs du moteur, pas des formats.

## 7. Polices (vérifié sur les 11)

`u16 0 | u16 nb glyphes (226, ou 256 pour la police 2) | u16 hauteur de ligne | u16 offset[nb]` ; glyphe : `u8 largeur | u8 hauteur | lignes de ⌈largeur/8⌉ octets, 1 bit par pixel, poids fort à gauche`. Le dernier glyphe finit exactement à la fin de chaque ressource. Hauteurs de ligne : 7 à 23. 2 516 glyphes en tout (vérifié). Jeu de caractères : CP850, comme les messages (vérifié à l'œil : une réplique accentuée rendue avec la police 0). **Les polices de 226 glyphes s'arrêtent à 0xE1** (« ß ») : le « ° » (0xF8) de trois messages n'existe que dans la police 2 (§ 16).

## 8. Scripts, heaps, vocabulaires

Chaque script `n` va avec le heap `n` (213 paires). Le **script** porte le code et les dictionnaires (lecture seule) ; le **heap** porte les variables locales, les objets et les chaînes (modifiable, sauvegardé).

```
Script : u16 @0 offset de la table de relocation | u32 @2 0 | u16 @6 nb exports | u16 exports[] @8 | dictionnaires et code | relocation : u16 n, u16 offset[n] (jusqu'à la fin)
Heap   : u16 @0 offset de la table de relocation | u16 @2 nb variables locales | u16 locales[] | objets | u16 0 | chaînes | relocation (idem)
Objet  : u16 0x1234 | u16 nb de propriétés (en mots, celles-ci comprises) | u16 offset du dictionnaire de propriétés (script) | u16 offset du dictionnaire de méthodes (script)
         u16 0 | u16 espèce (numéro de classe ; 0xFFFF pour une instance) | u16 classe mère (numéro de classe ; 0xFFFF = aucune) | u16 info (0x8000 = classe) | u16 nom (offset dans le heap) | propriétés suivantes…
Dictionnaire de méthodes : u16 n | { u16 sélecteur ; u16 offset du code } × n
```
- **Vérifié** : les deux tables de relocation finissent exactement à la fin des 213 scripts et des 213 heaps ; la marche d'objet en objet (`0x1234`, taille en mots) aboutit partout ; 2 629 objets dont 170 classes, 3 346 méthodes (tous les dictionnaires tiennent dans leur script), 1 127 variables locales, 455 exports. Les huit premiers mots d'un objet sont ses huit premières propriétés, nommées par les sélecteurs 4096 à 4103 (`-objID-`, `-size-`, `-propDict-`, `-methDict-`, `-classScript-`, `-script-`, `-super-`, `-info-`) ; la neuvième est `name` pour tous les objets **sauf une classe racine du script 64943** (11 propriétés, la neuvième est `x`). Trois classes n'ont pas de nom (64916, 64943 × 2). 3 284 chaînes dans les heaps, contiguës de la fin des objets à la table de relocation (vérifié).
- **Dictionnaire de propriétés** (vérifié pour les 170 classes : les huit premiers sélecteurs sont 4096 à 4103) : liste de sélecteurs, un par propriété ; une instance utilise celui de sa classe (lu, ScummVM `Object::initBaseObject`).
- **Relocations** (vérifié) : chaque table liste les mots de sa ressource qui contiennent un **offset de heap**. Heap : 2 632 entrées, toutes des propriétés d'objets qui visent le début d'une chaîne (2 626 noms, 6 autres) ; aucune variable locale. Script : 7 624 entrées = 408 exports + 7 216 opérandes de code (`lofsa` / `lofss`) qui visent un objet (6 615) ou une chaîne (601).
- **Exports** (vérifié) : **un export listé dans la table de relocation du script est un offset de heap et désigne un objet (408, tous au début d'un objet) ; les autres sont des offsets de code** (43 procédures) ou nuls (4 : scripts 92 × 2, 212, 214). ScummVM ne lit pas cette table et distingue par l'usage (`ScriptID` → heap, `calle` / `callb` → code).
- **Classes** (vérifié) : 170 objets marqués classe pour 169 espèces, car **la classe 133 (`ForRepeat`) est définie deux fois**, dans les scripts 22 et 808 ; le vocabulaire 996 retient 808. Pour les 168 autres, le script de la classe est celui de la table.
- **Vocab 997, sélecteurs** (vérifié) : `u16 nb − 1 | u16 offset[] | { u16 longueur ; caractères }`. **4 104 noms** ; les premiers : `plane, x, y, z, scaleX, scaleY, maxScale, priority, fixPriority, inLeft…`.
- **Vocab 996, table des classes** (vérifié pour la taille) : 169 entrées de 4 octets, `u16 0 (rempli au chargement) | u16 numéro de script`. Les classes système sont dans les scripts 64 900 et plus (ex. 64999).
- **Vocab 998, opcodes** (vérifié) : `u16 128 | u16 offset[128] | { u16 longueur ; u16 type ; nom }` : `bnot, add, sub, mul, div, mod, shr, shl, xor, and, or, neg…` jusqu'à `-sgi, -sli, -sti, -spi`. Sert au débogueur d'origine ; documente les 128 opcodes.
- **Vocab 994** (vérifié pour le contenu, supposé pour le rôle) : 79 **numéros de sélecteurs**, tous nommés : `signal, illegalBits, cursor, style, state, font, key, max, useInsetRect, view, loop, cel…`, avec des répétitions (`view`, `loop`, `cel`, `inLeft`… reviennent par groupes). Table des propriétés auxquelles l'interpréteur accède directement, dans un ordre fixé par l'exe (supposé) ; ScummVM ne la lit pas et retrouve ces sélecteurs par leur nom.
- **PMachine** (lu, d'après un désassemblage de prototype) : octet d'opcode = `numéro << 1 | bit 0` ; bit 0 levé : opérandes variables sur 1 octet, sinon sur 2. En SCI2, le nombre d'octets d'arguments de `call`, `callk`, `callb`, `calle`, `send`, `self`, `super` est **toujours sur 2 octets** (supposé d'après ScummVM ; confirmé par le fait que 3 345 méthodes sur 3 346 se désassemblent ainsi jusqu'à leur `ret`, 300 746 instructions, 77 opcodes utilisés). `lofsa` / `lofss` : offset absolu. Pas d'opcodes de débogage (`file`, `line`) dans ces scripts.

## 9. Messages (vérifié)

Ressource 0x8f, une par module (pièce ou script), 77 ressources, **10 982 messages en français**, CP850, terminés par 0.
`u32 version (4321 pour 53 ressources, 4330 pour 24) | u16 @4 fin des textes − 6 | u16 @6 (non nul dans 3 ressources, non lu) | u16 nb d'entrées @8`, puis des enregistrements de **11 octets** : `noun | verb | cond | seq | talker | u16 offset du texte | refNoun | refVerb | refCond | u8 @10`. Les textes se suivent sans trou, dans l'ordre des entrées, jusqu'à l'offset annoncé @4 (vérifié).
**Renvois** (vérifié) : 2 441 entrées ont un triplet « ref » non nul ; **il désigne toujours la séquence 1 d'un message du même module** (les 2 441 se résolvent ainsi ; ScummVM `MessageReaderV4` fait de même). L'octet @10 n'est pas une séquence de renvoi : il vaut 0 ou 1, y compris dans 4 700 entrées sans renvoi (rôle inconnu, non lu). Le texte d'une entrée à renvoi est une copie de travail préfixée « R » : jamais affiché. **Vérifié par le noyau (vague T)** : les 2 441 commencent par « R », 147 renvois visent une entrée qui renvoie elle-même ailleurs (chaîne suivie jusqu'au texte), et un renvoi au milieu d'une suite fait lire la suite visée puis reprendre la suite d'origine (543 cas).
**Suite de la ressource** (vérifié sur les 77, jusqu'au dernier octet) : après les textes, par entrée, `commentaire terminé par 0 | u32 date | u16` : données de l'éditeur de messages de Sierra (1 358 commentaires d'auteurs, en anglais), que l'interpréteur ne lit pas.
Talker 99 = narrateur (4 346 messages), 1 = Gabriel (2 712) ; 67 talkers. **Aucun code de mise en forme `|x|` dans les 10 982 textes** (vérifié) ; 2 séquences `\xx` (octet en hexadécimal) seulement. Octets au-dessus de 127 : à, â, ä, ç, è, é, ê, ë, î, ï, ô, ö, ù, û, ü, ß et ° (CP850, vérifié) ; tous présents dans les polices de 226 glyphes sauf « ° » (§ 7).
La clé `(module, noun, verb, cond, seq)` est aussi celle des voix (§ 11). 3 525 messages n'ont pas de voix ; 12 clips n'ont pas de message (vérifié), dont l'unique clip du module 339, qui n'a pas de ressource message.

## 10. Sons MIDI et patchs

**Sound (0x84)**, 288 ressources (lu ; structure parcourue sans erreur sur les 288) :
```
{ u8 type de piste ; { u16 0 ; u16 offset ; u16 taille } … 0xFF } … 0xFF      une liste de canaux par périphérique
Type 0xF0 : piste d'en-tête, dont l'unique entrée de 6 octets commence par la priorité du son (100, 75, 110 ou 80)
Canal : u8 numéro de canal MIDI (quartet bas ; 15 = canal de contrôle) et drapeaux (quartet haut) | u8 voix (quartet bas) et priorité (quartet haut) | flux MIDI
```
- **« L'en-tête facultatif de 8 octets »** de l'étude est une piste de type 0xF0 (lu, ScummVM `SoundResource`) : `F0`, 6 octets, `FF`. Le son 742 n'a simplement pas cette piste (vérifié : il se lit comme les autres).
- **Restes** (vérifié sur les 288 sons et les 2 patchs) : la table et les canaux couvrent tout, sauf **un octet nul** entre la table et le premier canal, et **27 octets nuls** à la fin des sons 264 et 801, qui n'ont aucune piste (sons vides). Drapeaux de canal : 0 ou 2 (« ne pas réaffecter », lu ScummVM) ; tout canal finit par `FC`, parfois suivi d'un octet nul.
- Périphériques présents : 0 (286 sons), 6 (209), 7 (275), 9 (1), 11 (257), 12 (286), 18 (285), 19 (228). **Lu** (identifiant que chaque pilote de ScummVM demande, `getPlayId`) : 0 = AdLib, 7 = General MIDI, 12 = MT-32, 18 = haut-parleur, 19 = Tandy, **6 = pilotes Amiga et Macintosh** (`amigamac1.cpp`), **9 = Game Blaster / CMS** (`cms.cpp` ; un seul son, le 742). **11 : aucun pilote de ScummVM ne le demande** (supposé : une carte à table d'ondes de l'installateur d'origine) ; ses pistes couvrent 257 sons, dont cinq bruitages sans piste General MIDI. Aucun des trois ne sert au portage. Les canaux sont partagés entre périphériques (mêmes offsets). **Pour 194 sons sur 275, les listes General MIDI et MT-32 sont identiques** (vérifié) ; pour les 81 autres, la piste General MIDI a ses propres canaux (autres numéros, autre nombre). **11 sons avec pistes n'ont pas de piste General MIDI** (215, 218, 231, 261, 291, 292, 414, 474, 538, 873, 2017) : muets avec `GENMIDI.DRV`, et pour nous (vague A1 : le son finit aussitôt, le script n'attend pas).
- Flux MIDI (**vérifié** sur les 1 827 pistes des 288 sons, lecteur `audio/sci-song.ts`, tests `test/gk1/audio/`) : delta sur 1 octet, `F8` = 240 ticks d'attente supplémentaires, statut courant (« running status »), `FC` = fin du canal, toujours précédé d'un delta nul. Tick = 1/60 s (lu, ScummVM `MidiParser_SCI` : tempo de 16 667 µs). Le statut porte toujours le numéro du canal de l'en-tête. **Un canal a une taille paire** : l'octet nul qui suit `FC` dans 499 canaux des pistes General MIDI est ce bourrage (vérifié).
- **Canal 15, canal de contrôle** (lu, ScummVM `processEvent`), jamais envoyé au synthétiseur : changement de programme 127 = **point de boucle** au tick courant ; autre valeur = **signal** écrit dans la propriété `signal` du son (ignoré au tick 0) ; contrôleur 0x60 = repère cumulatif (`dataInc` + 1, `signal` = `dataInc` + 127) ; 0x52 = maintien (retour au point de boucle tant que la valeur est celle de `DoSound SetHold`) ; 0x50 = réverbération ; 0x4C = remise à zéro à la pause. Sur les autres canaux : 0x4B = nombre de voix, 0x4E = coupure du canal, 0x50 = réverbération (aucun n'est transmis).
- **Relevé des pistes General MIDI** (vérifié) : 214 points de boucle (209 sons ont un canal 15), **8 signaux seulement** (valeurs 0, 10, 20, 30 ; le son 1 en porte trois, aux ticks 317, 569 et 627), **aucun repère cumulatif**, un seul maintien, 209 réverbérations ; ni 0x4B ni 0x4E ; contrôleurs MIDI ordinaires : 1 (modulation), 7 (volume), 10 (panoramique), 64 (pédale) ; aucun message système. Chaque canal demande une voix (un seul : aucune) ; 439 canaux sur 447 sont indispensables (priorité 0), 8 facultatifs (priorité 1 ou 2) ; seul le canal 9 (batterie) porte le drapeau 2. Le canal 15 porte aussi des messages sans rôle (panoramique, molette), écartés.
- Aucun canal d'échantillon numérique (`0xFE`) dans les 288 sons (vérifié) : tout le numérique passe par l'audio (§ 11).

**Patchs (0x89)** :
- **3 = AdLib** : 5 382 octets = 190 instruments × 28 octets + 62 (vérifié pour la taille, supposé pour le sens).
- **4 = table MT-32 → General MIDI** : 1 310 octets. **Sur ce CD la table est neutre** (vérifié, `test/gk1/audio/gm-driver.test.ts`) : programmes et percussions identiques, aucune transposition ni correction de volume, courbe de vélocité 0 (identité) pour tous les programmes ; les 155 octets d'initialisation sont une remise à zéro GS (`F0 41 10 42 12 40 00 7F 00 41 F7`) puis, sur chacun des 16 canaux, l'étendue de la molette à 12 demi-tons (RPN 0). Les pistes du périphérique 7 sont donc écrites directement en General MIDI. ScummVM, lui, joue ici la piste MT-32 (12) à travers cette table, parce que le patch 1 est au format MT-32 (`MidiPlayer_Midi::open`) : écart assumé, nous jouons la piste 7 comme `GENMIDI.DRV`. Disposition (lu, ScummVM `readMt32GmPatch` ; **vérifié pour la taille** : la longueur lue en 0x481 vaut 155 et 0x483 + 155 = 1 310 ; lecteur `data/gm-patch.ts`) : 128 programmes, 128 transpositions, 128 volumes, 128 percussions, 1 volume de batterie, 128 + 4 × 128 courbes de vélocité, puis `u16 n` et `n` octets MIDI d'initialisation.
- **1 = MT-32** : 19 556 octets, non analysé (inutile au portage).

## 11. Audio numérique : audio, audio36, sync36

**Le portage ne lit ni `RESOURCE.AUD` ni `RESOURCE.SFX`** : l'extraction les convertit (`plan.md`, D3). Ce qui suit documente la source et sert au script d'extraction.

- **Map 65535 → `RESOURCE.SFX`** (vérifié) : entrées de 5 octets `u16 numéro | u24 delta cumulatif`, fin : une entrée de 5 octets `0xFF`. 186 fichiers RIFF WAV PCM 22 050 Hz mono (184 en 16 bits, 2 en 8 bits). Numéro = numéro de ressource audio (`DoAudio` avec un seul numéro).
- **`SFX/*.WAV`** (vérifié) : 46 WAV 22 050 Hz 16 bits mono ; 45 absents de la map, 1 en commun (le fichier isolé est prioritaire : supposé).
- **73 maps audio36 → `AUD/RESOURCE.AUD`** (vérifié) : numéro de la map = module = numéro de la ressource message. `u32 offset de base`, puis `noun | verb | cond | seq | u24 delta cumulatif` ; **si `seq & 0x80`** : `u16 taille de synchro` suit, et la ressource commence par un bloc sync (0x8e) de cette taille, suivi de l'audio. Fin : **11 octets `0xFF`** (une entrée de la plus grande taille possible), sans rien après (vérifié sur les 73 maps). Aucun drapeau `0x40` (bloc RAVE).
- **Fichiers du portage** (vérifié, `data/audio-index.ts`) : les 7 469 clés des maps ont leur `voices/<module>/<noun>-<verb>-<cond>-<seq>.mp3`, les 186 numéros de la map 65535 leur `audio/<n>.mp3` (231 fichiers avec ceux de `SFX/`) ; `sync.json` existe pour 9 modules (50 à 57 et 670) et porte 1 785 clips, dont les 1 777 marqués dans les maps, à ticks croissants.
- **Clip SOL** (vérifié) : `u8 0x8d | u8 taille d'en-tête (11 ou 12) | "SOL\0" | u16 fréquence | u8 drapeaux | u32 taille`. 7 469 clips, 22 050 Hz mono, ~8,9 h. Drapeau 0x01 = DPCM 8 bits (un quartet par échantillon, table `0, 1, 2, 3, 6, 10, 15, 21`) ; **variante du décodeur à confirmer** à l'écoute (`table[7 − (n & 7)]` ou `table[n & 7]` pour un quartet négatif).
- **Synchro des lèvres, sync36** (lu) : `u8 0x8e | u8 0`, puis des paires `u16 temps (1/60 s) | u16 repère` à temps croissants (3, 13, 17, 22…). 1 777 clips en ont une. Terminaison : tick `0xFFFF` exactement à la fin du bloc dans `RESOURCE.AUD` (vérifié à l'extraction, `files.md`) ; l'exemple lu d'abord (`… 7d 7d`) était un patch `#…`, dont les octets après le terminateur ne sont pas repris.
- **Patchs `AUD/`** (vérifié) : 21 fichiers `@…` (audio36, SOL drapeaux 0 = PCM 8 bits) et 10 `#…` (sync36). Nom en base 36 : préfixe, module (3 caractères), noun (2), verb (2), `.`, cond (2), seq (1). Ils remplacent ou complètent des clips de `RESOURCE.AUD`.
- **Langue** : les voix sont **anglaises** (confiance ~90-95 % : dates de 1993, textes traduits en 1994 avec didascalies) ; la version française de 1994 = voix anglaises + textes français.

## 12. Cinématiques SEQ (vérifié sur les 25 fichiers, 863 images)

```
u16 nb d'images | u32 taille de la palette (1 057 pour 6 fichiers, 802 pour 19) | palette (§ 6)
Image, en-tête de 36 octets : u16 largeur | u16 hauteur | u16 gauche | u16 haut | u8 couleur transparente | u8 type | u16 0
                              u32 @12 taille des données | u32 @16 taille du flux de contrôle (0 pour le type 0) | u32 @20 0 | u32 @24 offset absolu des données (= en-tête + 36) | u32 @28 (non lu) | u32 @32 0
```
- Type **0** (201 images) : `largeur × hauteur` octets bruts. Type **11** (662 images) : données de la taille annoncée, un flux de contrôle suivi des littéraux, à poser dans le rectangle sur l'image précédente. **Codage (lu dans `seq_decoder.cpp` de ScummVM, vérifié : les 662 images consomment exactement leur flux de contrôle et leurs littéraux, sans jamais sortir du rectangle)**, octet de contrôle `c`, curseur partant du coin du rectangle :
  - `11xxxxxx` : `x` = 0 : ligne suivante ; sinon saute `x` pixels (ils gardent l'image précédente) ;
  - `10xxxxxx` : `x` = 0 : copie le reste de la ligne en littéraux puis passe à la ligne ; sinon copie `x` littéraux ;
  - `00tttnnn` + un octet : compte `n` sur 11 bits ; `t` = 2 : saute `n` pixels ; 3 : copie `n` littéraux ; 6 : copie `n` lignes entières ; 7 : saute `n` lignes (6 et 7 : `n` = 0 = jusqu'au bas du rectangle).
  Ce n'est pas le RLE des vues. La couleur transparente de l'en-tête ne sert pas au décodage.
- Les 25 fichiers se parcourent d'image en image **jusqu'au dernier octet**. Toile 320×200 ; la première image est complète (320×200, type 0) dans les 25 fichiers, les suivantes sont des rectangles. Palettes : 255 couleurs à partir de 0. Contrôle visuel fait sur `1.SEQ` (introduction) ; sommes de contrôle figées dans `test/gk1/data/seq.test.ts`.
- Pas de son dans le fichier : la musique vient du script. 187 appels de `ShowMovie` dans les scripts, dont 35 sous la forme DOS, la seule utilisée (`engine.md` § 5).
- **Cadence et position (tranché en vague Q)** : `ShowMovie(nom, durée[, x, y])`. `durée` est le **nombre de ticks de 1/60 s par image** (lu : `kShowMovie32` passe l'argument à `SEQDecoder`, dont la cadence est `60 / durée` images par seconde, `seq_decoder.h`) : 7 dans 33 appels (≈ 8,6 images/s), 8 dans 2 (`MAP.SEQ`, `205.SEQ` : 7,5 images/s). `x`, `y` : coin haut gauche de la toile à l'écran ; les 34 appels qui les donnent passent `IsHiRes() ? 150 : 0` et `IsHiRes() ? 135 : 0` (lu dans les scripts), donc (0, 0) pour nous (`IsHiRes` répond non, D4) ; ScummVM les ignore et centre l'image. La toile fait toujours 320×200 ; l'image utile peut être plus petite, entourée de noir (observé sur `2.SEQ`).
- **Palette et fin** (lu, `video32.cpp` de ScummVM) : la palette du fichier remplace les 256 couleurs de l'écran pendant la lecture (les couleurs non définies sont noires), sans passer par la palette du jeu ; à la fin l'écran est rempli de la couleur 0. Un clic ou Échap arrête la lecture. Lecteur : `render/seq-player.ts`, qui remet aussi la palette de l'écran d'avant.
- **Introduction** (pièce 190, vérifié par un parcours sans tête) : `1`, `2`, `MORPH`, `OLDTALIS`, `BLOOD`, `PAN1`, `SNAKE`, `PAN2`, `HANG`, `WAKE`, soit 48, 48, 26, 48, 26, 35, 19, 31, 42 et 11 images à 7 ticks.

## 13. ALT.MAP et RESOURCE.ALT (vérifié)

Même format que `RESOURCE.MAP` / `RESOURCE.000`. 59 vues, 814 cels : 1050 et 10100 à 19841. **51 sont les variantes haute résolution d'une vue de base `N − 10000`** ; 7 n'ont pas de vue de base (10605 à 10609, 10700, 11000) et la 1050 est seule de son espèce (vérifié). 15 vues sont faites d'un cel brut (non compressé) ; leur taille de données est écrite modulo 65 536 (640 × 480 = 307 200 → 45 056) : ne pas s'y fier. Octet de résolution de l'en-tête (@5) : 1 = 640×480 (48 vues), 2 = 640×400 (11 vues) (0 dans toutes les vues de base). Le jeu les demande quand `IsHiRes` répond vrai (161 appels) ; règle de sélection exacte et rôle de la vue 1050 : § 16. Mode d'origine : VESA 640×400 optionnel (`VESA.DRV`).

## 14. Patchs de ressources (vérifié)

`PATCHES/316.SND` et `803.SND` : 98 octets chacun, `u8 0x84 | u8 0`, puis la ressource sound telle quelle (elle commence par `F0 64…`). En-tête de patch : type, puis nombre d'octets d'en-tête supplémentaires (lu, ScummVM `processPatch` ; 0 ici). Sons absents de `RESOURCE.000` (ajouts, vérifié) : 290 sons avec eux. Les deux fichiers sont identiques : une piste d'en-tête et un seul canal de contrôle (canal 15) par périphérique. Un patch remplace toujours une ressource de volume de même type et numéro, jamais l'inverse (lu, ScummVM).

## 15. Fonctions du noyau (lu dans `SIERRA.EXE` et ScummVM, vérifié par l'exécution)

Pas de `vocab 999` : la table des noms est dans l'exe (chaînes consécutives, de `Load` à `PointSize`). **Indice = position dans la table = opérande de `callk`.**
**Correction (vagues V et S1)** : la table relevée dans l'exe avait **perdu `Abs`, à l'indice 94** ; tous les indices donnés ici à partir de 94 étaient trop petits de 1. La table est celle de ScummVM (`sci2_default_knames`, **139 noms**, 0 à 138), vérifiée par les arités (désassembleur) et par l'exécution (le script 0 démarre et tourne avec elle). Source unique dans le code : `src/games/gk1/engine/kernel/names.ts`. **Nombre d'appels, arguments et sous-fonctions : `engine.md` § 4 et § 5** (104 fonctions appelées, 3 838 appels).

| Groupe | Indice : nom |
| --- | --- |
| Ressources, objets | 0 Load, 1 Unload, 2 ScriptID, 3 DisposeScript, 4 Lock, 5 ResCheck, 6 Purge, 7 Clone, 8 DisposeClone, 9 RespondsTo |
| Cels | 10 SetNowSeen, 11 NumLoops, 12 NumCels, 13 CelWide, 14 CelHigh, 18 OnMe |
| Plans, écran | 15 GetHighPlanePri, 16 GetHighItemPri, 17 ShakeScreen, 20 SetVideoMode, 21 AddScreenItem, 22 DeleteScreenItem, 23 UpdateScreenItem, 24 FrameOut, 25 AddPlane, 26 DeletePlane, 27 UpdatePlane, 28 RepaintPlane, 29 SetShowStyle, 30 ShowStylePercent, 31 SetScroll, 32 AddMagnify, 33 DeleteMagnify, 34 IsHiRes, 35 Graph, 36 InvertRect |
| Cinématiques | 19 ShowMovie |
| Texte, messages | 37 TextSize, 38 Message, 39 TextColors, 40 TextFonts, 42 SetQuitStr, 43 EditText, 44 InputText, 45 CreateTextBitmap, 46 DisposeTextBitmap, 137 TextWidth, 138 PointSize |
| Évènements, curseur | 47 GetEvent, 48 GlobalToLocal, 49 LocalToGlobal, 50 MapKeyToDir, 51 HaveMouse, 52 SetCursor, 53 VibrateMouse |
| Sauvegardes, fichiers | 54 SaveGame, 55 RestoreGame, 56 RestartGame, 57 GameIsRestarting, 58 MakeSaveCatName, 59 MakeSaveFileName, 60 GetSaveFiles, 61 GetSaveDir, 62 CheckSaveGame, 63 CheckFreeSpace, 122 GetCWD, 123 ValidPath, 124 FileIO, 126 DeviceInfo |
| Son | 64 DoSound, 65 DoAudio, 66 DoSync |
| Listes | 67 NewList, 68 DisposeList, 69 NewNode, 70 FirstNode, 71 LastNode, 72 EmptyList, 73 NextNode, 74 PrevNode, 75 NodeValue, 76 AddAfter, 77 AddToFront, 78 AddToEnd, 81 FindKey, 85 DeleteKey, 88 ListAt, 89 ListIndexOf, 90 ListEachElementDo, 91 ListFirstTrue, 92 ListAllTrue |
| Calcul, temps | 93 Random, **94 Abs**, 95 Sqrt, 96 GetAngle, 97 GetDistance, 98 ATan, 99 SinMult, 100 CosMult, 101 SinDiv, 102 CosDiv, 103 GetTime, 104 Platform |
| Déplacement, polygones | 105 BaseSetter, 106 DirLoop, 107 CantBeHere, 108 InitBresen, 109 DoBresen, 110 SetJump, 111 AvoidPath, 112 InPolygon, 113 MergePoly, 135 ObjectIntersect |
| Palette | 127 Palette, 128 PalVary, 129 PalCycle, 132 RemapColors |
| Données | 130 Array, 131 String |
| Débogage (« Dummy » dans l'exe, nommées par ScummVM) | 114 SetDebug, 115 InspectObject, 116 MemoryInfo, 117 Profiler, 118 Record, 119 PlayBack, 120 MonoOut, 121 SetFatalStr, 133 IntegrityChecking, 134 CheckIntegrity, 136 MarkMemory. Seules `SetDebug` (1 appel) et `MemoryInfo` (6) sont appelées. |
| « Dummy » sans fonction | 41, 79, 80, 82-84, 86, 87, 125. **Aucune n'est appelée.** |

Les sous-fonctions (`DoSound`, `DoAudio`, `Graph`, `PalVary`, `Array`, `String`, `FileIO`, `Message`, `Palette`…) sont choisies par le premier argument.

**Portées par la vague S1** (`engine/kernel/`, tests `test/gk1/engine/kernel.test.ts`) : ressources et scripts (0 à 6), objets (7 à 9), listes (67 à 92), calcul (93 à 102), `GetTime`, `Platform`, `Array`, `String` (sous-fonctions 0 à 16), `MemoryInfo` et les fonctions de débogage (sans effet). **Les 76 autres fonctions nommées sont des souches** qui rendent 0 (ou la valeur de `kernel/stubs.ts`) et journalisent leur appel.

**Portées par la vague G1** (`engine/kernel/planes.ts`, `cels.ts`, `palette.ts`, sur `render/` ; tests `test/gk1/render/`) : `AddPlane`, `UpdatePlane`, `DeletePlane`, `GetHighPlanePri`, `AddScreenItem`, `UpdateScreenItem`, `DeleteScreenItem`, `FrameOut`, `IsHiRes`, `Graph(1)`, `CelWide`, `CelHigh`, `NumLoops`, `NumCels`, `SetNowSeen`, `OnMe`, `Palette` (1 `SetFromResource`, 2 `SetFade`, 3 `FindColor`). `OnMe` est la fonction que SCI2.1 renomme `IsOnMe` ; `CelInfo` (SCI2.1) n'est pas dans la table de ce CD. **Restent des souches** dans ces groupes : `GetHighItemPri`, `RepaintPlane`, `ShowStylePercent`, `InvertRect` (jamais appelées) ; `AddMagnify`, `DeleteMagnify` (un appel chacun, dans la classe `Magnifier` que rien ne crée : code mort, `kDummy` dans ScummVM ; `engine.md` § 6.3), `EditText` ; `SetShowStyle`, `ShakeScreen`, `SetScroll`, `SetVideoMode`, `PalVary`, `PalCycle`, `RemapColors`, `CreateTextBitmap`, `DisposeTextBitmap`, `TextSize`, `TextWidth` et `SetCursor` sont portées par la vague G2 (`plan.md`, « Avancement ») ; `BaseSetter` et les fonctions de déplacement, `GetEvent`, `GlobalToLocal`, `LocalToGlobal` (E).

**Compositeur : faits établis par la vague G1** (vérifiés par le rendu du démarrage, sauf mention) :
- un plan lit son rectangle dans `inLeft` … `inBottom` (bords compris) ; `picture` −1 : fond de couleur `back`, −2 : transparent, −3 : opaque, sinon un pic (lu : codes de ScummVM) ; un plan de priorité négative est caché sous le plan de fond de l'interpréteur (priorité 0, noir) : la barre d'icônes, l'inventaire et les réglages attendent ainsi à la priorité −1 ;
- le plan du jeu couvre les lignes 10 à 199 ; le logo de Sierra (pic 50, 320×200) y perd ses dix dernières lignes ;
- l'interpréteur lit `scaleSignal` (indice 54 de `View`, écrit par `Prop::setScaler`), pas `scaleType` (indice 32, qu'aucun script ne touche) ;
- le bit « à redessiner » de `-info-` est baissé par `AddScreenItem` et `UpdateScreenItem` ; les scripts ne rappellent `UpdateScreenItem` que pour un objet dont une propriété d'indice 26 à 44 a changé ;
- les fonctions de plans et d'éléments laissent l'accumulateur tel quel (lu) ;
- **les attentes en secondes des scripts lisent l'heure du système** (`GetTime(1)`) : le logo reste 12 secondes, puis l'écran titre arrive à la 841e image à 60 images par seconde.

**Machine virtuelle : faits établis par la vague S1** (`engine/`, vérifiés par l'exécution des scripts réels) :
- la paire script + heap se charge avec les seuls indicateurs de `data/script.ts` : une valeur relocalisée devient une référence `segment du script : offset de heap` ; l'opérande de `lofsa` / `lofss` est toujours un offset de heap ; un pointeur de code n'est jamais une valeur ;
- **une instance prend les sélecteurs de propriétés de sa classe mère** (`-super-`) : les 2 459 instances ont exactement autant de propriétés que leur classe ; `-propDict-` identifie la classe (recopié dans les instances, comparé par `isKindOf` / `isMemberOf`), `-classScript-` reçoit le numéro du script, `-script-` garde sa valeur de fichier ;
- la classe 133 est inscrite depuis le script 808 seulement (vocabulaire 996), même si le script 22 est chargé avant ;
- dans la classe `View` (script 64998), `plane` est la propriété d'indice 25 et `x` … `yStep` occupent les indices 26 à 44, la plage dont l'écriture marque l'objet « à redessiner » dans ScummVM (**confirmé au rendu, vague G1**, voir plus haut) ;
- **démarrage** : `play` envoyé à l'export 0 du script 0 (`GK`) atteint son premier `FrameOut` en 55 854 instructions (55 726 avant la vague G1, quand `CelWide` et `CelHigh` rendaient 0) et 2 256 appels du noyau, dans la pièce 17 (`speedRoom`, test de vitesse), puis la boucle du jeu tourne dans la pièce 94 ; 37 scripts chargés ; aucune lecture de variable non initialisée ni division par zéro jusque-là.

## 16. Points à vérifier

Refermés par la vague T (`engine/message.ts`, `engine/kernel/message.ts`, tests `test/gk1/engine/message.test.ts`) : **12** (échappements `\xx`, didascalies, talkers) et **13** pour l'effet (octets non lus, sans conséquence).
Refermé par la vague Q (`render/seq-player.ts`, tests `test/gk1/render/seq-player.test.ts`) : **9** (cadence des SEQ et arguments de `ShowMovie`, § 12).
Refermés par la vague G1 (`src/games/gk1/render/`, tests `test/gk1/render/`) : **5** (fusion : seules les couleurs « utilisées » de la palette d'une ressource dessinée remplacent celles de la palette du jeu ; la couleur 255 est toujours blanche à l'écran ; la palette 999 est chargée au démarrage ; vérifié sur le logo et l'écran titre) et **6** (les champs @4 et @6 sont un décalage, § 4 ; miroir au rendu).
Refermés par les vagues V et S1 : **3** (les « Dummy » 124 et 132 étaient `FileIO` et `RemapColors` : table décalée de 1 depuis l'indice 94, § 15 ; aucun « Dummy » n'est appelé) et **4** (sous-fonctions : `engine.md` § 5).
Refermés par la vague D (lecteurs, `src/games/gk1/data/`, tests `test/gk1/data/`) : **1** (doublons : copies identiques, dernière entrée, § 2), **2** (exports et classes, § 8), **5** pour l'en-tête (palettes 500 et 3301, § 6), **6** pour le champ @10, les miroirs et la table des lignes (§ 4), **8** pour la terminaison (§ 11), **9** pour le codage (§ 12).

Restent ouverts :

7. Sound : refermé par la vague A1 (§ 10 : périphériques 6 et 9 identifiés, contrôleurs, signaux, boucle, bourrage après `FC`, patch 4 neutre). Restent : le périphérique 11 (inconnu de ScummVM, inutile au portage) ; l'octet nul après la table des pistes (non lu, sans effet connu) ; **à l'écoute** : le choix de la piste 7 plutôt que 12 pour les 81 sons où elles diffèrent.
8. Sync36 : **refermé par la vague A2** (lu dans `Sync::syncCheck` et `MouthSync::doit`, script 64929 ; `audio/sync.ts`). Les 4 bits bas d'un repère sont le **cel de la bouche** du personnage ; un repère dont les bits hauts sont nuls garde ceux du précédent (aucun usage des bits hauts relevé). Le script passe au repère suivant tant que son temps ne dépasse pas la position de l'audio (`DoAudio(Position)` sans clé) ; après le dernier, `DoSync Next` rend −1 et −1 une fois. Vérifié sur le clip 50 6-0-20-1 avec le `MouthSync` du jeu (`test/gk1/audio/do-audio.test.ts`) ; calage sur le son réel à vérifier à l'écoute.
10. Décodeur DPCM des voix : tranché à l'extraction (`files.md`) ; **durée de chaque clip** : fournie par l'extraction en échantillons du PCM source (22 050 Hz), dans `voices/<module>/index.json` et `audio/index.json` ; `audio-index.ts` les lit (`parseDurationJson`) et les convertit en ticks (`samplesToTicks`). **Arrondi corrigé par la vague A2** après lecture d'`Audio32::play` (`channel.duration`) et du flux SOL de ScummVM : millisecondes tronquées, ticks tronqués, **plus 1** (`1 + floor(ms × 60 / 1000)`) ; l'ancienne formule (arrondi au supérieur) donnait un tick de moins quand les millisecondes tombaient sur un tick entier (2 000 ms : 121 ticks, pas 120).
11. `RESOURCE.ALT` : règle de sélection des vues `N + 10000`, rôle de la vue 1050 et des 7 vues sans vue de base. (H)
12. Messages, mise en forme : **refermé par la vague T** (`engine/message.ts`, lu dans `message.cpp` de ScummVM). `\xx` donne un octet, **les lettres A à F valant 11 à 16** (faute de l'interpréteur d'origine) : `\1d` et `\1e` donnent 30 et 31, les deux flèches des listes de sauvegardes. Une parenthèse sans minuscule ASCII est une **didascalie, retirée** avec les blancs qui la suivent : 140 messages (« (SARCASTIQUE) », « (TON SUPPLIANT) »…), aucun faux positif relevé. Talkers : le numéro est rendu tel quel aux scripts, qui le traduisent eux-mêmes (`gkMessager::findTalker`, script 0) ; le moteur n'a pas besoin de la table. Rendu de l'original toujours à observer.
13. Messages : octet @10 des entrées (0 ou 1) et mot @6 de l'en-tête : rôle inconnu, non lus par ScummVM ni par nous. **Sans effet constaté (vague T)** : les 10 982 messages sont rendus par le noyau sans eux.
14. « ° » (0xF8) dans trois messages (module 0 : 29-0-8-1 et 29-0-8-6 ; module 440 : 4-10-0-4) : absent des polices de 226 glyphes. **Lu (vague G2)** : un caractère hors de la police ne prend pas de place et ne dessine rien (`GfxFontFromResource::getCharWidth` de ScummVM) ; `render/text.ts` fait de même. Rendu de l'original toujours à observer.
15. Vues et pics : octets non lus des en-têtes (vue @3, @4 ; boucle 3 à 11 ; pic @3) ; `RESOURCE.MAP` : les 4 octets `34 12 00 00`. Constants ou corrélés à la compression, sans effet connu.
16. Vocab 994 : rôle exact (liste de sélecteurs vérifiée). Scripts : le code lui-même n'est pas parcouru par les lecteurs (désassembleur, vague V) ; les octets entre les dictionnaires et la table de relocation ne sont donc pas tous attribués.
