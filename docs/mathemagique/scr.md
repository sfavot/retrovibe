# Scripts d'animation `\0SCR` (Math Workshop)

Lecteur : `src/games/mathemagique/data/scr.ts`, tests : `test/mathemagique/scr.test.ts`, rendu de contrôle : `scripts/mathemagique/render-samples.mts --scr`. Adresses `sélecteur:offset` de la décompilation de `MATH` (voir [re-index.md](re-index.md) et [engine.md](engine.md) §3). « Hypothèse » marque ce qui n'est pas prouvé par le code de `MATH`.

Résultat : les **995** `\0SCR` des 13 archives qui en contiennent (tag `00 53 43 52`) se lisent jusqu'à l'opcode `END` ; les 46 323 références de forme tombent toutes dans la `SHPL` résolue sauf 4, dans un seul script (POLLY 35900) ; les 2 042 sons sont tous dans la `SNDL` résolue.

## Format binaire

Petit-boutiste (le reste de l'archive est big-endian).

```
u16 haut, u16 gauche, u16 bas, u16 droite     8 octets : zone d'écrêtage, repère écran 576×432
opcodes …                                      jusqu'à 0x00 (END)
bourrage                                       ignoré
```

La zone est copiée aux offsets `+0x0c` (gauche), `+0x0e` (haut), `+0x10` (droite), `+0x12` (bas) de l'objet animation (`1090:06fa`). Les positions de cellules lui sont relatives : écran = `(gauche + x, haut + y)` (`1090:0c25` ajoute `+0x0c` à `x` et `+0x0e` à `y`).

## Grammaire

Un opcode est un octet suivi de ses opérandes. Interprète : `1090:0094` (`switch` sur l'octet) ; longueurs : table `1108:340f`, relue par la passe de pré-chargement de `1090:06fa`. `c` = `opcode & 0x1f`.

| Opcode | Opérandes | Octets | Nom (`ScrOp`) | Sens | Preuve |
|---|---|---:|---|---|---|
| `0x00` | – | 1 | fin | le script est terminé quand le délai de la dernière image est écoulé (renvoie 1) | `1090:0094` cas 0 |
| `0x01` | `u16 count`, `u16 delay` | 5 | `frame` | compose, attend la fin de l'image précédente, **présente**, compteur d'images `+= count`, durée de cette image `= count × delay` ticks | cas 1 |
| `0x02` | `u16 ticks` | 3 | `wait` | attente passive (jamais présent) | cas 2 |
| `0x03` | `u16 id` | 3 | `sound` | attend la fin de l'image courante, puis joue le son `\0SND` `id` (`1088:1498`, tag `0x4e44 0x53`) | cas 3 |
| `0x04` | `u16 id` | 3 | `stopSound` | arrête le son (`1088:16a5`) (jamais présent) | cas 4 |
| `0x05` | `u16 id` | 3 | `waitSound` | attend la fin du son (`1088:1818`) (jamais présent) | cas 5 |
| `0x06` | `u8 level` | 2 | `waitMidi` | attend le repère MIDI (`1088:1972`, `tMID`) (jamais présent) | cas 6 |
| `0x07` | – | 1 | `render` | compose dans le port de travail, sans attendre ni présenter (`1090:0a7f`) | cas 7 |
| `0x10`–`0x13` | `u16 arg` | 3 | `hook` | si le hook `k = opcode & 3` est posé (`anim+0x236+4k`), l'appelle avec `(arg, anim)` ; **non bloquant** | `default`, `(op & 0xfffc) == 0x10` |
| `0x14`–`0x17` | 4 octets | 5 | `skip` | ignorés (jamais présent) | `(op & 0xfffc) == 0x14` |
| `0x20`–`0x3f` | `u16 mask`, `u16 or` | 5 | `flags` | `flags[c] = (flags[c] & mask) \| or` | `default`, `0x20` |
| `0x60`–`0x7f` | `i16 x`, `i16 y` | 5 | `position` | position de la cellule `c` (l'ancien rectangle est marqué sale, puis le nouveau) | `default`, `0x60` |
| `0x80`–`0x9f` | `u16 shape`, `u16 echo` | 5 | `shape` | indice de forme de la cellule `c` ; `0` = cellule vidée **et remise à zéro** (`1090:0e21`) | `default`, `0x80` |
| autre | – | – | – | l'interprète renvoie « terminé » ; le lecteur lève une erreur | `default` (`uVar10 = 1`) |

Remarques :

- `echo` (2e `u16` de l'opcode forme) est ignoré par l'interprète et toujours égal à `shape` (0 différence sur 46 323).
- Les opcodes `0x40`–`0x5f` et `0xa0`–`0xff` n'existent pas ; `0x08`–`0x0f` non plus.
- Seuls 7 types d'opcode sont utilisés par les données (voir les statistiques) : `frame`, `sound`, `render`, `hook`, `flags`, `position`, `shape`. Les autres sont implémentés dans le moteur mais absents des 995 scripts ; le lecteur les accepte.

## Cellules

32 cellules (0 à 31), 12 octets chacune à `anim+0x246` : `u16 forme`, `u16 drapeaux`, `i32 x`, `i32 y` (16.16, seul le mot haut est utilisé). Les données n'utilisent que les cellules 0 à 23.

- **État initial** (`1090:0e21`) : forme 0, drapeaux `0x0002`, `x = y = 0x80000000` (mot haut `-32768` : hors écran). Une cellule non placée n'apparaît donc jamais ; le lecteur expose `SCR_OFFSCREEN = -32768`.
- **Ordre de dessin** : indice croissant (`1090:0a7f` boucle de 0 à 31). La cellule 0 est le fond de l'animation.
- **Forme** : indice de 1 à n dans la `SHPL` ; la `SHAP` est `firstShapeId + forme - 1` (`1088:1a35`). Un indice supérieur au nombre de formes déclenche l'erreur `Cast member out of range %d` au chargement (`1090:06fa`).
- **Drapeaux** : le quartet bas est le mode de blit passé à `10d8:5ff3`. Au premier dessin, `0xa` devient `0x8` de façon permanente (`1090:0c25`). Les données n'écrivent que `(& 0xfff0) | 0xa` (8 537 fois) et `(& 0xfff0) | 0` (206 fois) : mode effectif **8** (157 093 cellules-images) ou **0** (5 711), jamais 2. La sémantique des modes reste à établir (`10d8:5ff3` délègue à une méthode virtuelle du port, `[BX+0x38]`) ; le rendu de contrôle traite l'index 0 comme transparent dans les deux cas (hypothèse).
- Les positions des données vont de -360 à 603 en `x` et de -301 à 423 en `y` : les sprites débordent de la zone, qui sert d'écrêtage (`1090:0cae`, `1090:0e53`).

## Temps et chronologie

- Unité : le **tick** `DAT_1108_8722`, nominal 60 Hz (en pratique l'horloge de 17 ms, engine.md §4.6). Une image dure `count × delay` ticks ; `delay` vaut 7 (29 547 images), 5 (441) ou 4 (162) ; `count` vaut 1 dans 26 121 cas (maximum 134). Aucune image de durée nulle.
- Les opcodes de cellule, `render` et `hook` s'exécutent **immédiatement** ; seuls `frame`, `sound` et `end` **attendent** la fin de l'image précédente (`échéance + durée <= tick`). Donc :
  - une image présente l'état des cellules **tel qu'il est quand l'opcode `frame` est atteint** : les opcodes de cellule qui précèdent un `frame` décrivent l'image qu'il présente, et ceux qui le suivent préparent la suivante ;
  - un `sound` placé après le `frame` k part à la **fin de l'image k, c'est-à-dire avec la présentation de l'image k+1** ; il est toujours précédé d'un `render` (2 042 sur 2 042), qui pré-compose l'image suivante pendant l'attente ;
  - un `hook` part dès qu'il est atteint, donc pendant l'image qui le précède.
- Cadence (`DAT_1108_8732`) : à 0, l'échéance se recale sur l'instant présent (pas de rattrapage) ; à 1 (posé par le hub et par `1010:4363` autour de la lecture), elle s'additionne (cadence exacte). Le lecteur calcule la chronologie idéale (cadence exacte).
- `count` alimente un compteur d'images logiques (`+0x2a`) utilisé par l'avance rapide `1090:0432(n)` ; le lecteur l'expose comme `logicalIndex` (somme des `count` précédents).
- Lecture complète, drapeaux du descripteur, composition et dirty-rectangles : engine.md §3.5.

## Modèle du lecteur

`parseScr(bytes): ScrScript` produit deux vues :

- `ops: ScrOp[]` : les opcodes typés dans l'ordre, fidèles à l'octet près (de quoi bâtir un interprète à base de chronologie réelle, hooks inclus) ;
- `frames: ScrFrame[]` : simulation sans rendu. Chaque image porte son instant de présentation `start` (ticks), `duration`, `count`/`delay`, `logicalIndex`, la liste des **cellules visibles** (forme non nulle, par indice croissant, avec `flags`, `blit` effectif, `x`, `y`), et les **évènements** (`sound`, `hook`, …) tombés entre sa présentation et la suivante. `trailingEvents` (évènements après la dernière image) est toujours vide dans les données ; `duration` est la durée totale ; `size` le nombre d'octets utiles.

Le lecteur ne charge ni formes ni sons : `ScrCell.shape` est un indice dans la `SHPL` et `ScrEvent.id` un id `\0SND`.

## Résolution `SCR` -> `SHPL` et `SNDL`

`resolveScrResources(scrId, { shpl, sndl })` (fonction pure sur les ensembles d'ids de l'archive) renvoie `{ shplId, offset, sndlId }`.

Le moteur (`1090:1024`) part d'un descripteur `{ id SHPL, décalage }` : charge la `SHPL` `id`, charge le script d'id `id + décalage`, puis la `SNDL` de **même id que le script** (`10a8:078a` reçoit `id + décalage`). Dans les données :

- **`SHPL`** : celle de même id que le script quand elle existe ; sinon la plus grande `SHPL` d'id inférieur (décalage du descripteur). Les 995 scripts se résolvent et leurs formes tiennent dans la plage (sauf POLLY 35900). Les seuls scripts à décalage non nul : BOWLING (297 : SHPL 1200, 1300 ou 1400, décalage 1 à 99) et NIM (31 : SHPL 30000, décalages 1 à 31).
- **`SNDL`** : celle de même id que le script, **sauf pour 270 scripts de `BOWLING.DAT`** (1201–1209, 1211–1219 … 1491–1499) qui utilisent la `SNDL` de la dizaine inférieure (`id - id % 10`, soit 1200, 1210 …). Tous leurs sons y figurent (270/270).
- **Pourquoi le bowling est différent** (résout la question 14 d'engine.md) : `1010:3adc(n)` (chargement des animations de quilles) calcule `base = ((n-1)/100)*100 + 1200` (1200, 1300 ou 1400) et `dizaine = (((n-1) % 100) / 10) * 10`, charge l'animation `0x510` avec la `SHPL` `base` et le **décalage `dizaine`** (octet `DAT_1108_0516`) : sa `SNDL` est donc celle d'id `base + dizaine`. Il charge ensuite **dix** scripts `base + dizaine + i` (i de 0 à 9) dans les dix descripteurs `4ea2…4ec6` via `1090:140f` (sans recharger de `SNDL`). Les dix scripts d'une dizaine partagent ainsi la `SHPL` `base` et la `SNDL` `base + dizaine`. Quand la dizaine change et pas la base, `1010:3adc` recharge seulement la `SNDL` (`10a8:078a(…, base + dizaine)`). Ceci correspond exactement à la règle de repli du lecteur ; `1010:3bfc` est le hook 0 posé sur cette animation (`+0x236`).

Le repli de `SNDL` sur la dizaine est une règle **déduite du chargement du bowling** : le lecteur l'applique à toute archive où la `SNDL` de même id manque, ce qui n'arrive que dans `BOWLING.DAT`. Aucun script ne tombe dans le cas « sans SNDL » (`sndlId: undefined`), type conservé pour les ressources hors des 13 archives.

## Statistiques (995 scripts)

Opcodes : `shape` 46 323 (dont 5 126 avec forme 0), `position` 38 705, `frame` 30 150, `flags` 8 743, `sound` 2 042, `render` 2 042, `hook` 495. Total des opérations de cellule : 93 771. Les hooks sont tous le hook 0 ; `arg` vaut 0 (484 fois) ou 1 à 9 (une fois chacun) ; ils se trouvent dans NIM (387), BOWLING (100), PATTERNS (4), RHYTHM (2), STICKLER (2).

| Archive | Scripts | Images | Durée moyenne (ticks) | Durée max | Avec son | Particularité |
|---|---:|---:|---:|---:|---:|---|
| `BOWLING.DAT` | 381 | 9 751 | 237 | 1 337 | 280 | 297 décalages de `SHPL`, 270 `SNDL` de dizaine |
| `MAINSCRN.DAT` | 93 | 4 007 | 387 | 2 142 | 70 | hub |
| `POLLY.DAT` | 113 | 3 294 | 259 | 1 820 | 97 | 1 script hors plage (35900) |
| `NIM.DAT` | 123 | 2 405 | 163 | 1 610 | 89 | 31 décalages de `SHPL` (base 30000) |
| `STICKLER.DAT` | 28 | 2 425 | 766 | 1 505 | 28 | |
| `PATTERNS.DAT` | 28 | 2 133 | 722 | 1 631 | 28 | |
| `RHYTHM.DAT` | 76 | 1 570 | 176 | 1 029 | 76 | |
| `HIDDEN.DAT` | 28 | 1 499 | 684 | 1 204 | 28 | |
| `RSHELP.DAT` | 31 | 997 | 287 | 1 302 | 28 | |
| `GUS.DAT` | 54 | 819 | 146 | 329 | 54 | |
| `PATFILL.DAT` | 28 | 803 | 244 | 1 638 | 24 | |
| `TITLE.DAT` | 11 | 395 | 513 | 1 022 | 1 | |
| `CREDITS.DAT` | 1 | 52 | 212 | 212 | 0 | |

## Contrôle visuel

`npx vite-node scripts/mathemagique/render-samples.mts <dossier> --scr MAINSCRN.DAT 1000` (puis `--scr BOWLING.DAT 1201`) écrit une bande PNG (12 images au plus), sur le fond plein écran de l'archive (`SHPL` 100 + k), index 0 transparent, sans distinguer les modes de blit.

- `MAINSCRN` 1000 (13 images, 98 ticks) : le rideau rouge du hall s'ouvre du centre vers les bords en révélant la salle ; zone 287,244–387,331.
- `BOWLING` 1201 (SHPL 1200, décalage 1, 6 images, 63 ticks) : une puis deux quilles qui entrent dans le tunnel, aux bons endroits sur le fond du bowling. Ce script confirme le repère « formes relatives à la `SHPL` de base » pour un décalage non nul.

## Écarts avec engine.md et points ouverts

Écarts / précisions à reporter dans engine.md :

1. §3.7 / question 14 : la formule de l'id de `SNDL` du bowling est établie (voir ci-dessus, `1010:3adc`).
2. §3.2 « la fin de la ressource est du bourrage » : dans 5 archives (MAINSCRN, NIM, PATFILL, RHYTHM, RSHELP, soit 351 scripts), l'espace après `END` n'est **pas** nul (restes de tampon, ex. MAINSCRN 1000 : `0033 057c 0034 057d …`). Sans effet : l'interprète et la passe de pré-chargement s'arrêtent à `END`.
3. §3.3 : rien à changer sur les occurrences ; toutes retrouvées à l'identique (30 150 / 2 042 / 495 / 8 743 / 38 705 / 46 323).
4. Non signalé : **POLLY 35900** référence les formes 5 et 6 (4 références) alors que sa `SHPL` 35900 n'en a que 4 ; le moteur lèverait `Cast member out of range`. Hypothèse : script jamais joué, ou joué avec un autre descripteur.
5. §3.3 mentionne que `0x03` « attend la fin du délai » : précisé ici, la chronologie complète des opcodes (voir « Temps »).

Questions ouvertes :

- Sémantique des modes de blit `0` et `8` (et `2`, état initial jamais dessiné) : à lire dans `10d8:5ff3` / les ports (`10b0`) ; peut-être copie opaque contre copie transparente (hypothèse).
- Rôle du bit 6 des drapeaux du descripteur (lu par `1090:06fa`).
- Origine de l'octet « décalage » pour les 31 scripts NIM : à confirmer dans `1070:1d25` (la `SHPL` 30000 et la `SNDL` propre à chaque script sont établies, pas le code d'appel).
- Les hooks 1 à 3 et les opcodes absents des données (`wait`, `stopSound`, `waitSound`, `waitMidi`, `skip`) : implémentés mais jamais déclenchés par les données.
