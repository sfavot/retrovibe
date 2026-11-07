# Drascula : formats de fichiers

Jeu : *Drascula: The Vampire Strikes Back* (Alcachofa Soft, 1996), tel que redistribué gratuitement par ScummVM :
pack de base (`Packet.001`, anglais), pack international (`PACKET.002` français, `.003` allemand, `.004` espagnol, `.005` italien),
pack de musique (31 pistes OGG) et `drascula.dat` (données du moteur ScummVM). Version portée : **français**
(textes de `drascula.dat`, voix anglaises de `Packet.001`, fiches de pièces et dialogues de `PACKET.002`).

Ce document sépare ce qui est **vérifié** (lu ou décodé sur les fichiers réels ou rendu à l'écran : méthodes dans la dernière section)
de ce qui est **supposé** (lu dans le code du moteur `drascula` de ScummVM, `engines/drascula/` et `devtools/create_drascula/`, uniquement
pour comprendre les formats, ou déduit sans test). Pour vérifier, `Packet.001` et `PACKET.002` ont été extraits dans un dossier de travail
hors dépôt avec `7zz x`.

## Vue d'ensemble

| Famille | Extension | Contenu | Nombre (base) | Poids (base) |
| --- | --- | --- | --- | --- |
| Images | `.ALG` | image 320x200 (PCX) | 225 | 5,7 Mo |
| Pièces | `.ALD` | fiche de pièce en texte (objets, portes, zone de marche) | 57 | 20 Ko |
| Dialogues | `.CAL` | choix de dialogue du joueur (`OP_n.CAL`) | 13 | 3 Ko |
| Vidéos | `.BIN` | cinématiques (SSN) et animations (« animate ») | 33 | 23,0 Mo |
| Voix et sons | `.ALS` | PCM 8 bits non signé, 11 025 Hz | 783 | 32,2 Mo |
| Musique | `trackN.ogg` | OGG Vorbis stéréo 44,1 kHz (pack séparé) | 31 | 36,9 Mo |
| Textes et tables | `drascula.dat` | textes en 6 langues, tables du moteur (pack ScummVM) | 1 | 253,5 Ko |

Le reste de `Packet.001` n'est pas utilisé par ScummVM : `DOS4GW.EXE`, `SETUP.EXE`, `LOGODDM.EXE`, `HACKER*.EXE`, `IGOR.EXE`, `PENDULO.EXE`, `YODA.EXE`
(exécutables DOS d'origine), `GHOST.DRV`, `*.DEV`, `DRASCULA.COM`, `SOUND.CFG`, `SETUP.VOC`, `INFO.RCT`, `GSAVE00` à `GSAVE10` (sauvegardes d'origine)
et `drascula.doc` (manuel Word). Ils ne sont pas portés (voir `plan.md`).

## Archives `PACKET.00x` (ARJ)

**Vérifié.** Chaque `PACKET.00x` est une archive **ARJ** (signature `60 EA` au début, nom interne `PACKET.ARJ`, `PACKET002.ARJ`, `PACKET.003`…).
`7zz x` l'extrait sans erreur, à plat, sans sous-dossier. Il n'y a pas de décodeur ARJ à écrire pour le navigateur : l'extraction se fait une fois,
dans le script d'extraction (`7zz`, déjà l'outil des autres scripts), puis les fichiers extraits sont servis tels quels.

| Archive | Taille | Langue (table de détection ScummVM) | Contenu extrait |
| --- | --- | --- | --- |
| `Packet.001` | 32 847 563 o | base, anglais | 783 `.ALS`, 225 `.ALG`, 57 `.ALD`, 33 `.BIN`, 13 `.CAL`, 10 `.EXE`, `.DEV`, `.DRV`, `.COM`, `.CFG`, `.RCT`, `.VOC`, `.EPA`, `GSAVE*` |
| `PACKET.002` | 722 383 o | français | 57 `.ALD`, 13 `.CAL`, `QPC.BIN`, 6 `.EXE` (1,1 Mo) |
| `PACKET.003` | 719 728 o | allemand | idem français (+ `QPC.BIN`) |
| `PACKET.004` | 17 205 838 o | espagnol | `.ALD`, `.CAL`, 22 `.ALG`, 780 `.ALS` (voix espagnoles), `INTRO.BIN`, `CRD.BIN`, `QPC.BIN`, `.EXE` |
| `PACKET.005` | 16 209 623 o | italien | `.ALD`, `.CAL`, 7 `.ALG`, 782 `.ALS` (voix italiennes), `QPC.BIN`, `.EXE` |

Les tailles sont celles de la table de détection de ScummVM (`engines/drascula/detection.cpp`) : celles des fichiers d'archives téléchargés les
retrouvent exactement (supposé pour l'identification de la langue ; vérifié pour la taille et pour le contenu français, dont les `.ALD` et `.CAL`
sont bien en français). Le français n'a **ni `.ALG` ni `.ALS`** : images et voix viennent de `Packet.001`.

**Ce que le français remplace.** Les 6 `.EXE` du pack français contiennent des textes (voir « Textes des EXE » plus bas) mais ScummVM ne les exécute
jamais. Pour le portage, seuls comptent : les 57 `.ALD` (54 diffèrent de ceux de la base, 3 sont identiques), les 13 `.CAL` et `QPC.BIN`
(160 620 o en base, 163 900 o en français). Tout le reste vient de `Packet.001`.

## Fiches de pièces `.ALD`

**Vérifié** (`test/drascula/data/ald.test.ts`, 57 fichiers lus jusqu'au bout) ; lecteur `src/games/drascula/data/ald.ts`.

Fichier texte dont **chaque octet est inversé** (`octet ^ 0xFF`), en CP850, une valeur par ligne. Les lignes sont terminées par `\n` (et non `\r\n` : quelques lignes
ont un `\r` isolé en fin, que le lecteur de ScummVM ignore ; les lignes vides sont sautées). Les entiers peuvent avoir des espaces autour (`" 62 "`) ; une chaîne est
le premier mot de la ligne. Les fichiers portent les numéros 1 à 63 (56 présents) et 102.

**La disposition dépend du chapitre en cours** (ScummVM `enterRoom`) : les 57 fiches se lisent chacune dans une seule des deux dispositions, l'autre échoue.
Les pièces 1 à 19 sauf 13 (17 fiches) sont lues en disposition « chapitre 2 », les 40 autres (13, 20 à 63, 102) en disposition « autres chapitres ».

1. numéro de la pièce (égal au nom du fichier), numéro de piste de musique (19 valeurs distinctes, de 4 à 28 : `track<n>`), nom de l'image annexe (`AUX14.ALG`), niveau de palette ;
2. **chapitre 2 seulement** : une largeur de héros ; si elle est nulle (valeurs par défaut du jeu, 7 fiches) rien d'autre ; sinon (10 fiches : 2, 4, 5, 7, 8, 10, 12, 14, 15, 17)
   hauteur, hauteur des pieds, pas en x, pas en y (`39 64 7 7 2` dans `14.ALD`), puis quatre noms d'images (`964.alg`…) ;
3. nombre d'objets, puis pour chaque objet : numéro, **nom** (en français dans le `.ALD` français), rectangle `x1 y1 x2 y2`, point d'approche `x y`, orientation du héros (`trackObj`),
   visible (0 ou 1), porte (0 ou 1) et, pour une porte, cinq valeurs : pièce de destination, `x y`, orientation, numéro de sortie ;
4. rectangle de marche `x1 y1 x2 y2` ;
5. **autres chapitres seulement** : deux limites de perspective (haute puis basse) en fin de fiche. Le chapitre 2 n'en a pas (la taille vient de l'en-tête).

Sens des champs de porte, vérifié par la cohérence des données et lu dans `rooms.cpp` : le héros marche jusqu'au point d'approche de la porte, puis la pièce de destination est chargée ;
le numéro de sortie désigne un objet **de la pièce de destination**, et c'est le `x y` de cet objet (et non celui de la porte franchie) qui donne le point d'apparition du héros ;
l'orientation de la porte franchie est celle du héros à l'arrivée. Les 107 portes (sur 270 objets) mènent toutes à une fiche existante, vers un objet existant, sauf trois :
`19:173 -> 20/174` (174 n'existe pas dans la pièce 20) et `62:104`, `62:105` -> 63/999 (999 n'est pas un objet).

`2.ALD` porte deux valeurs en trop en fin de fichier (`67 113`), que ScummVM ne lit pas en chapitre 2 ; le lecteur les rend dans `unread`.

**Sens des champs (vague G, lu dans `rooms.cpp`, `actors.cpp`, `objects.cpp` ; détail dans `engine.md`, § 5)** :
- **orientation** (`trackObj`, orientation de porte) : **0 gauche, 1 droite, 2 de dos (en montant), 3 de face (en descendant)** ; elle choisit l'image du héros (voir `graphics.md`). Vérifié : `engine.test.ts`.
- **point d'approche** : où le héros va pour agir sur l'objet ; **point de porte** (`x y` de la fiche de destination) : où il apparaît, les pieds au point.
- **hauteur des pieds** (chapitre 2 ; 12 ailleurs) : marge sous le haut de la zone de marche ; un clic dans la pièce vise `y` borné à `[haut + pieds, bas]`. Elle ne sert qu'à cela.
- **pas en x et en y** (chapitre 2) : lus par ScummVM mais **sans effet** (`startWalking` remet 8 et 3 à chaque départ).
- **largeur et hauteur** (chapitre 2) : taille fixe du héros dans la pièce, sans perspective ; les quatre images sont celles de la fiche (face, côté, inutilisée, dos : `graphics.md`).
- **limites de perspective** (hors chapitre 2) : pourcentages de réduction du héros en haut et en bas de la zone de marche, interpolés en `float` 32 bits (`engine/perspective.ts`) et prolongés au-dessus de la zone dans la pièce 24 et, au chapitre 5, la pièce 54.
- **rectangles** : `Common::Rect`, bords droit et bas **exclus**. **Zone de marche** : rectangle où l'on peut cliquer pour marcher ; le héros n'y est pas contraint autrement.

**Chapitre de chaque pièce** (vérifié, `test/drascula/engine/rooms.ts` : pièces atteintes par les portes depuis la pièce de départ de chaque chapitre, fiches lues dans la disposition du chapitre, plus les pièces où l'on n'entre que par une cinématique, lues dans `animation.cpp` / `rooms.cpp`).
Les 57 fiches ont chacune un seul chapitre ; aucune pièce n'est partagée.

| Chapitre | Départ | Pièces |
| --- | --- | --- |
| 1 | 62 (auberge), sortie 104 | 62, 63 |
| 2 | 14, sortie 162 | 1 à 10, 12, 14 à 19 (disposition « chapitre 2 ») |
| 3 | 20, sortie 99 | 13, 20 |
| 4 | 21, sortie 100 | 21 à 24, 26 à 31, 34 à 44 |
| 5 | 45, sortie 100 | 45, 49 à 55 ; 56, 57 (cinématiques) |
| 6 | 58, sortie 104 | 58 à 61 ; 102 (cinématique) |

Les noms d'objets français sont dans les `.ALD`, y compris `AFFICHE`, `TETE`, `CORBEILLE`. Le texte parlé et les messages sont ailleurs (`drascula.dat`).

## Dialogues `.CAL`

**Vérifié** (`test/drascula/data/cal.test.ts`, 13 fichiers `OP_1.CAL` à `OP_13.CAL`, en français) ; lecteur `src/games/drascula/data/cal.ts`. Même inversion d'octets, mêmes lignes que les `.ALD`.
Chaque fichier compte 11 valeurs : **quatre répliques**, **quatre noms de fichiers de voix** (`357.als`, tous présents dans le jeu) et **trois numéros de réponse** (`8 9 10` dans `OP_1`)
pour les trois premiers choix (le quatrième est la sortie du dialogue). **Les espaces des répliques sont codés par l'octet décodé `0xA7`** (`º` en CP850) parce qu'une chaîne
est lue jusqu'au premier espace ; ScummVM (`cleanupString`) les remplace par une espace après lecture, comme le lecteur.
Exemple français : `UN VAMPIRE A KIDNAPPE LA FILLE DE LA 501!`, `TU NE POURRAIS PAS JOUER UNE CHANSON DE BLUR?`.

**Supposé :** ces fichiers sont les choix proposés par `converse(n)` ; le moteur remplace la troisième réplique de `OP_5` (chapitre 2, drapeaux 38 et 33) et de `OP_12` (chapitre 6, drapeaux 7 et 10) ;
le rôle exact des numéros de réponse (`response(n)`) relève de `talk.cpp`.
Les autres petits fichiers (`INFO.RCT`, texte brut non inversé de 7 nombres ; `SOUND.CFG` ; `.DEV` ; `.COM`) sont des réglages de l'exécutable d'origine, non lus par ScummVM.

## Images `.ALG`

**Vérifié** (`test/drascula/data/alg.test.ts`, 225 fichiers de `Packet.001`) ; lecteur `src/games/drascula/data/alg.ts` et `rle.ts`.

- Fichier de 320 x 200 pixels indexés, en trois parties : **en-tête de 128 octets** (jamais lu ; rempli de zéros dans 215 fichiers, vrai en-tête PCX dans 10 autres :
  octets 0, 2 et 3 = `0x0A 0x01 0x08`, 320 x 200), **données RLE**, **palette de 768 octets** (RVB) en fin de fichier. Entre les données RLE et la palette, un octet : `0x0C`,
  l'octet qui précède la palette dans un PCX standard, dans les 225 fichiers.
- RLE PCX classique : un octet dont les deux bits de poids fort valent `11` donne la répétition (`octet & 0x3F`) de l'octet suivant ; sinon l'octet est un pixel. Un pixel de valeur `0xC0` ou plus
  s'écrit donc comme une répétition de 1. Le décodage s'arrête au 64 000e pixel.
- La palette est lue **depuis la fin du fichier** (pas depuis l'octet suivant les données). Ses valeurs vont jusqu'à 255 (**8 bits**, jamais 6 bits) ; ScummVM (`setRGB`) les divise ensuite par 4 puis
  les remultiplie par 4 à l'affichage (`setPalette`) : les deux bits de poids faible sont perdus. Le lecteur rend les valeurs du fichier.
- `28.ALG` est la seule image unie (un seul indice).
- Rôles **supposés** (d'après les appels `loadPic(...)` de `animation.cpp` et le champ « image annexe » des `.ALD`) : `AUXnn.ALG` feuilles de sprites de la pièce `nn` ; `nn.ALG` décors ;
  les autres (`OP_*`, `CIELO*`, `PLAN*`, `AN*`, `HIS*`, `CIEGO*`, `97.ALG`…) servent aux écrans, à l'interface, aux séquences. **Lu dans ScummVM et vu dans la visionneuse** : `95.ALG` est la feuille d'interface qui porte **la police** (voir « Police ») ;
  `96.ALG` est l'écran d'interface chargé en `COMPLETE_PAL` au démarrage (`frontSurface`) : sa palette est celle des indices réservés ; `99.ALG` (`cursorSurface` et `backSurface`) porte les mots et icônes des verbes ; `CAR.ALG` porte la police des choix de dialogue.

**`HALF_PAL` / `COMPLETE_PAL` : tranché** (lecture de `loadPic` et `setRGB`, `graphics.cpp` et `palette.cpp` de ScummVM ; visionneuse, panneau « palette »). `loadPic(image, surface, nombreDeCouleurs)` lit toujours
les 256 couleurs de l'image mais `setRGB` n'en applique que les `nombreDeCouleurs` premières à la palette du jeu (`gamePalette`, valeurs divisées par 4) : `COMPLETE_PAL` = 256, `HALF_PAL` = **128**.
Les indices 128 à 255 de la palette du jeu sont donc **réservés** (héros, interface, objets) : ils sont posés une fois au démarrage par `loadPic(96, frontSurface, COMPLETE_PAL)` (`drascula.cpp`), et chaque
décor de pièce (`loadPic(_roomNumber, bgSurface, HALF_PAL)`) ne remplace que les 128 premières. La palette de réserve est celle de **`96.ALG`** (indices 128 à 236 pour l'essentiel, les 237 à 252 variant d'une image à l'autre : couleurs de peau `255,187,151`, `231,163,131`, vert `7,147,0`…).
Les données le confirment : la moitié haute de la palette des décors n'est pas la palette de réserve (sur les 85 images `n.ALG`, 80 ont une moitié haute différente de celle de `96.ALG` ; 18 images au total l'ont entièrement noire),
donc l'appliquer en entier rendrait le héros noir ; en revanche 9 décors de pièce dessinent quand même avec des indices de 128 à 255 (`100`, `102`, `103`, `104`, `14`, `23`, `54`, `60`, `62` : de 6 à 4 630 pixels), qui prennent alors les couleurs de réserve (les deux rendus ne diffèrent que pour `102.ALG`, sur 1 853 pixels : les huit autres ont, sur les indices qu'ils utilisent, les mêmes couleurs que `96.ALG`). La visionneuse montre les deux rendus
(`COMPLETE_PAL` : palette entière de l'image ; `HALF_PAL` : 128 premières de l'image et 128 dernières de `96.ALG`). Les images chargées en `COMPLETE_PAL` (`96`, `cielo`, `cielo2`, `nota`, `tlef0`, `aux13`…) remplacent toute la palette.
Les fondus et niveaux de pièce (`setPaletteBase`, `assignPalette`) travaillent ensuite sur cette palette de 256 couleurs : voir `rooms.cpp` (non repris ici). La visionneuse applique les valeurs de ScummVM (`valeur & 0xFC`, soit divisée par 4 puis multipliée par 4) ;
une case à cocher donne les valeurs brutes du fichier.

## Vidéos `.BIN`

Deux formats, selon le fichier. Les deux sont du **delta XOR** contre l'écran précédent. **Vérifié** (`test/drascula/data/bin-ssn.test.ts`, `bin-animate.test.ts`) : les 33 fichiers se
parcourent jusqu'au dernier octet, **7 en SSN** et **26 en « animate »**, chacun dans un seul des deux formats (l'autre lecteur échoue). Le format de chaque fichier se déduit de l'appel
de ScummVM (`playFLI` : SSN ; `animate` : « animate »).

### Format SSN (cinématiques)

**Vérifié** : `INTRO`, `LOGOALC`, `LOGODDM`, `QPC`, `CDR`, `CRD`, `SCROLLB` ; lecteur `src/games/drascula/data/bin-ssn.ts`. Chaque flux commence par un bloc palette (une seule) et se termine par le bloc de fin, sans reste.
Nombre d'images affichées : `CDR` 79, `CRD` 36, `INTRO` 542, `LOGOALC` 71, `LOGODDM` 47, `QPC` 9, `SCROLLB` 72. Rendu de l'image 300 de `INTRO` (carte « Music: Emilio de Paz. ») contrôlé à l'œil, puis fixé
par une somme de contrôle dans le test.

Suite de blocs, chacun commençant par un octet de type :

| Type | Bloc | Contenu |
| --- | --- | --- |
| 0 | image | octet de compression (1 = RLE plein écran, 2 = « décalages »), longueur `u32` LE, données |
| 4 | palette | 768 octets, RVB **6 bits** (0 à 63) |
| 6 | image vide | pas de données : attend un tour de cadence |
| 3 | fin | |

Compression 1 : RLE PCX comme pour `.ALG`, 64 000 pixels. Compression 2 : suite de triplets `(décalage u16 LE, taille u8, taille octets)` écrits dans un tampon
de 64 256 octets remis à zéro à chaque image (seuls les 64 000 premiers forment l'image ; une série peut dépasser). **Dans les deux cas, l'image obtenue est combinée à l'écran par XOR** (`écran ^= image`) sauf pour la toute
première image du flux, qui est copiée telle quelle. Les deux compressions se mélangent dans un même fichier (`INTRO` : 34 en RLE, 508 en décalages ; `LOGODDM` : 47 en décalages seulement).
La cadence n'est pas dans le fichier : l'appelant la donne. **Lu dans ScummVM** (`playFLI(nom, vitesse)`, `graphics.cpp`, appels de `animation.cpp`) : `globalSpeed = 1000 / vitesse` ms (division entière) et **chaque image affichée et chaque bloc
« image vide » attend un tour** de cette durée (`waitFrameSSN` : les tours se suivent sur une horloge fixe, sans dérive) ; un bloc palette n'attend pas. Vitesses : `INTRO` 12, `LOGOALC` 8, `LOGODDM` 9, `SCROLLB` 9, `QPC` 1, `CRD` 1 ;
`CDR.BIN` n'est jamais joué par ScummVM. **Les blocs vides sont la minuterie des pauses** : en tours (images affichées + blocs vides) `INTRO` compte 1 352 tours (542 images, 810 blocs vides) soit 112,7 s à 12 par seconde, `LOGOALC` 71 (8,9 s),
`LOGODDM` 51 (47 + 4, 5,7 s), `SCROLLB` 73 (8,1 s), `QPC` 33 (9 images + 24 vides : 33 s à 1 par seconde, des images tenues plusieurs secondes), `CRD` 136 (36 + 100, 136 s) et `CDR` 274 (79 + 195). Écart avec le jeu d'origine :
non mesuré (pas d'exécutable DOS lancé) ; le panneau « cadence » de la visionneuse joue chaque `.BIN` à cette vitesse, modifiable.
Un type de bloc inconnu arrête la lecture chez ScummVM ; le lecteur lance une erreur (aucun fichier du jeu n'en a).

### Format « animate » (animations dans le jeu)

**Vérifié** : les 26 fichiers (`AG`, `BEB`, `BES`, `BIO`, `BJB`, `CNF`, `DET`, `DRF`, `FIN`, `FREL`, `FREL2`, `FUM`, `GAF`, `HBP`,
`LEV`, `LIB`, `LIB2`, `MAN`, `RAP`, `RAYO1`, `RAYO2`, `RCT`, `SCR2`, `SCR3`, `ST`, `UP`) ; lecteur `src/games/drascula/data/bin-animate.ts`. Rendu de `FIN.BIN` image 60 contrôlé à l'œil (la taverne), puis fixé par une somme de contrôle dans le test.

- `u32 LE` : nombre d'images `N` (7 pour `LEV`, 150 pour `FIN`, 116 pour `ST`…) ;
- puis `N` images, chacune : `u32 LE` longueur, données RLE (64 000 pixels), **palette de 768 octets en 6 bits** (valeurs de 0 à 63 dans les 26 fichiers). Le fichier contient exactement `N` images ;
  `animate` de ScummVM n'en affiche que `N - 1` (la dernière est lue, jamais jouée) ;
- à l'affichage, chaque image est combinée par XOR avec la précédente, sauf la première ; seule la palette de la première image est appliquée.

La cadence est donnée par l'appelant. **Lu dans ScummVM** (`animate(nom, ips)`, `graphics.cpp`) : la première image est affichée, puis on attend `1000 / ips` ms (division entière) **après chaque image**, sans compenser le temps de décodage
(la cadence réelle est un peu plus lente que `ips`) ; la boucle s'arrête à la `N - 1`ᵉ image ou à la première touche pressée. Vitesses des appels de `animation.cpp` et `rooms.cpp` : `AG` 14, `BEB` 10, `BES` 16, `BIO` 14, `BJB` 14, `CNF` 14, `DET` 17,
`DRF` 16, `FIN` 14, `FREL` 16, `FREL2` 16, `FUM` 15, `GAF` 15, `HBP` 14, `LEV` 15, `LIB` 16, `LIB2` 16, `MAN` 14, `RAP` 16, `RCT` 11, `SCR2` 17, `SCR3` 17, `ST` 14, `UP` 14 ; `RAYO1` est joué à 16 ou 23 et `RAYO2` à 15 ou 17 selon la scène.
Seuls `LIB2` et `FREL` sont joués plusieurs fois, à la même vitesse. Même réserve que pour les SSN : lu dans le code, non mesuré sur le jeu d'origine.

Contenu baké dans les images : `INTRO.BIN` et `CRD.BIN` contiennent des **textes anglais dessinés dans les images** (par exemple « Music: Emilio de Paz. » dans l'intro).
Le pack français ne remplace que `QPC.BIN` (163 900 octets en français, contre 160 620 en base) : le générique et l'intro restent donc en anglais en version française, comme dans ScummVM (le pack espagnol
remplace `INTRO.BIN` et `CRD.BIN`).

## Sons et voix `.ALS`

**Vérifié** (`test/drascula/data/als.test.ts`, 783 fichiers) ; lecteur `src/games/drascula/data/als.ts`. PCM brut **8 bits non signé**, mono ; tailles de 3 872 à 169 246 octets (médiane 32 208), soit jusqu'à 15 s à 11 025 Hz.
Les fichiers commencent par 32 octets de silence exact (`0x80`) dans 707 fichiers sur 783 et finissent ainsi dans 714 ; dans les autres, les 32 premiers ou derniers octets s'écartent de `0x80` (le plus souvent
de 1 à 3, parfois jusqu'au bout de l'échelle), mais le jeu les saute tous de la même façon. Les 783 fichiers sont numérotés
par catégorie (décompte vérifié par `files.json`), en correspondance avec les tableaux de textes de `drascula.dat` :

| Préfixe | Nombre | Plus grand numéro | Texte de `drascula.dat` (borne vérifiée) |
| --- | --- | --- | --- |
| (aucun) | 463 | 500 | `text` (501 lignes) : `214.ALS` = ligne 214 (supposé) |
| `D` | 68 | 83 | `textd` (84) |
| `B` | 16 | 62 | `textb` (15) : **exception**, les numéros `B` dépassent le tableau ; correspondance à trancher (`B61` et `B62` n'existent qu'en base) |
| `BJ` | 28 | 28 | `textbj` (29) |
| `E`, `I`, `L`, `P`, `T`, `VB` | 23, 32, 30, 19, 24, 62 | 23, 32, 31, 19, 24, 62 | `texte` (24), `texti` (33), `textl` (32), `textp` (20), `textt` (25), `textvb` (63) |
| `S` | 15 | 15 | effets sonores (`playSound(n)` : `Sn.ALS`) (supposé) |
| `F` | 3 | 3 | séquence finale (supposé) |

Pour chaque préfixe qui a un tableau, le plus grand numéro de voix tient dans le tableau (vérifié) ; que le numéro `n` soit la ligne `n` n'est pas vérifié (les voix sont en anglais, les textes en français).

**Lecture** (`sound.cpp`, ScummVM) : 11 025 Hz ; le jeu saute les 32 octets de silence du début et ignore les 32 derniers (supposé pour la fréquence, vérifié pour les marges de 32 octets au sens du lecteur) ;
le jeu attend la fin du son avant de continuer le dialogue (supposé).

**`3.ALS`** (145 166 octets) : **vérifié** que le silence initial fait exactement 73 959 octets (décalage de départ du contournement de ScummVM) et que le silence final dépasse 26 306 octets (26 336 mesurés).
Le contournement de ScummVM (début à 73 959, 26 306 octets ignorés en fin) est écrit pour une taille de 145 166 octets *après* soustraction des 64 octets de marge, alors que le fichier en fait 145 166 en tout :
la condition de ScummVM ne se déclenche donc jamais sur ce fichier et la voix est jouée avec son grand silence (anomalie de ScummVM, supposée d'après le code). **Écart voulu du lecteur** : il applique le contournement
à ce fichier (échantillons 73 959 à 118 796, soit 44 837 octets) ; décision à confirmer à l'écoute en vague A.

Les voix **françaises n'existent pas** : la version française affiche les textes de `drascula.dat` en sous-titres sur les voix anglaises de `Packet.001`
(décision du 2026-11-07). Les packs espagnol (`.004`, 780 fichiers) et italien (`.005`, 782) ont leurs propres `.ALS`, tous différents de ceux de la base.

## Musique OGG

**Vérifié :** `audio/track1.ogg` à `track31.ogg`, **OGG Vorbis stéréo 44,1 kHz**, environ 112 kb/s (libvorbis 1.2.3), total 36,9 Mo (de 120 Ko à 2,4 Mo par piste).
Le numéro de piste est celui de la ligne « musique » du `.ALD` (4 à 28 selon les pièces).

**Supposé :** ScummVM joue la piste `p` des `.ALD` avec `playMusic(p)` -> piste CD d'index `p - 1`, mappée par son gestionnaire de CD sur `track<p>.ogg`
(pas d'écart d'un cran à confirmer à l'écoute) ; chaque piste est jouée en entier puis relancée par la boucle principale tant que la pièce n'en change pas ;
le volume baisse (fondu) pendant certaines voix. Aucun fichier de table de pistes dans les données.

## `drascula.dat` (données du moteur ScummVM)

**Vérifié** (`test/drascula/data/dat.test.ts`) : le fichier fourni (`original/drascula/drascula.dat`, 259 625 octets, signature `DRASCULA`) est de **version 7** (`DRASCULA_DAT_VER 7` dans `create_drascula.cpp`
de la branche principale de ScummVM). Le lecteur `src/games/drascula/data/dat.ts` le consomme exactement, jusqu'au 259 625e octet, sans reste, y compris les six langues.
Tous les entiers sont **big-endian** (`u16`, `s16`).

| Section | Structure |
| --- | --- |
| en-tête | `"DRASCULA"` (8 octets), version (`u8` = 7) |
| tables de caractères | 4 `u16` : nombre de lettres (30), signes (30), cyrillique (66), accentués (33) ; puis chacune des 4 listes, 4 octets par entrée : `u8` caractère d'entrée, `s16` position dans la police, `u8` type |
| `itemLocations` | `u16` n (44) puis n x (`s16` x, `s16` y) : positions des objets de l'inventaire |
| `x_pol` / `y_pol` | n = 44, paires (`s16`, `s16`) : cases de l'écran de l'inventaire |
| `verbBarX` | n = 8, `s16` |
| `x1d_menu` / `y1d_menu` | n = 29, paires |
| `frameX` | n = 20, `s16` |
| `candleX` / `candleY` | n = 3, paires |
| `pianistX` | n = 9, `s16` ; `drunkX` : n = 8, `s16` |
| `roomPreUpdates` | n = 41 x 10 `s16` : pièce, drapeau, valeur du drapeau, source x y, destination x y, largeur, hauteur, type (rectangles recopiés sur le décor avant l'affichage) |
| `roomUpdates` | n = 16 x 10 `s16`, même forme (après l'affichage) |
| `roomActions` | n = 307 x 5 `s16` : pièce, chapitre, verbe, objet, numéro de réplique : réponses par défaut aux verbes |
| `talkSequences` | n = 225 x 4 `s16` : chapitre, séquence, type de commande, action : scripts de dialogues dans l'ordre |
| langues | `u16` = 6 (anglais, espagnol, allemand, **français (index 3)**, italien, russe) |
| 15 sections de textes | pour chacune : `u16` nombre de lignes (le même pour toutes les langues), puis pour chaque langue : `u16` longueur du bloc, 2 octets de remplissage, puis chaque ligne : `u16` longueur (chaîne + NUL + remplissage + 2), chaîne **CP850** terminée par NUL, 1 à 4 zéros de remplissage (la ligne fait un multiple de 4 octets). |

Les 15 sections de textes, dans l'ordre du fichier, avec leur nombre de lignes par langue : `text` 501, `textd` 84 (dialogues du début), `textb` 15 (barman),
`textbj` 29 (B.J.), `texte` 24, `texti` 33 (Igor), `textl` 32, `textp` 20 (pianiste), `textt` 25, `textvb` 63 (Von Braun), `textsys` 4, `texthis` 5 (histoire), `textverbs` 6, `textmisc` 7,
`textd1` 11. Le français est complet dans chacune : même nombre de lignes que les autres langues, aucun caractère de contrôle, première ligne non vide dans chaque section (vérifié ; la ligne 0 est souvent vide, les voix sont numérotées à partir de 1). Exemple : ligne 1 de `text` = « C'EST LA DEUXIèME PORTE LA PLUS GRANDE QUE J'AI VUE DANS MA VIE. ».

**Écarts relevés dans les données françaises (vérifié) :** les majuscules accentuées alternent avec des minuscules accentuées codées pour la police du jeu
(`DEUXIèME`, `çA`) ; `texthis` est en casse mixte avec des fautes (`Être prÊt`, `chÂteau`) ; `textd1` ne contient que des chiffres, identiques dans toutes les langues (vérifié ; ce sont des touches d'un code, supposé). Ce sont les données
d'origine, à garder telles quelles par défaut.

**Origine et licence :** les textes sont ceux de l'exécutable d'origine, extraits par l'équipe de ScummVM ; les tables (`roomActions`, `talkSequences`, `roomUpdates`)
viennent de leur rétro-ingénierie du moteur. `drascula.dat` est généré par `devtools/create_drascula` depuis `staticdata.h` (450 Ko) ; ScummVM le diffuse dans
`dists/engine-data/drascula.dat` (GPL v3 ou ultérieure pour le code ; la mention de licence des données est celle de ScummVM : à reprendre avec le fichier).

### Textes des EXE français

**Vérifié :** les EXE du pack français (`HACKER.EXE`, `IGOR.EXE`, `HACKER2.EXE`, `HACKER3.EXE`, `PENDULO.EXE`, `YODA.EXE`) contiennent les textes en CP850 (des dizaines de lignes de
`text` y sont retrouvées telles quelles, avec l'encodage d'accents CP850). `drascula.dat` en est donc une copie ; aucune raison de relire les EXE pour le portage.

## Police

**Tranché** (lecture de `print_abc` et `print_abc_opc`, `graphics.cpp`, et du chargement de `drascula.dat`, `drascula.cpp`, dans ScummVM ; puis rendu de textes dans la visionneuse, panneau `drascula.dat`, section « Police »).

- **Feuille des glyphes : `95.ALG`** (chargée dans `tableSurface` au démarrage ; ScummVM charge `974.ALG` à la place pour l'espagnol hors chapitre 6, sans objet ici). Les glyphes sont tout en bas de l'image, en trois rangées dont l'ordonnée dépend du type de la table
  de caractères : **y = 158 pour les lettres (type 0), 169 pour les signes (type 1), 180 pour les accentués (type 2)** (149 et 160 pour les lettres et signes en espagnol). Un glyphe fait **8 x 6 pixels** (`CHAR_WIDTH`, `CHAR_HEIGHT`) ; sa colonne est le `mappedChar`
  de la table (6, 15, 24… : un glyphe tous les **9 pixels**, donc une marge d'un pixel). L'indice de palette **255 est transparent** à la copie (`copyRect`). Le texte avance de 8 pixels par caractère et passe à la ligne après x = 317 (interligne : 6 + 2).
- **Table des caractères** (`dat.ts` : lettres 30, signes 30, accentués 33 ; les 66 cyrilliques ne servent qu'au russe) : l'octet du texte (CP850) est **mis en majuscule** (`toupper`, qui ne touche que `a`-`z`), puis cherché dans l'ordre lettres, signes, accentués ;
  la première entrée gagne. Les lettres couvrent `A`-`Z`, `Ñ` (`¤` 164 et `¥` 165 partagent le glyphe 132) et l'espace (glyphe 250, vide). Les accentués associent **les minuscules et les majuscules accentuées de CP850 au même glyphe** (`á` 160 et `Á` 181 -> 6 ; `è` 138 et `È` 212 -> 60 ; `ç` 135 et `Ç` 128 -> 150) :
  la police n'a que des capitales, ce qui explique les textes français « DEUXIèME » (le `è` minuscule est l'encodage d'un `È` majuscule). Un octet sans entrée recopie chez ScummVM le glyphe précédent (les variables ne sont pas remises à zéro) et avance quand même de 8 pixels ; le rendu du jeu (`render/font.ts`) reproduit ce comportement, la visionneuse aussi (elle utilise le même code). **Vérifié** (vague R, `test/drascula/render/font.test.ts`) : sur les 15 sections de textes français, un seul octet n'a pas de glyphe, le `Ï` (CP850 216) de « POMMES AÏOLI » (`text`, ligne 166) et « AÏE ! » (`text`, ligne 218), qui s'affichent donc avec le glyphe du caractère précédent (« AAOLI », « AAE ! ») comme dans ScummVM.
- **Police des choix de dialogue** (`print_abc_opc`, appelée par `converse`, qui charge **`CAR.ALG`** dans `backSurface` avant d'afficher les quatre choix) : glyphes de **6 x 5 pixels**, au pas de 7 ; la colonne se déduit de la table : `x = (mappedChar - 6) / 9 x 7 + 10`.
  Trois jeux de glyphes, un par état du choix (`kDialogOptionUnselected` 1, `Selected` 2, `Clicked` 3 : couleurs différentes), chacun avec une rangée de lettres et une de signes (**tous les types > 0, accentués compris**, vont dans la rangée des signes) :
  y = 6 / 15 (non choisi), 31 / 40 (survolé), 56 / 65 (cliqué). L'apostrophe est remplacée par l'octet 164 sauf en espagnol. `CAR.ALG` contient aussi, en bas, une copie de la police 8 x 6.
  (`99.ALG` est rechargé en `backSurface` après le dialogue : il ne porte pas cette police.)

## Ce qui reste supposé ou à vérifier

- Cadence : lue dans ScummVM (voir « Vidéos ») mais **non mesurée sur le jeu d'origine** ; séquences et durées des cinématiques (`animation.cpp`) ; mixage palette / niveaux de pièce (`setPaletteBase`, fondus) ; courbes de fondu de la musique ; ordre des pistes en début de chapitre.
- Palette : `HALF_PAL`, les niveaux de pièce (`setPaletteBase`) et les fondus sont lus dans `palette.cpp` et reproduits (`graphics.md`) ; restent à confirmer à l'œil les durées de fondu (cadence) et l'ordre des chargements de `96.ALG` propres aux cinématiques (vague C).
- Police : seule la variante française / anglaise est décrite (pas l'espagnol ni le russe). Le retour à la ligne (x > 317) et la mise en page des textes centrés sont rendus (`graphics.md`).
- Correspondance exacte « verbe -> numéro » (`kVerbLook`, `kVerbPick`…) : transcrite par la vague G (`engine/state.ts`) ; numéros de commande des `talkSequences` : transcrits en vague T (`CommandType`, `talk.md` § 4, vérifié sur les 225 lignes).
- Correspondance entre les voix `B*.ALS` et les textes (`textb` n'a que 15 lignes pour des numéros jusqu'à 62) ; que le numéro d'une voix soit l'index de la ligne de texte.
- Contournement de `3.ALS` : à confirmer à l'écoute (voir « Sons et voix »).
- Format des sauvegardes de ScummVM : non repris, remplacé par le stockage commun (voir `plan.md`).
- Sous-titres : durée d'affichage en l'absence de voix (non utile ici : les voix existent) et synchronisation avec la fin du `.ALS`.

## Méthodes de vérification

Les affirmations « vérifié » des formats de données ci-dessus sont couvertes par les tests de `test/drascula/data/` (lancés sur les fichiers de `original/drascula/`, ignorés s'ils sont absents) :
`rle`, `alg`, `ald`, `cal`, `bin-ssn`, `bin-animate`, `als`, `dat`, `files`, et `test/shared/cp850.test.ts` pour le décodage CP850.

- `.ALG` : 225 fichiers décodés, palette de fin de fichier, en-têtes (215 nuls, 10 PCX).
- `.ALD` : 57 fichiers lus entièrement dans leur disposition de chapitre ; cohérence des portes.
- `.CAL` : 13 fichiers, voix référencées présentes.
- `.BIN` : partition 7 SSN / 26 « animate », parcours jusqu'au dernier octet, sommes de contrôle de deux images contrôlées à l'œil.
- `.ALS` : 783 fichiers, marges, taille, contournement de `3.ALS`.
- `drascula.dat` : consommé sans reste, 15 sections, six langues, français.
- `files.json` : décompte des familles et résolution de noms insensible à la casse.

Visionneuse de ressources (`src/games/drascula/ui/asset-viewer.html`, avec `npm run dev`, page `/src/games/drascula/ui/asset-viewer.html`) : un panneau par famille (images avec palette `COMPLETE_PAL` / `HALF_PAL`, `.BIN` image par image avec cadence, `.ALD` et `.CAL` en tableau,
textes et police de `drascula.dat`, courbe et lecture d'un `.ALS`). Les 1 146 fichiers du manifeste ont été ouverts dans le navigateur sans erreur ; `test/drascula/ui/` couvre la logique sans DOM (groupes, palettes, cadences, glyphes, décodage des `.BIN`, chargement du manifeste).

Vérifié lors de l'étude, hors dépôt et donc non couvert par un test : les archives ARJ (`PACKET.00x`, extraction `7zz`), le contenu des archives des autres langues, les EXE français et les OGG d'origine (la musique versionnée est la conversion MP3 ;
seuls le nom et le nombre des 31 pistes MP3 sont testés).
