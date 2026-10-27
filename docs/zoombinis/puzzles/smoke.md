# Le piège de cristal (`SMOKE.MHK`, écran 17) : étude de rétro-ingénierie

Épreuve 11 du parcours (2e de l'étape 4, entre la tanière du sphinx et le gouffre des véhibules) de `ZOOMBINI.EXE` (L'Odyssée des Zoombinis, version 1.0FR, NE 16 bits). Archive `SMOKE.MHK`, `Enter` `1158:0000`, `Tick` `1158:0cbe`, `Key` `1158:2504`, sortie `1158:0c4c` (descripteur `1530:21b8`, [../engine.md](../engine.md) §2.1). Document d'étude seul (aucun code applicatif). Cadre général : [../engine.md](../engine.md) (moteur, `SCRB` / `SCRS`, features), [../screens.md](../screens.md) (niveaux §1.6, attributs §2.1, sortie d'épreuve §3.4, tampon de partie §6.3).

Confiance : **sûr** = lu dans le code ou vérifié sur les données ; **probable** = déduit de plusieurs indices concordants ; **hypothèse** = déduction non vérifiée.

## 0. Pièges de lecture

- **Les tables de saut sont dans le segment de code.** Le rappel d'événements `1158:37a4` (21 cas) et le `Key` `1158:2504` (5 cas) font une recherche linéaire dans des tables `CS:` (valeurs puis cibles) que Ghidra ne désassemble pas : table des événements = 21 mots à `1158:3e05`, 21 cibles à `1158:3e2f` ; table des touches = 5 mots à `1158:26af`, 5 cibles à `1158:26b9`. (`DS:3e05` n'a aucun sens : ce n'est pas dans le segment de données.) Les corps des cas sont relus avec un projet Ghidra jetable (copie) : ils forment une seule « fonction » `1158:37d2`–`1158:3e04`. Les arguments `pascal` sont dans l'ordre inverse de la signature décompilée ([../engine.md](../engine.md) §0).
- **Tableaux et pointeurs `int *`.** Le décompilé écrit `(&[9448])[k]` pour une adresse `DS:9448 + 2k` ; les « octets » d'attribut sont lus `char` (`+0xec`…) mais copiés dans des **mots** (`DS:9442…`). Les accès de `1158:4dbf` (générateur des cristaux, niveaux 3 et 4) sont particulièrement confus : voir §3.5 et §9.
- **`DS:xxxx` = segment `1530`.** Les noms de variables (`[94c8]` etc.) sont les adresses du code ; les noms français sont inventés.
- **Événement de script** : un terminateur de script avec octet bas `b ≠ 0` appelle `+0x10` de la feature avec l'argument `b − 1` ([../engine.md](../engine.md) §3.5). Les arguments cités ci-dessous (`arg 17`…) sont ces valeurs `b − 1`.
- **Cadence** : 1 tick = 17 ms ; les délais entre images valent 5, 6 ou 10 ticks selon la feature (§2.2).

## 0.1 Résumé exécutif

- **Le jeu en une phrase.** Une « machine à miroir » compare deux versions modifiées de deux fiches de Zoombini : à gauche, **le Zoombini du joueur** (4 attributs) ; à droite, **une cible** (une silhouette). Chaque côté peut être transformé par des cristaux posés sur la voie. Si, après transformation, **les 4 attributs sont identiques des deux côtés**, le Zoombini passe (monte dans un wagonnet qui roule vers la sortie) ; sinon il est **piégé** et sera perdu. **Sûr** (comparaison `1158:31e8`).
- **Niveaux 1 et 2** (les deux partagent les mêmes scripts) : le joueur glisse un Zoombini du groupe sur le wagonnet de gauche, puis l'une des **8 silhouettes** sur le cristal de droite ; au niveau 1 il faut que la silhouette soit **identique** au Zoombini ; au niveau 2, **4 filtres fixes** (2 de chaque côté) **forcent** certains attributs à des valeurs précises avant la comparaison. Une silhouette jumelle existe toujours (vérifié par simulation du tirage : 0 échec sur 200 000 tirages). **Sûr.**
- **Niveaux 3 et 4** : le joueur ne choisit plus ni le Zoombini (ils arrivent dans l'ordre) ni la cible (une seule, imposée). Il dispose de **6 cristaux** (« gemmes ») qu'il glisse sur 2 × 3 emplacements de la voie ; chaque cristal **fixe** un ou deux attributs à une valeur, ou **ajoute 1 cycliquement** (1→2→…→5→1) à un attribut. Le puzzle est reconstruit par le levier à chaque Zoombini (niveau 3) ou à chaque **paire** de Zoombinis (niveau 4, où le second Zoombini est testé automatiquement avec la même disposition contre une seconde cible cachée). **Sûr** pour la mécanique des cristaux, **probable** pour le générateur et pour le niveau 4.
- **Pas de compteur d'erreurs.** Chaque Zoombini subit **un seul test** ; le joueur peut réarranger autant qu'il veut avant de tirer le levier. Un échec fait perdre ce Zoombini (renvoyé au camp 2 à la sortie) ; il n'y a ni chronomètre ni limite d'essais. **Sûr.**
- **Sortie** : le bouton « go » n'est actif qu'après le premier Zoombini sauvé et envoie à l'écran 18 (Maze2) ; les Zoombinis non testés à ce moment sont perdus. **Sûr.**
- Nom : le texte `STRL` 2016 de l'étape 4 dit « percé le secret / compris la loi secrète **du piège de cristal** » et, au niveau 4, « **bien placé les cristaux** grâce à leur vue perçante » : cela confirme la correspondance écran 17 ↔ « le piège de cristal » (§1.3). Le souvenir d'une « Mirror Machine » dans l'original est **compatible** avec la mécanique (deux côtés qu'il faut rendre identiques) : **hypothèse** non vérifiable ici.

## 1. Identification

### 1.1 Écran et handlers

| Rôle | Adresse | Confiance |
|---|---|---|
| Écran 17 (descripteur `1530:21b8`) | Enter `1158:0000`, **Exit** `1158:0c4c`, Tick `1158:0cbe`, Key `1158:2504` | sûr |
| `1158:0be9` | **n'est pas la sortie** : crochet de *tick* d'une feature sans script (créée à la fin d'`Enter`, flags `0x1000`) qui redessine le bouton « go » (`DS:2154`) quand `[9504]` change et le bouton carte (`DS:2130`) une fois (`[2242]`, `[2244]`) | sûr |
| `1158:0bcb` | crochet de *dessin* de la même feature : `0aad(0,0,1)` puis `0aad(0,0,2)` (dessine les deux boutons) | sûr |
| `1158:0aad(redessiner, enfoncé, bouton)` | dessine le bouton 1 (carte : images 5 / 6 de `tBMP` 6000) ou 2 (go : image 1 si `[9504] = 0`, sinon 2 / 3) à partir de `DS:210c`/`210e + 0x24 × bouton` | sûr |
| Clic de région | `1158:1429(code)` (rappel de `1038:0000(DS, 0x21ac, 1, 0xc000)`) | sûr |
| Rappel d'événements des scripts | `1158:37a4(arg, feature)` (cas §5.4) ; second rappel `1158:3e59` pour la feature `[9310]` au niveau 4 | sûr |
| Remise à zéro / nouveau tirage (levier) | `1158:2208` ; au niveau 3 appelle `1158:236b` | sûr |
| Test de la machine | `1158:31e8` (comparaison), `1158:3126` (lance l'animation de résultat) | sûr |
| Générateurs | `1158:4956(niveau)` → `1158:4a01(nombre, type)` ; type 1 traité dans `4a01`, type 2 `1158:4500`, type 3 `1158:4dbf` ; réinitialisation des silhouettes `1158:42c0` ; filtres `1158:44ab` ; choix des cibles `1158:3f88` (niveaux 1-2), `1158:414b` (niveaux 3-4) | sûr |
| Recopie d'attributs | `1158:26d7(cible, id)` (vers un cristal), `1158:288c(case, id)` (vers la table de cases), `1158:2f70(cristal)` (efface), `1158:3011(case)`, `1158:3050` (efface tout) | sûr |
| Chaîne de cristaux | `1158:2953` / `1158:2ad9` (côté gauche), `1158:2a16` / `1158:2d23` (côté droit) | sûr |
| Glisser d'un objet | `1158:5e1d(point, feature)` (boucle de glisser, renvoie la case visée) | sûr |
| Crochets d'un objet de puzzle (cristal, silhouette, filtre, cible) | tick `1158:620c`, dessin `1158:6122`, construction `1158:6099` | sûr |
| Voie des wagonnets, arrivée des Zoombinis | `1158:3622` (départ du wagonnet vers sa place), `1158:3744` (lance un `SCRS` sur un Zoombini) | sûr |

### 1.2 Ressources de `SMOKE.MHK`

Inventaire vérifié sur l'archive (`original/zoombinis/SMOKE.MHK`).

| Tag | Ids | Usage | Confiance |
|---|---|---|---|
| `tBMP` | 5000 | fond 640 × 480 (RLE) : mine, rochers, rails, grande pierre centrale surmontée d'un cristal vert suspendu, deux plates-formes de bois (gauche et droite), voie ovale en bas ; `SHPL` 5000 = palette | sûr |
| `tBMP` | 100 | « terrain » 160 × 120 (`11a8:1783(100)`), non étudié | sûr (chargement) |
| `tBMP` | 6000 | 6 images : boutons carte / go (`11b8:0497`, `DS:21cc`) | sûr |
| `tBMP` | 10000 | planche de 69 images (chargée par `11a8:2ae6`, `DS:93ae`) : pièces de silhouettes de Zoombini en mauve (corps, cheveux, yeux, nez, pieds) et faces de cristaux verts (≈ 64–69) ; **hypothèse** pour la correspondance image ↔ valeur d'attribut | sûr (contenu), hypothèse (détail) |
| `REGS` | 10000, 10001 | ancres X et Y de la planche 10000 (69 mots + 1), chargées par `1168:01f4` (`DS:93ce`, `DS:93d2`). `REGS` 10002 existe mais n'est **pas chargé** par `Enter` | sûr |
| `tBMP` | 11000 | groupe de formes 0 (98 images, positions absolues, `11a0:0000(0, 0, 11000)`) : tous les `SCRB` 11000–11077 | sûr |
| `SCRB` | 11000 à 11077 (78, chargés par `11a8:14ab(11000, 78)`) | voir §6 | sûr |
| `SCRS` | 11999 (`1168:03ef(11999, 1)`), 12000 à 12049 (50, `1168:04d0(12000, 50)`) ; 12050 existe (1 image, pose `0xffff`) mais n'est pas chargé | animations de Zoombini : marche, trajet en wagonnet, arrivées, danses | sûr |
| `\0SND` | 11000 à 11017 (18) | sons propres à l'écran (§6.3) | sûr |
| `SHPL` | 5000 | palette | sûr |
| `NODE` / `PATH` | aucun | | sûr |

Hors archive : voix `\0SND` de `ZOOMBINI.MHK` (ids 20045–20048, 20055–20063, 20066–20067 ; 996–999), musiques `tMID` de `MIDIMPC.MHK` (30030–30033), sons de Zoombini dépendant du Zoombini (§6.3).

### 1.3 Nom et correspondance

- **Écran 17 ↔ « le piège de cristal » : sûr** (et non plus seulement par élimination). Indices : (1) les 4 textes de l'étape 4 (`STRL` 2016, indices 12 à 15) citent dans l'ordre le sphinx, le **piège de cristal**, le gouffre des véhibules ; (2) le texte du niveau le plus élevé dit « bien placé les cristaux grâce à leur vue perçante » ; (3) le texte du niveau 3 dit « compris la loi secrète du piège de cristal » ; (4) l'épreuve met en scène un cristal vert géant suspendu qui tombe sur les Zoombinis refusés, et des cristaux verts à placer.
- **« Mirror Machine »** : le test porte sur l'**égalité de deux fiches de Zoombini transformées**, l'une à gauche, l'autre à droite d'un cristal central, ce qui évoque une « machine à miroir ». C'est un souvenir de l'original anglais, pas une preuve du corpus : **hypothèse**.
- Scène : mine de cristaux ; les Zoombinis voyagent dans des **wagonnets** sur des rails (`SCRB` 11036–11075 : wagonnets, `SCRS` 12020–12044 : trajets).

## 2. Objets de l'épreuve

### 2.1 Objets de puzzle (« features » à `SCRB` nul, crochets `620c` / `6122`)

Créés par `1158:4a01(nombre, type)` (une feature par appel de `1158:6099`). Chaque objet porte **4 octets** (`feature + 0xec … 0xef`, valeurs 1 à 5 ou 0 = « pas d'effet ») et une position `(x, y)` en `+0xd6` (mots). Dessin par `1158:6122` : les parties `(w, x, y)` du tampon `+0x30` sont des indices de la planche `tBMP` 10000 (`DS:93ae`), reconstruites par `1140:0000` à partir des 4 octets quand `+0x124 ≠ 2` (`+0x124 = 4` : redessiner ; `= 2` : masqué). Le tick `1158:620c` anime les cristaux (§3.3). `+0xe0 ≠ 0` = actif.

| Type | Rôle | Niveaux | Nombre | Ids (variable) | Positions (`DS:`) |
|---:|---|---|---:|---|---|
| 1 | **silhouettes candidates** | 1, 2 | 8 | `[93e8 + 2k]`, `k = 0…7`, compteur `[93d6]` | `1ed0 + 4k` : (459,26) (535,25) (429,80) (500,84) (619,76) (423,168) (525,167) (605,163) |
| 2 | **filtres fixes** | 2 | 4 | `[9410 + 2i]`, `[93da]` | `1f18 + 4i` : (187,255) (247,255) (424,255) (484,255) |
| 3 | **cristaux / gemmes** (numéros 1 à 6), **cible** (7), **seconde cible** (8) | 3, 4 | 7 ou 8 | `[9430 + 2k]`, `k = 1…8`, compteur `[93d8]` (part de 1) ; `[943e]` = n° 7, `[9440]` = n° 8 | gemmes : étagères `1ef4 + 4p` (`p` = 1…6) : (441,66) (531,70) (605,67) (421,160) (483,153) (612,153) ; n° 7 : (548,255) ; n° 8 : (616,253) |
| 4 | **cristal gauche** (Zoombini testé) puis **cristal droit** | 1, 2 : les deux ; 3, 4 : le gauche seul | 2 ou 1 | `[941c]` (gauche, (124,255)), `[941e]` (droit, (548,255)), compteur `[93dc]` | `1f28`, `1f2c` |
| 5 | **porte-fiche de résultat** gauche et droit (fiches comparées) | 1 à 4 | 2 | `[9422]`, `[9424]`, compteur `[93de]` | `2030` : (317,254) et (354,254) |

Les objets 1 à 8 de type 3 sont, au niveau 3, créés 7 (6 gemmes + cible), au niveau 4, 8. `4956(niveau)` crée, dans cet ordre : niveau 1 `(8,1)(2,4)(2,5)` ; niveau 2 `(4,2)(8,1)(2,4)(2,5)` ; niveau 3 `(7,3)(1,4)(2,5)` ; niveau 4 `(8,3)(1,4)(2,5)`. Après la 7e création de type 3 (`[93d8] == 8`) : `26d7(7, [943e])`, `288c(7, [943e])`, `[9426] = 1` ; après la 8e (`[93d8] == 9`) : `26d7(8, [9440])`.

Attention à l'effet de bord : `26d7(0|1|7|8, id)` **recopie** les 4 attributs de l'objet `id` vers un cristal (`[941c]` pour 0, `[941e]` pour 1, `[943e]` pour 7, `[9440]` pour 8) et marque `+0x124 = 4` (redessiner) ; avec `param_1 ≠ 0` et niveau < 3 il masque aussi l'objet source (`+0xe0 = 0`) et fait glisser le cristal sous le curseur (`11a8:2a0a`).

### 2.2 Features à script (`SCRB`)

Créées dans `Enter`. Colonnes : variable `DS:`, `SCRB` (niveaux 1-2 / 3-4), drapeaux `0ad6`, délai en ticks, rôle. **Sûr** pour les ids ; les rôles sont **probables** (rendu des sprites + usage).

| Var | `SCRB` | Flags | Délai | Rôle |
|---|---|---|---:|---|
| `[9310]` | 11013 (L1-3) / 11011 (L4) | `0x4188000` | 10 | socle de la cible droite, en (515,267) ; au niveau 4 il anime le changement de cible (§5.5) |
| `[9304]` | 11076 (L1-2 seulement) | `0x5188000` | 10 | dalle verte du cristal droit, en (521,214) : allumée pendant qu'on glisse une silhouette (`1158:217e` / `1158:21c3`) |
| `[9324]`, `[9326]` | 11006, 11007 | `0x5188000` | 10 | surbrillance des emplacements de la voie gauche / droite pendant qu'on glisse un cristal (`1158:2082` allume si moins de 3 cristaux de ce côté, `1158:2107` éteint) |
| `[9308]` | 11024 / 11028 puis 11015, 11017… | `0x5188000` | 6 | **cristal central géant** (couche arrière) : descente d'entrée (11015), cristal suspendu fixe (11017), puis séquences de résultat (§6.2) |
| `[930a]` | 11025 / 11029… | `0xd180000` | 6 | couche avant de la même séquence (a une région : `0x8000000`) |
| `[930c]`, `[930e]` | 11018, 11019 | `0x5180000`, `0xd180000` | 6 | faisceaux de la machine (balayage avant le résultat) |
| `[9306]` | 11009 | `0x4000000` | 6 | poulie / chaîne en haut (300,30), fixe |
| `[9328]` | 11036 | `0x5180000` | 6 | wagonnet de sortie (en (508,401) au repos) |
| `[932a]` | 11008 | `0x4100000` | 0 | avant-plan de la voie en (509,344) |
| `[9314]` | 11077 | `0x4100000` | 0 | avant-plan de la voie en (571,372) |
| `[932c]` | 11002 | `0x4180000` | 5 | **levier** rouge à gauche, en (19,329) |
| `[9320]` | 11032 (L1-2) / 11033 (L3-4) | `0x4108000` | 6 | wagonnet d'arrivée n° 1 |
| `[9322]` | 11034 (L3-4) | `0x4108000` | 6 | wagonnet d'arrivée n° 2 |
| `{1520:0002}` | 11001 (L1-2 seulement) | `0x108a000`, ancre `DS:1eb8` = (−8,258) | 7 | **zone de dépôt** du Zoombini à gauche (déclarée comme zone de dépôt `1168:166e`) |
| (sans script) | — | `0x1000` | 0 | boutons : dessin `1158:0bcb`, tick `1158:0be9` |

`1158:0000` charge aussi l'archive (`11b8:0fa2("Smoke.MHK")`), le « terrain », les `SCRB` / `SCRS` / `tBMP` ci-dessus, déclare les 20 places d'attente `11a8:0ed9(20, DS:21f0, 1)`, rejoue les Zoombinis du groupe (`1168:0858(0)`), précharge les sons (`11a8:313a(plage)` : 996–997 ; 20000–29999 ; ids de scripts 11008–11009 (**niveau 3 : 11017**), 11001, 11013, 11016, 125–149, 450–474 (ids de voix de Zoombini), 11011–11012, 11014–11015, 11010, 11002–11004, 11007, 11006, 11005, 11000), et enchaîne : `11a8:3065`, `1168:3dd0(0, 0)` (met `+0x127 = 0` à **tous** les Zoombinis actifs, voir §8), `[9502] = 1`.

### 2.3 Zones et tables

| Quoi | Adresse | Valeur |
|---|---|---|
| Régions cliquables (3 entrées de 0x24 octets à `DS:2130`, table `DS:21ac`, rappel `1158:1429`) | `DS:2130` | id 1 « carte » (600,403)-(639,440) ; id 2 « go » (600,441)-(639,478) ; id 3 « saisie » (0,0)-(640,480) |
| Levier | `DS:2018` | (9,300)-(75,364) |
| Cristal droit (zone de dépôt des silhouettes, niveaux 1-2) | `DS:1f38` | (525,211)-(582,300) |
| Zone d'attente des Zoombinis (niveaux 1-2) | `DS:21d4` | (0,31)-(262,244) |
| 5 colonnes d'accrochage | `DS:21e4…21ec` | x = 38, 81, 126, 176, 221 |
| 20 places d'attente | `DS:21f0 + 4k` | (214,128) (175,126) (135,127) (94,126) (53,128) ; (237,176) (196,177) (150,178) (110,176) (69,178) ; (234,36) (195,37) (155,36) (114,35) (73,38) ; (237,79) (196,78) (150,80) (110,78) (69,79) |
| Cases d'insertion de cristaux gauche : `DS:1f88 + 0x18 × n + 8k` (n = cristaux déjà posés, k = case) | `1f88`… | n = 0 : k0 (185,230)-(245,293) ; n = 1 : (137,230)-(197,293), (236,230)-(296,293) ; n = 2 : (124,230)-(184,293), (197,230)-(257,293), (265,230)-(325,293) |
| Cases d'insertion de cristaux droit : `DS:1fd0 + 0x18 × n + 8k` | `1fd0`… | n = 0 : (426,230)-(486,293) ; n = 1 : (372,230)-(432,293), (474,230)-(534,293) ; n = 2 : (350,230)-(400,293), (419,230)-(469,293), (485,230)-(535,293) |
| Positions des cristaux posés, gauche : `DS:1f40 + 0xc × (n − 1) + 4j` (n = nombre après pose) | `1f40`… | n = 1 : (211,255) ; n = 2 : (187,255) (247,255) ; n = 3 : (164,255) (211,255) (258,255) |
| Positions des cristaux posés, droit : `DS:1f64 + 0xc × (n − 1) + 4j` | `1f64`… | n = 1 : (457,255) ; n = 2 : (424,255) (484,255) ; n = 3 : (409,255) (457,255) (505,255) |
| Positions d'étagère des gemmes | `DS:1ef4 + 4p` | voir §2.1 |
| Trajet du pilier de cible, niveau 4 | `DS:1f28 + 4 × [94ba]` | (124,255) (548,255) (580,258) |

Un cristal glissé est accroché au **centre** de la case atteinte : `(gauche + 0x19, haut + 0x1f)`.

### 2.4 Table de cases `DS:9442` : le modèle de la machine

C'est le cœur du test : **8 cases** de 4 mots (un attribut par mot), `DS:9442 + 8 × case + 2 × attribut` (`case` 0…7, `attribut` 0…3) ; valeur 0 = « pas d'effet ». Effacée par `1158:3050` (au début de chaque tirage). Contenu :

| Case | Contenu |
|---:|---|
| 0 | **le Zoombini testé** (ses 4 attributs, recopié par `1158:288c(0, id)`) |
| 1, 2, 3 | cristaux / filtres de **gauche**, de l'extérieur vers le centre (`1158:2953` les recopie depuis les objets) |
| 7 | **la cible** (silhouette, niveaux 1-2 : `288c(7, id)` ; niveaux 3-4 : objet n° 7, puis n° 8 au niveau 4) |
| 6, 5, 4 | cristaux / filtres de **droite**, de l'extérieur (côté cible) vers le centre |

## 3. Règles

### 3.1 Le test : `1158:31e8` (sûr)

Deux fiches de travail sont les objets `[9422]` (gauche) et `[9424]` (droit) :

```
gauche = attributs de la case 0 ; pour s = 1, 2, 3 : pour chaque attribut a : si case[s][a] ≠ 0, gauche[a] = case[s][a]
droite = attributs de la case 7 ; pour s = 6, 5, 4 : pour chaque attribut a : si case[s][a] ≠ 0, droite[a] = case[s][a]
résultat = 0 si gauche == droite (les 4 octets), 2 sinon
```

- Les cases sont donc appliquées **dans l'ordre de l'extérieur vers le centre** ; la dernière case non nulle d'un attribut l'emporte (un cristal « fixe » un attribut à une valeur : les cristaux qui **ajoutent 1** sont convertis en valeur absolue à la pose, §3.3). Les deux fiches sont affichées dans les objets de type 5 (`+0x124 = 4`).
- `[94b2]` = résultat (0 ou 2) ; `[94b6] = ([94b2] ≠ 0)` : sélectionne la variante « réussite » (0) ou « échec » (1) des scripts du Zoombini (§6.2).
- Il n'y a pas de test préalable : un Zoombini absent (case 0 à zéro) est comparé comme les autres (aux niveaux 3-4 le premier Zoombini arrive avant tout geste possible du joueur : **hypothèse**, voir §9 point 3).

### 3.2 Niveaux 1 et 2 : silhouettes et filtres

**Mise en place (`4956` puis `4a01` type 1, niveau 1-2).** `Enter` tire un membre du groupe au hasard (`10a8:04e8(N − 1, 0)`) dont les 4 attributs deviennent la **référence** `[93b6…93b9]` (octets). Les 8 silhouettes reçoivent chacune 4 attributs aléatoires de 1 à 5 (`04e8(5, 1)`) ; celle d'indice `04e8(7, 0)` copie la référence (chaque octet nul de la référence est tiré au hasard à la place, voir niveau 2).

**Ce que fait le joueur** (`1158:1429` cas 3) :
1. **Glisse un Zoombini du groupe** (n'importe lequel qui n'est pas déjà passé, `+0xe0 ≠ 0`) du terrain d'attente `DS:21d4` vers la **zone de dépôt** de gauche (le wagonnet `SCRB` 11001) : `[9428] = id`, `26d7(0, id)`, `288c(0, id)` (case 0). Reprendre le Zoombini (le cliquer) vide le cristal gauche (`2f70(0)`, `3011(0)`, `[9428] = 0`), le replace sur une place d'attente libre (`1158:1e71`) et désarme le levier.
2. **Glisse une silhouette** vers le cristal droit (`DS:1f38`) : `5e1d` renvoie 4, `[9426] = k + 1`, `26d7(1, id)`, `288c(7, id)`. Une seule silhouette peut y être : une seconde est renvoyée à sa place (`DS:1ed0 + 4k`). Cliquer ailleurs quand `[9426] ≠ 0` reprend la silhouette (désarme le levier, vide la case 7).
3. Quand `[9426] ≠ 0` **et** `[9428] ≠ 0`, le levier est **armé** (`[94c8] = 1`, `1158:1f5f(11003)`).
4. **Clique le levier** (`DS:2018`, `[94ca] = 2`, `[94c8] = 1`) : joue `SCRB` 11002 (fermeture, son 11003 à l'image 0), dont l'image 3 appelle `arg 2` → `1158:3126` → test (§3.1).

**Niveau 1** : cases 1 à 6 toujours nulles ; la machine teste donc **l'égalité des 4 attributs** du Zoombini et de la silhouette. Le Zoombini cible (référence) a toujours une jumelle exacte parmi les 8 silhouettes ; un autre Zoombini du groupe passe aussi s'il se trouve avoir la même fiche qu'une silhouette (hasard, rare).

**Niveau 2** : 4 **filtres** fixes (objets de type 2, **non glissables**), 2 à gauche (cases 1, 2) et 2 à droite (cases 5 puis 4, voir ci-dessous), chacun forçant **1 ou 2 attributs** à une valeur. `1158:4500(i, objet)` (sûr, relu, simulé) :
- état : `A` = liste des 4 indices d'attributs, `B` = liste des valeurs 1 à 5 ; nombre de réglages `n = 04e8(2, 1)` (1 ou 2) ; jusqu'à 4 essais, chacun tirant `ia = 04e8(3, 0)` dans `A` et `ib = 04e8(4, 0)` dans `B` (puis les retire de la liste, que l'essai réussisse ou non). Tableaux persistants : `cur_gauche[4]` (`DS:950e`, remis à 0 si `i = 0`) et `cur_droite[4]` (`DS:9516`, idem).
- **filtres 0 et 1 (gauche, cases 1 et 2)** : le réglage `(attribut = A[ia], valeur = B[ib])` est accepté si `cur_gauche[attribut] ≠ valeur` ; il est écrit dans l'objet (octets `+0xbc + attribut`) et dans la case ; `cur_gauche[attribut] = valeur`. Objet `+0xf1 = 0` (orientation gauche).
- **filtres 2 et 3 (droite, cases 4 et 5)**, `+0xf1 = 2` : un attribut `a = 04e8(3, 0)` est tiré indépendamment ; si `cur_gauche[a] = 0` (la gauche ne le force pas) le filtre force `a` à `référence[a]` ; sinon, avec probabilité 35 % (`04e8(100, 0) > 0x41`) ou au 4e essai quand rien n'est encore posé, le filtre force `a` à `cur_gauche[a]` ; sinon rien. Le filtre d'indice 2 occupe la case **4** (position `DS:1f20` = (424,255)) et celui d'indice 3 la case **5** (`DS:1f24` = (484,255)) ; le test applique 5 puis 4.
- **fin de chaque appel** : pour chaque attribut `a`, si `cur_gauche[a] ≠ 0` alors `référence[a] = cur_gauche[a]` (la référence devient « le Zoombini cible **après** les filtres de gauche »). Au dernier appel (`i = 3`) : les valeurs forcées à droite (cases 5 puis 4, la 4 l'emportant) sont lues ; si `référence[a]` est égale à la valeur forcée à droite, `référence[a] = 0` (la silhouette jumelle sera alors **libre** sur cet attribut).
- **conséquence** : la silhouette jumelle `Y` (copie de la référence, octets nuls tirés dans `04e8(4, 1)` à la remise à zéro, `04e8(5, 1)` à la création) satisfait toujours `gauche(X) = droite(Y)` pour le Zoombini `X` d'origine. Simulation de tout le tirage (écrite pour ce document, 200 000 tirages) : **0 échec**. Mais le test reste une égalité modulo les filtres, donc d'autres couples (Zoombini, silhouette) peuvent aussi passer : tout Zoombini dont les attributs non forcés à gauche coïncident avec la silhouette (et dont les attributs forcés à gauche coïncident avec ce que la silhouette porte, ou est forcée à porter, à droite) passe.
- À l'`Enter`, `4a01(4, 2)` est appelée **avant** la création des silhouettes ; ensuite chaque tirage de levier (`1158:2208` niveau 2) appelle `1158:44ab` (qui relance `4500(0…3)`) **puis** `1158:42c0([94b0])`.

**Remise à zéro (levier, `1158:2208`, niveaux 1-2)** : `2f70(0)`, `2f70(1)` (vide les cristaux), `3094` (vide les fiches `[9422]`, `[9424]`), `3050` (vide la table), niveau 2 : `44ab`, puis `42c0([94b0])` : chaque silhouette `k` reçoit 4 attributs aléatoires **de 1 à 4** (`04e8(4, 1)`, constante vérifiée dans le désassemblage ; à la création elle est 5 : incohérence de l'original, la valeur 5 ne peut plus apparaître que par la référence), `+0xe0 = 1`, retour à sa place ; celle d'indice `04e8(min(8, [94b0]) − 1, 0)` copie la référence (octets nuls tirés au hasard). `[94b0]` = nombre de Zoombinis restant dans la file (`3f88`) ; vaut 0 au premier tirage (`42c0(0)` ne fait alors rien : les silhouettes de `Enter` servent).

**Choix de la référence** (`1158:3f88`, fin de chaque tour, niveaux 1-2) : parmi les entrées non nulles de `[9380 + 2i]` (Zoombinis pas encore testés), `04e8(n − 1, 0)` ; ses 4 attributs → `[93b6…93b9]` ; `[93ba…93bd] = 0`. Renvoie `n` (= `[94b0]`).

### 3.3 Niveaux 3 et 4 : les cristaux

**Objets** : 6 **cristaux** (types 3, numéros 1 à 6) et une cible (n° 7, niveau 4 : une 2e, n° 8). Un cristal porte jusqu'à **2 attributs « fixés »** (octets `+0xbc…+0xbf` ≠ 0, la valeur à imposer) et au plus **1 attribut « incrémenté »** (octet `+0xf5` = rang 1…4 de cet attribut, drapeau `+0xf8`). **Sûr.**

**Pose** (glisser un cristal sur la voie, `1158:1429` cas 3, niveaux 3-4) : la boucle de glisser `5e1d` renvoie la case visée 0…2 (gauche) ou 3…5 (droite) d'après le nombre de cristaux déjà posés (`[942a]` à gauche, `[942c]` à droite, 0…3 ; tableau `DS:94ec` : indices 0…2 gauche, 3…5 droite, de gauche à droite ; ids des cristaux posés, 0 = vide). Si le côté compte déjà 3 cristaux, ou si le lâcher n'est dans aucune case, le cristal **retourne à son étagère**. Sinon il est **inséré** à l'indice visé (les suivants sont décalés vers le centre), les cristaux du côté sont repositionnés (positions de §2.3), `+0x121 = 0` (gauche) ou `2` (droite) (orientation de l'image), puis la chaîne est recalculée. Cliquer sur un cristal posé l'**enlève** de la chaîne avant de le glisser, et la chaîne est recalculée. À chaque dépôt le levier est armé (`[94c8] = 1`, `1f5f(11003)`).

**Chaîne de gauche** (`2953` puis `2ad9`) : indice `p` = 0, 1, 2 ↔ case `p + 1`. `2953` recopie dans la table les octets de chaque cristal posé ; `2ad9`, pour chaque cristal ayant un attribut incrémenté `a` (rang `+0xf5`), calcule `valeur = (dernière valeur non nulle de l'attribut a parmi les cases p, p − 1, …, 1, puis la case 0) + 1`, avec **5 + 1 = 1** ; elle l'écrit dans la case et dans l'octet du cristal (`+0x1e` = valeur affichée, `+0x128 = 0`). **Chaîne de droite** (`2a16` puis `2d23`) : indice `p` = 3, 4, 5 ↔ case `p + 1`, parcouru de 5 à 3 (de l'extérieur vers le centre) avec la case 7 pour point de départ. Les attributs « fixés » ne dépendent pas de la position.

**Affichage animé** (`1158:620c`) : tant qu'un cristal n'est pas posé, son octet incrémenté **tourne** en permanence 1→5 (`+0x128`, toutes les `0x3c` = 60 ticks) ; posé, il clignote entre 0 et sa valeur calculée toutes les `0x1e` = 30 ticks. Le joueur peut donc **lire** l'effet de chaque cristal (**sûr** pour la rotation et le clignotement ; les images exactes sont une **hypothèse**).

**Règle du test** (§3.1) : le Zoombini est « traité » de l'extérieur vers le centre à gauche (cases 0, 1, 2, 3), la cible de même à droite (cases 7, 6, 5, 4) ; il y a succès quand les deux résultats sont identiques sur les 4 attributs.

**Niveau 3** : la cible est l'objet n° 7 `[943e]` (case 7). Chaque Zoombini voit un **nouveau puzzle** (le levier relance `1158:2208` → `1158:236b` : tire une permutation des 6 étagères, `04e8` (1…6), sauf `[950a]` ; régénère tous les cristaux par `4dbf(1…7)` d'après les deux premiers Zoombinis de la file ; replace le Zoombini suivant sur le cristal gauche `[9428] = [9380 + 2 × [94aa]]` ; remet `[942a] = [942c] = 0`).

**Niveau 4** : même mécanique, avec une **seconde cible cachée** (n° 8, `[9440]`) et un état `[94ba]` (3 → 2 → 1) : voir §5.5.

### 3.4 Niveau et « réglages » tirés par niveau (`Enter`)

`[93ac] = min(4, 1168:515d() + 1)` ; la plage `[93aa]` = nombre de Zoombinis du groupe (`1168:365d`, 1 à 16). Voir le tableau §4.

### 3.5 Générateur des cristaux `1158:4dbf(n, objet)` (**probable**)

Appelé une fois par objet n° 1…7/8 (les niveaux 3-4 appellent `4dbf(1)` puis `4dbf(2…)` : seul l'appel `n = 1` **tire** quoi que ce soit ; les suivants recopient dans l'objet n° `n` les valeurs déjà calculées). Entrées : `A = [93b6…93b9]` (Zoombini courant), `B = [93ba…93bd]` (Zoombini suivant, ou 0). Tables (9 lignes × 4 mots) : `R` (`DS:953c`, valeur de l'attribut), `S` (`DS:9584`, version « pour B »), `T` (`DS:95cc`, vaut non nul si l'attribut est **incrémenté**). Écriture finale : octets `+0xbc + a` de l'objet n° `n` = `R[n][a]` (`n = 8` : `S[8][a]` si `B ≠ 0`, sinon 0) ; `+0xf5` = rang 1…4 du dernier `a` tel que `T[n][a] ≠ 0` ; `+0xf8 = 1` si un tel `a` existe.

Les décompilés des phases sont confus (tableaux d'entiers indexés par `attribut + 4 × objet`) ; le **principe** relu :
1. **Cristaux 1 et 2** : 2 attributs au plus chacun ; pour chaque attribut `a` (dans l'ordre), tirage `special = 04e8(4, 0)` (peut valoir 4 : aucun) ; au rang `special`, avec probabilité ≈ 29 % (`04e8(100, 0) > 0x46`) et tant qu'aucun attribut incrémenté n'a été choisi, l'attribut est **incrémenté** (`T = R = valeur courante + 1`, 5 → 1) ; sinon avec probabilité ≈ 59 % (`> 0x28`), ou obligatoirement si c'est le dernier attribut et que rien n'est posé, il est **fixé** à une valeur tirée sans remise parmi 1…5 (`T = 0`). Les valeurs « courantes » `cur_A`, `cur_B` (`DS:9614`, `DS:961c`) suivent l'état du Zoombini après ces deux premiers cristaux (gauche).
2. **Cristaux 3 et 4** (niveaux 3-4) : à partir de cet état (copié en `DS:9624…`), deux cristaux construits **dans le sens inverse** (valeur courante − 1, 1 → 5), de sorte que, appliqués à la **cible**, ils ramènent celle-ci à l'état atteint par la gauche. Probabilité 70 % (`04e8(100, 0) < 0x47`) pour la branche normale.
3. **Cible n° 7** (`DS:9574`, 4 octets) : pour chaque attribut, si le cristal 4 l'incrémente → `R[4][a] − 1` ; s'il le fixe → valeur aléatoire (la cible n'a pas d'importance, elle est écrasée) ; sinon, si le cristal 3 l'incrémente → `R[3][a] − 1` ; s'il le fixe → aléatoire ; sinon la valeur de l'état gauche. Autrement dit **la cible est la pré-image de l'état final de la gauche par les cristaux 3 et 4** : une solution existe donc, par exemple « cristaux 1, 2 à gauche (dans l'ordre), cristaux 3, 4 à droite ». Pour le niveau 4, la cible n° 8 (`DS:957c`) est construite de même à partir de `S` (le Zoombini suivant `B`).
4. **Cristaux 5 et 6** : niveau 3, deux **leurres** à 2 attributs (tirage aléatoire de valeurs distinctes 1…5, parfois marqués incrémentés avec valeur de départ aléatoire) ; niveau 4, ils sont **dérivés des cristaux 3 ou 4 (ou 1, 2)** déjà tirés : même attribut, valeur courante + 1, avec ou sans marque d'incrément, ce qui crée des cristaux « presque identiques » à ceux de la solution.

Les probabilités et branches ci-dessus sont lues, mais les phases 2 et 4 n'ont pas été **simulées** : je ne garantis pas que toute combinaison de cristaux 1 à 6 non prévue par la construction ne produise pas un autre chemin gagnant. Un développeur peut remplacer le générateur par n'importe quel tirage « solution + leurres » respectant ces contraintes ; la **règle** (§3.1, §3.3) est, elle, exacte.

## 4. Les 4 niveaux

Niveau interne `[93ac] = min(4, 1168:515d() + 1)` (`1168:515d()` renvoie 0 à 3, [../screens.md](../screens.md) §1.6). Les niveaux 1-2 d'un côté, 3-4 de l'autre partagent les scripts.

| | Niveau 1 | Niveau 2 | Niveau 3 | Niveau 4 |
|---|---|---|---|---|
| Scripts `[948a..948e..9490]` (réussite/échec, 2 couches) | 11024 11025 11026 11027 | idem | 11028 11029 11030 11031 | idem |
| Zoombini : marche réussite `[9492]` + pieds | 11999 → 12000–12004 | idem | 12009 → 12010–12014 | idem |
| Zoombini : marche échec `[9494]` + pieds | 12004 → 12005–12009 | idem | 12014 → 12015–12019 | idem |
| Wagonnet d'arrivée `[949a]`, `[949c]`, `[949e]` | 11032, –, – | idem | 11033, 11034, 11035 | idem |
| Arrivées `[94a0]`, `[94a2]`, `[94a4]` (`SCRS`) | – | – | 12038, 12039, 12040 | idem |
| `[94a6]`, `[94a8]` (socle de la cible) | 11013, 0 | 11013, 0 | 11013, 0 | 11011, 11012 |
| Objets de puzzle | 8 silhouettes | 8 silhouettes + 4 filtres | 6 cristaux + cible | 6 cristaux + 2 cibles |
| Cristaux de l'écran (type 4) | gauche + droit | gauche + droit | gauche | gauche |
| Choix du Zoombini | libre (glisser) | libre (glisser) | ordre imposé, un par un | ordre imposé, **par paires** |
| Cible | silhouette choisie | silhouette choisie + filtres | n° 7 imposée | n° 7 puis n° 8 (cachée) |
| Levier entre deux Zoombinis | oui (nouvelles silhouettes) | oui (silhouettes + filtres) | oui (nouveau puzzle, `236b`) | une fois par paire |
| Référence aléatoire de `Enter` | membre au hasard | idem | Zoombini n° 0 (A) et n° 1 (B) du groupe | idem |
| `[93e4]`, `[94ba]` | — | — | `[94ba] = 3` fixe | `[94ba]` 3 → 2 → 1 |

Autres paramètres de niveau, tous **sûrs** : musique `tMID` `30030 + niveau` (niveau interne 0…3 : 30030 à 30033) lancée par `11a0:0ee7` à l'`Enter` ; les 4 voix de **perte** (20045…20048) ont une probabilité `(5 − [93ac]) / 5` (80 %, 60 %, 40 %, 20 %) d'être jouées quand le dernier Zoombini vient d'être testé et qu'un a été perdu, ou toujours si `(S+0x42 & 0xfff) ≤ 3`.

Le nombre de Zoombinis N est le nombre de membres vivants du groupe (1 à 16) ; il n'influence que la taille des tableaux de wagonnets (`[9330]`, `[9358]`, 16 emplacements).

## 5. Déroulé et état

### 5.1 `Enter` (`1158:0000`)

1. Variables (§5.6) à zéro ; `[93e4] = 1`, `[94ca] = 2`, `[94ba] = 3`, `[94c4] = [a43a]`, `[a43a] = 0` (coupe la file de sons le temps de la mise en place ; remis en fin d'`Enter`), `[9506] = [21d0]` ; `[94dc + 2i] = i` (`i` 0…7) ; `11c8:6a5c(taille, 0, &tableau)` remet à zéro `[94ec]` (12 octets), la plage `9306…932f` (42 octets : ids des features), `[9330]` (40), `[9358]` (40), `[9380]` (42), `[9430]` (18 octets).
2. Niveau, scripts (§4), chargement de l'archive et des ressources, création des features (§2.2).
3. Lecture du groupe `1168:365d()` → `[93aa] = N`. Parcours des features Zoombini (`11a8:120c`) : `[9380 + 2i] = id` (i = 0…N − 1). Niveaux 1-2 : le membre tiré au hasard donne la référence (`[93b6…93b9]`) ; les deux **derniers** membres parcourus reçoivent `+0x121 = 0`, `4231(0, 7)`, `+0xd8 = +0x118 = 0x4f`, `+0xd6 = 0x6e`, `+0x116 = 200` (avant-dernier) ou `+0xd6 = 0x2d`, `+0x116 = 0xa0` (dernier) (fixe leur position / pose de départ ; **rôle précis non élucidé**). Niveaux 3-4 : `+0xe0 = 0` pour tous (cachés), et les deux premiers fournissent `[93b6…93b9]` (A) et `[93ba…93bd]` (B).
4. `1158:4956(niveau)` : création et tirage (§2.1, §3.2, §3.3).
5. Fin : déclaration des régions `1038:0000`, boutons `0aad(0, 0, 1)`, `0aad(0, 0, 2)` ; **intro** : deux features lancent `SCRB` 11015 (descente du cristal, 47 images) et 11016 (46 images) ; musique `30030 + niveau` ; `[a2c4] = 04e8(20067, 20066)` (voix tirée mais **non jouée** dans l'écran : probable usage par l'inactivité) ; `1168:5c57(S+0x42)` ; niveaux 3-4 : `[94c8] = 1`, `1158:1f5f(11003)` (levier armé).
6. `1168:3dd0(0, 0)` : `+0x127 = 0` pour tous les Zoombinis actifs (§8).

À la fin de l'intro (`SCRB` 11015, dernière image, `arg 1` → `[93be] = 1`), le Tick remplace le cristal `[9308]` par `SCRB` 11017 (cristal suspendu fixe en (325,140)).

### 5.2 Interactions (`1158:1429`)

Les clics passent par les 3 régions de §2.3. **Sûr** :
- Si `[8556] ≠ 0` (sortie demandée) : `[8554] = [8556]`, `[8556] = 0`, `11b8:0011(0, 0)`, `1158:0c4c()`. 
- **Région 1 « carte »** : `\0SND` 999 (clic), animation du bouton (`0aad` enfoncé puis relâché), `[9704] = 1`, `[8556] = 1`. Le groupe est alors perdu (dialogue de l'écran de carte, [../screens.md](../screens.md) §3.4).
- **Région 2 « go »** : sans effet si `[9504] = 0` (aucun Zoombini sauvé). Sinon son 0 (arrêt), bouton, `[8556] = 0x12` (écran 18, Maze2), `[94c6] = 1` (départ des wagonnets, §5.3), `[9702] = 1` (bloque les clics), `[9704] = 0`.
- **Région 3 « saisie »** : ignorée si `[9702] > 0` ou `[93aa] ≤ [93e2]` (tout est testé). Sinon, d'après `[94ca]` :
  - `[94ca] = 1` (levier « nouveau tirage » disponible) : si le clic est dans `DS:2018` : `[94ca] = 1158:2208()` (= 2), lever 11004 (`1fa6(1, 11004)`), `11a8:29f6()`.
  - `[94ca] = 0` : rien.
  - sinon (`[94ca] = 2`) : clic dans `DS:2018` avec `[94c8] = 1` (levier armé) : `[94c8] = 0`, `[94ca] = 0`, **joue le levier** 11002 (`1fa6(1, 11002)`), libère la zone de dépôt (`{1520:02f0} = 0`, `1168:1647`, `170f`) ; sinon : niveaux 1-2, glisser d'un Zoombini ou d'une silhouette ; niveaux 3-4, glisser d'un cristal.

**Glisser d'un Zoombini (niveaux 1-2)** : la feature sous le curseur (`11a8:0d61`) doit être active (`+0xe0 ≠ 0`) et ne pas figurer dans `[9358…]` (déjà passés). `1168:1742` lance le glisser ; à la fin : si le Zoombini n'est ni dans une zone de dépôt (`1168:166e() = 0`) ni dans `DS:21d4`, il retourne à son ancienne position `[9506]` ; s'il est dans `DS:21d4`, son x est accroché à la colonne la plus proche parmi `DS:21e4…21ec` ; s'il est déposé sur la zone de gauche (`166e ≠ 0`) et que `[9428] = 0` : `[9428] = id`, `26d7(0, id)`, `288c(0, id)` ; si `[9426] > 0`, le levier est armé.

**Glisser d'une silhouette (niveaux 1-2)** : dans la boucle `5e1d`, le curseur est suivi, la dalle verte `[9304]` allumée (si le cristal est libre) ; relâché dans `DS:1f38` : cas décrit §3.2 ; sinon retour à la place.

**Glisser d'un cristal (niveaux 3-4)** : §3.3. La boucle `5e1d` allume `[9324]` / `[9326]` si le côté a moins de 3 cristaux ; `1158:2107` les éteint au lâcher.

### 5.3 `Tick` (`1158:0cbe`)

Gardé par `[2246]` (pas de ré-entrée) et `[9502] ≠ 0`. Dans l'ordre :
1. `11a8:04b9()` (crochets des features). Si `[8556] ≠ 0` (sortie demandée) : si le son `\0SND` 996 joue (`1028:0d9e`), on **attend** ; si `[a2de]` vaut 0 ou 3 (3 : `1168:3dd0(0, 0)` d'abord) et (`[a406] ≠ 0` ou `[9702] = 0` ou `[9704] > 0`), on **quitte** (`[8554] = [8556]`, `[8556] = 0`, `11b8:0011(0, 0)`, `1158:0c4c()`) ; si `[a2de] = 2` (le joueur a refusé), `[a2de] = 0`, `[8556] = 0` (annule).
2. Si `[a2da] = 0` (pas de dialogue) :
   - **`[93be]`** (fin de l'intro) : `[9308]` joue 11017 (flag 1).
   - **`[94bc]`** (événement 51) : réordonne les couches (`11a8:2a0a([9314], 0, [9328])` et, si `[9428] ≠ 0`, `2a0a([9328], 1, [9428])`).
   - **`[94be]`** (niveau 4, événement 0x13) : `[9310]` joue `[94a6]` (11011) flag 0, `[94c8] = 1`, `[94ca] = 2`, levier armé (`1f5f(11003)`), `[2240] = 1`.
   - **`[94c0]`** (fin du levier « nouveau tirage », `arg 3`) : niveaux 1-2 `[94c8] = 0`, levier au repos (`201c(11002)`) ; niveau 3 `[94c8] = 1`, `[94ca] = 2`, levier armé.
   - **`[94ac]` : fin de tour** (événement 50, le wagonnet est arrivé) :
     1. crée le **wagonnet garé** `[9330 + 2 × [93e2]]` = `SCRB 11071 − [93e2]` (flags `0x4180000`) ;
     2. si `[94b2] = 0` (**succès**) et `[9428] ≠ 0` : `[9358 + 2k] = [9428]` (liste des **passés**), flags du Zoombini `0x4000001`, **`+0x127 = 1`** ; si `[93e6] > 2` (à partir du 4e passé) le Zoombini joue `SCRS 12044 + pieds` (danse) ; `[93e6]++` ; au premier succès (`[93e6] = 1`) : `[9504] = 1` (active « go ») et redessin de `DS:2154` ;
     3. relie les couches (`2a0a`), `[93e2]++` (Zoombinis testés) ;
     4. si `[93e2] = [93aa]` (tous testés) : si `1168:02cc() = N` (aucun perdu) `[94d6] = 1` et voix `04e8(20055, 20063)` ; sinon, si `1168:02cc() < N` et (`04e8(4, 0) > [93ac] − 1` ou `(S+0x42 & 0xfff) < 4`) voix `04e8(20045, 20048)` ;
     5. `[9428] = 0` ; niveaux 1-2 : le wagonnet d'arrivée `[9320]` est vidé (`+0x30 = 0`) et rejoue 11032 ; niveaux 3-4 : `[94aa]++`, le wagonnet d'arrivée `[94b8]` joue `[949e]` (11035) ;
     6. niveaux 1-2 `[9426] = 0` ; **prochain tirage** si niveau < 4 ou (niveau 4 et `[94ba] = 1`) : `[94b0] = 414b()` (niveaux 3-4 : Zoombinis d'indice `[94aa]` et `[94aa] + 1` → `[93b6…]` et `[93ba…]`, renvoie 0, 1 ou 2) ou `3f88()` ; si `[94b0] ≠ 0`, `[93e2] ≤ [93aa]` et niveau < 4 : `[94ca] = 1`, levier « nouveau tirage » clignotant (`1f5f(11005)`) ; sinon `[94ca] = 0`, levier fixe (`201c(11004)`).
   - **`[94c6]`** (clic « go ») : pour `i` = 0, 1, 2 : le wagonnet garé `[9330 + 2i]` joue `SCRB 11072 + i` (flag 1, rappel 37a4) ; le premier fixe un identifiant de synchro `[950c]` (`1f5c`), les autres le reprennent ; le Zoombini passé `[9358 + 2i]` joue `SCRS 12041 + i` (`3f76`). Ces `SCRB` finissent par `arg 60` → `[9702] = 0`, `[9704] = 1`, ce qui autorise la sortie (§1 du Tick).
   - **danse de victoire** (`[94d6] ≠ 0`, `[94d4] < N − 1`) : toutes les 30 ticks, un passé tiré sans répétition (`1098:0098`) joue `SCRS 12044 + pieds` (12045…12049) ; compteurs `[94d0]`, `[94cc]`, `[94d4]` remis à zéro en fin.
   - `1108:035b()`.

### 5.4 Rappel d'événements `1158:37a4` (table `CS:3e05`)

`arg` = `b − 1` ; la feature qui appelle est le deuxième paramètre (`+0xde` = identifiant de synchronisation). **Sûr** pour les corps, **probable** pour les rôles.

| arg | Cible | Effet |
|---:|---|---|
| 0 | `1158:37d2` | si la feature est un snoid (`+0x20 = 1`) : bascule `+0x122` (0 ↔ 1) (ordre de dessin devant / derrière le rail) |
| 1 | `1158:382e` | `[93be] = 1` (fin de l'intro) |
| 2 | `1158:3837` | `1158:3126()` : **lancer le test** (levier) |
| 3 | `1158:383e` | niveaux 1-3 : `[94c0] = 1` (fin du levier « nouveau tirage ») |
| 4 | `1158:3857` | `1158:34b0()` : **séquence de résultat** (§5.3 / §6.2) |
| 10, 11, 13, 14 | `1158:385e` | si `[9428] ≠ 0` : le Zoombini lance son `SCRS` de marche : `3744(1, 37a4, +0xde, [9492 + 2 × [94b6]] + pieds, [9428])` |
| 16 | `1158:38bd` | **bond des fiches** : `[9422]` et `[9424]` prennent la position `DS:2038 / 2070 + 4 × [94fc]` (réussite, `[94b6] = 0`) ou `DS:20a8 / 20ec + 4 × [94fc]` (échec) ; `[94fc]++` (§6.2) |
| 17 | `1158:3995` | si `[9428] ≠ 0` : le retire de la file `[9380]` (sauf niveau 4) ; si `[94b2] ≠ 0` (échec) `[9428] = 0` ; puis `1158:3622` : départ du wagonnet (§6.2) |
| 30 | `1158:39e6` | arrivée du Zoombini A : `[9380 + 2 × [94aa]]` devient `[9428]` (`+0xe0 = 0`), joue `SCRS [94a0]` (12038) |
| 31 | `1158:3a8c` | le wagonnet d'arrivée n° 2 `[9322]` rejoue `[949c]` (11034) |
| 35 | `1158:3ae0` | arrivée du Zoombini B : `[9380 + 2 × ([94aa] + 1)]` joue `SCRS [94a2]` (12039) |
| 36 | `1158:3b78` | première fois (`[93e4]`) : `26d7(0, [9428])`, `288c(0, [9428])` (case 0 ← Zoombini) ; `[93e4] = 0` |
| 37 | `1158:3b9c` | prochain Zoombini : `[9428] = [9380 + 2 × [94aa]]`, joue `SCRS [94a4]` (12040), cache le wagonnet `[9322]` ou `[9320]` (selon `[94b8]`) |
| 38 | `1158:3ce9` | niveau 4 seulement : voir §5.5 |
| 50 | `1158:3ddb` | `[94ac] = 1` : **fin de tour** |
| 51 | `1158:3de3` | `[94bc] = 1` |
| 60 | `1158:3deb` | `[9702] = 0`, `[9704] = 1` : départ terminé, sortie autorisée |
| 251 | `1158:3804` | si snoid : `1168:4dc9(1, snoid)` (pose de marche 1) |

`1158:3e59` (rappel de `[9310]` au niveau 4, `arg` = 17, 18, 19 ; **sûr**) : 17 → `[94ba]−−`, `+0xd6 = DS:1f28[[94ba]]` pour l'objet n° 8 `[9440]` (mode 4, `+0x121 = 4`) ; 18 → `[9440]` masqué (`+0x30 = 0`), `[94ba]−−`, déplacé (mode 5), **`288c(7, [9440])`** (la case 7 prend ses attributs), `2953`, `2ad9`, `2a16`, `2d23`, **`3126`** (test), `[2240] = 0` ; 19 → `1158:236b()` (nouveau tirage) et `[94be] = 1`.

### 5.5 Niveau 4 : paires et cible cachée (**probable**)

Au niveau 4, un puzzle sert **deux Zoombinis consécutifs** (A puis B) : `[94ba] = 3` au début d'un puzzle.
1. A est testé contre la cible n° 7 visible, avec la disposition que le joueur a composée (cases `[94ec…]`). À la fin de ce tour `[94ba]` vaut encore 3 : la condition du Tick (§5.3, 6) échoue, le levier de nouveau tirage **n'est pas** proposé.
2. B arrive (événements 35–38) ; à l'événement 38 (`3ce9`, `[94ba] = 3`) : B devient le Zoombini de gauche (`26d7(0, [9428])`, `288c(0, [9428])`, `2953`, `2ad9`, `3094`), la cible n° 7 est cachée (`+0x30 = 0`) et le socle `[9310]` joue 11011. Ses événements 17, 18 (`3e59`) font passer `[94ba]` à 2 puis 1, **chargent la cible n° 8 dans la case 7** et **lancent le test automatiquement** (`3126`) : B est testé **sans que le joueur n'agisse**, avec la **même disposition de cristaux** que pour A.
3. Fin du tour de B : `[94ba] = 1`, le Tick calcule les deux Zoombinis suivants (`414b`, mais le levier reste « fixe », `[94ca] = 0`, car la condition `niveau < 4` du Tick échoue) ; à l'arrivée suivante, l'événement 38 (`3ce9`, `[94ba] = 1`, `[94b0] ≠ 0`, `[93e2] ≤ [93aa]`) pose `[94ca] = 1` et arme le levier (`1f5f(11003)`). Le levier (`2208` cas 4) remet `[94ba] = 3`, cache les deux cibles, joue 11012 ; son `arg 19` régénère (`236b`) ; `[94be]` replace le socle (11011, flag 0) et réarme le levier.

Le générateur (§3.5) construit la cible n° 8 à partir des tables `S` (version « pour B ») : la disposition gagnante pour A l'est aussi pour B. Si N est impair, le dernier tour n'a pas de B (`[93ba…] = 0`). **Probable** : je n'ai pas simulé l'enchaînement complet ; l'enchaînement exact de `3b9c` / `3ce9` avec le choix du wagonnet `[94b8]` est à confirmer (§9).

### 5.6 Variables de l'écran (noms inventés)

| `DS:` | Nom | Rôle |
|---|---|---|
| `93aa` | `N` | nombre de Zoombinis du groupe |
| `93ac` | `niveau` | 1 à 4 |
| `93b6…93b9` | `réfA` | attributs du Zoombini courant (octets) |
| `93ba…93bd` | `réfB` | attributs du Zoombini suivant (octets) |
| `93d6` | `nSilhouettes` | compteur de type 1 ; `[93e8 + 2k]` ids |
| `93d8` | `nGemmes` | compteur de type 3, part de 1 ; `[9430 + 2k]` ids (k = 1…8) |
| `93da` | `nFiltres` | compteur de type 2 ; `[9410 + 2i]` ids |
| `93dc`, `93de` | | compteurs types 4 et 5 ; `[941c]`, `[941e]` (cristaux), `[9422]`, `[9424]` (fiches) |
| `93e2` | `testés` | nombre de Zoombinis déjà testés |
| `93e4` | `premiereArrivee` | 1 jusqu'à la première pose de la case 0 (événement 36) |
| `93e6` | `sauvés` | nombre de Zoombinis passés |
| `93be` | `introFinie` | drapeau d'événement 1 |
| `9426` | `silhouetteIndex + 1` | silhouette posée sur le cristal droit (0 = aucune) |
| `9428` | `courant` | id du Zoombini posé sur le cristal / le wagonnet gauche |
| `942a`, `942c` | `nGauche`, `nDroite` | nombre de cristaux posés (0…3) |
| `94aa` | `rang` | rang du prochain Zoombini (niveaux 3-4) |
| `94ac`, `94bc`, `94be`, `94c0`, `94c6` | événements | drapeaux posés par `37a4`, consommés par le Tick |
| `94b0` | `restants` | nombre de Zoombinis encore à tester (`3f88`, `414b`) |
| `94b2`, `94b6` | `résultat`, `échec` | 0 / 2 ; 0 / 1 |
| `94b8` | `chariot` | 0 ou 1 : alternance des wagonnets d'arrivée |
| `94ba` | `étatCible` | 3 → 1 (niveau 4) |
| `94c8` | `levierArmé` | 1 si la jonction (Zoombini + cible, ou n'importe quel état au niveau 3-4) est prête |
| `94ca` | `modeLevier` | 0 inactif, 1 « nouveau tirage » disponible, 2 « test » disponible |
| `94d0…94d6` | danse | état de la danse de victoire |
| `94dc + 2i` | `permutation` | permutation 0…7 des étagères de gemmes |
| `94ec + 2i` | `chaîne` | ids des cristaux posés (0…2 gauche, 3…5 droite) |
| `9502` | `chargé` | 1 entre `Enter` et `Exit` |
| `9504` | `goActif` | 1 après le premier Zoombini sauvé |
| `9702`, `9704` | | clic « go » en cours ; sortie immédiate autorisée |
| `9330 + 2k`, `9358 + 2k`, `9380 + 2k` | | wagonnets garés, Zoombinis passés, file d'attente (ids) |
| `9442…` | `cases` | table de cases (§2.4) |
| `950a` | | mis à 1 par la touche `0x172` : empêche le mélange des étagères (mise au point) |
| `94b4`, `947a` | | jamais modifiés dans le code lu (0) |

### 5.7 Touches (`1158:2504`, table `CS:26af`)

Actives seulement si `[a43f] ≠ 0` (mode de mise au point) ou pour `0x16f` : `0x20` et `0x4c` affichent un message de mise au point (`"01234"` indexé par `[93ac]`, `"Level x "`), `0x16f` appelle d'abord `11a0:155e`, `0x172` / `0x173` mettent `[950a]` à 1 / 0. Aucun rôle en jeu normal ; ni `Echap` ni raccourci d'épreuve. **Sûr** pour le code, **hypothèse** pour la correspondance des codes de touches.

### 5.8 `Exit` (`1158:0c4c`)

Si `[9502] ≠ 0` : `[9502] = 0` ; `11b8:00e8(1)` ; `11a8:021c(…)` (libère les features et **déclenche `1168:36e1`**, le bilan de l'épreuve, §8) ; `1028:0e53` (arrête les sons) ; ferme les ressources `DS:21cc`, `DS:93b2`, `DS:93c6`, `DS:93ca` (boutons, planche 10000, deux `REGS`), l'archive (`11b8:1076(&[94fe])`) ; `11a8:3065` ; `1198:014f`.

## 6. Animations et sons

### 6.1 Scripts de décor et d'interface (`SCRB`, tous sûrs pour les chiffres)

| `SCRB` | Images | Position de départ | Sons / événements | Rôle (probable) |
|---:|---:|---|---|---|
| 11000 | 7 | (19,329) | `arg 2` à l'image 6 | variante de levier (**non référencée** par `Enter`) |
| 11001 | 4 | (25,285) | | wagonnet gauche = zone de dépôt (niveaux 1-2) |
| 11002 | 4 | (19,329) | son 11003 (image 0) ; `arg 2` (image 3) | **levier : test** ; repos = image 0 |
| 11003 | 6 | (19,329) | | levier armé (clignote) |
| 11004 | 6 | (19,329) | sons 11017 (0), 11004 (3) ; `arg 3` (image 5) | levier : **nouveau tirage** |
| 11005 | 6 | (19,329) | son 11005 (0) | levier « nouveau tirage » disponible |
| 11006, 11007 | 8, 8 | — | son 11000 (0) | surbrillance des cases gauche / droite |
| 11008 | 2 | (509,344) | | avant-plan voie |
| 11009 | 1 | (300,30) | | chaîne / poulie (fixe) |
| 11010 | 1 | (586,292) | | élément fixe (**non référencé**, seul `313a` le précharge) |
| 11011 | 3 | (515,267) | son 11008 (0) ; `arg 17` (1), `arg 18` (2) | socle de cible, **niveau 4** ; la cible monte de (516,208) à (516,212) |
| 11012 | 4 | (516,212) | son 11009 (0) ; `arg 19` (3) | socle, rabaissé (niveau 4) |
| 11013, 11014 | 1 | (515,267) | | socle fixe, niveaux 1-3 (11014 non référencé) |
| 11015 | 47 | (301,66) | sons 11006 (0), 11007 (10) ; `arg 1` (46) | **intro** : descente du cristal géant |
| 11016 | 46 | — | | intro, décor mobile (couche avant) |
| 11017 | 1 | (325,140) | | cristal suspendu fixe |
| 11018 | 32 | (118,220) | son 11010 (0) | balayage de la machine (1) |
| 11019 | 22 | (94,229) | `arg 4` (21) | balayage (2) ; **sa fin lance la séquence de résultat** |
| 11020–11023 | 37, 43, 43, 38 | — | | variantes de balayage (**non référencées** par `Enter` ; usage non trouvé) |
| 11024 / 11025 | 35 / 31 | (22,275) / — | sons 11011 (image 4), 11013 (19) ; `arg 10` (3), `arg 16` (10–15, 23, 24), `arg 17` (22) | **réussite niveaux 1-2** (arrière / avant) |
| 11026 / 11027 | 36 / 29 | (23,276) / (88,267) | sons 11014 (5), 11016 (20) ; `arg 11` (4), `arg 16` (9–16), `arg 17` (23) | **échec niveaux 1-2** |
| 11028 / 11029 | 35 / 31 | (38,276) / — | sons 11012 (8), 11013 (19) ; `arg 13` (7), `arg 16` (10–15, 23, 24), `arg 17` (22) | **réussite niveaux 3-4** |
| 11030 / 11031 | 36 / 31 | (38,276) / (88,267) | sons 11015 (9), 11016 (20) ; `arg 14` (7), `arg 16` (9–16, 26), `arg 17` (23) | **échec niveaux 3-4** |
| 11032 | 9 | (−34,273) | `arg 20` (8) : **aucun cas** dans la table | wagonnet d'arrivée (niveaux 1-2) |
| 11033 | 14 | (−31,274) | `arg 30` (1), `arg 31` (2), `arg 32` (13) : 30 → `39e6`, 31 → `3a8c`, 32 → aucun cas | arrivée A (niveaux 3-4) |
| 11034 | 12 | (−72,274) | `arg 35` (6), `arg 36` (11) | arrivée B |
| 11035 | 11 | (−3,276) | `arg 37` (2), `arg 38` (10) | arrivée suivante (fin de tour) |
| 11036–11053 | 34, 32, 30, 28, 26, 24, 22, 20, 18, 17, 16, 14, 12, 10, 8, 6, 3, 2 | (508,401) | `arg 51` (image 17, 11036–11039 seulement), `arg 50` (dernière image) avec son 11001 | **wagonnet qui roule jusqu'à sa place `k`** (`11036 + k`) ; fin = `[94ac]` |
| 11054–11071 | 1 | (487,397) → (224,395) puis (210,416) (234,428) … (540,432) | | wagonnets **garés** (`11071 − k`, `k` = 0…17) ; k = 0 en (540,432) |
| 11072–11075 | 3, 5, 7, 9 | (540,432), (503,435), (465,439), (426,441) | son 11002 (11072, image 0) ; `arg 60` (dernière image) | départ des 3 premiers wagonnets au clic « go » (11072 + i) |
| 11076 | 5 | (521,214) | | dalle verte du cristal droit (niveaux 1-2) |
| 11077 | 2 | (571,372) | | avant-plan voie |

Les `arg` de la table sont `b − 1` ; la colonne « sons / événements » donne entre parenthèses l'index d'image (0 = première).

### 6.2 Séquence d'un test (réussite ou échec), pour le reproduire

1. **Levier** : `SCRB` 11002 (4 images, 5 ticks), son 11003 à l'image 0. À l'image 3, `arg 2` → test `3126` (les 4 octets de chaque fiche sont comparés ; fiches affichées dans `[9422]`, `[9424]`) ; `[930c]` joue 11018 (son 11010), `[930e]` joue 11019, synchronisées (`1f5c`).
2. **Fin du balayage** : 11019, image 21, `arg 4` → `1158:34b0` : `[94fc] = 0` ; niveaux 1-2 le wagonnet d'arrivée `[9320]` rejoue `[949a]` (11032) ; niveaux 3-4 `[94b8]` bascule et le wagonnet correspondant joue `[949c]` (11034) ; `[9308]` joue `[948a + 2 × [94b2]]` (11024, 11026, 11028 ou 11030) et `[930a]` joue `[948c + 2 × [94b2]]` (11025, 11027, 11029 ou 11031), flags et rappel 37a4, sons préchargés (`3533`).
3. **Zoombini** : à l'`arg 10`, `11`, `13` ou `14` (image 3, 4, 7 ou 7 de 11024, 11026, 11028, 11030), `1158:385e` lance son `SCRS` : réussite `[9492] + pieds` ; échec `[9494] + pieds`. **`SCRS` 12000–12004** (réussite niveaux 1-2, 18 images, délai 6, de (42,262) jusqu'à (529,334) : plate-forme gauche → descente → voie → sortie droite) ; **12005–12009** (échec niveaux 1-2, 20 images : le Zoombini rejoint (314,294) puis tombe en (326,396), événements `arg 251` (image 12 : pose de marche 1), `arg 0` (image 18)) ; **12010–12014** (réussite niveaux 3-4, 14 images, départ en (59,260)) ; **12015–12019** (échec, 17 images). Sons dépendant du Zoombini : terminateur `0xffcf` (réussite, images 13 ou 9) ; `0xffd7` (échec, images 14 ou 11) ([../engine.md](../engine.md) §3.7).
4. **Fiches** : événements `arg 16` (huit fois dans 11024 / 11028, images 10–15, 23, 24 ; huit fois dans 11026, images 9–16 ; neuf fois dans 11030, images 9–16 et 26) : `[9422]` et `[9424]` prennent les positions de `DS:2038 / DS:2070` (réussite : y = 263, 248, 236, 210, 201, 192, 201, 210 ; x = 317 et 354) ou de `DS:20a8 / DS:20ec` (échec : y = 257, 261, 264, 267, 270, 274, 277, 280, x idem). Les tables comptent respectivement 13 et 17 entrées (reliquat ; la fin de la table n'est pas atteinte).
5. **`arg 17` (image 22 / 23)** : `1158:3995` (retire le Zoombini de la file ; en cas d'échec `[9428] = 0`) puis **`1158:3622(+0xde)`** : `[9328]` joue `SCRB 11036 + [93e2]` (flag 1, rappel 37a4), `+0x122 = 1` pour le Zoombini, qui joue `SCRS 12020 + [93e2]` à partir de (530,384) ; sur un échec `[9428] = 0` et le wagonnet roule **à vide**.
6. **Trajet** : `SCRS 12020 + k` (34, 32, 30, …, 2 images selon `k`) : (530,384) → vers la gauche sur la voie du haut jusqu'à (227,404), puis sur la voie du bas jusqu'à la place `k` ; `arg 0` à l'image 15 (bascule `+0x122`). `SCRB 11036 + k` : même trajet pour le wagonnet ; image 17 : `arg 51` (`[94bc]`) ; **dernière image : `arg 50` + son 11001 → `[94ac]` : fin de tour**.

### 6.3 Sons

| Id | Où | Rôle (probable) |
|---:|---|---|
| `\0SND` 11000 | 11006, 11007 | surbrillance des cases |
| 11001 | 11036–11053 (dernière image) | wagonnet arrivé à sa place |
| 11002 | 11072 | départ d'un wagonnet (« go ») |
| 11003 | 11002 (image 0) | levier : test |
| 11004, 11005 | 11004 (image 3), 11005 | levier : nouveau tirage |
| 11006, 11007 | 11015 | intro : le cristal descend |
| 11008, 11009 | 11011, 11012 | socle de cible |
| 11010 | 11018 | balayage |
| 11011, 11013 | 11024 | réussite niveaux 1-2 (cristal) |
| 11012, 11013 | 11028 | réussite niveaux 3-4 |
| 11014, 11016 | 11026 | échec niveaux 1-2 |
| 11015, 11016 | 11030 | échec niveaux 3-4 |
| 11017 | 11004 (image 0) | levier tiré |
| 996, 997 | préchargés ; 996 testé à la sortie | sortie (clic carte) |
| 999 | clic bouton carte | |
| 20045–20048 | fin de série avec perte | voix |
| 20055–20063 | tout le groupe passé | voix ; célébration |
| 20066–20067 | `[a2c4]` à l'`Enter` | tirées, non jouées ici |
| `tMID` 30030 + niveau interne | `Enter` | musique |

Les voix `20000–29999` et les sons dépendant du Zoombini sont dans `ZOOMBINI.MHK` ([../engine.md](../engine.md) §6).

## 7. Réussite, échec, perte

- **Un Zoombini réussit** si `[94b2] = 0` à l'instant du test (`1158:31e8`, §3.1). Il est alors enregistré dans `[9358 + 2 × [93e6]]`, ses drapeaux passent à `0x4000001`, **`+0x127 = 1`**, et son wagonnet est garé.
- **Il échoue** si `[94b2] = 2` : `+0x127` reste à 0 (valeur posée par `1168:3dd0(0, 0)` à l'`Enter`), il est **piégé** : son `SCRS` d'échec s'arrête en (326,396), au fond de la voie ; le cristal géant tombe sur lui pendant 11026 / 11030 (**hypothèse**, d'après les sprites) ; il sera perdu.
- **Nombre d'erreurs** : aucune limite ; un Zoombini ne peut échouer qu'une fois, car il n'est plus sélectionnable (niveaux 1-2 : il est dans `[9358…]` ou son wagonnet est parti ; niveaux 3-4 : le suivant arrive).
- **Fin de série** : quand `[93e2] = N`, les clics de saisie sont ignorés ; voix de fin (§5.3) ; le joueur doit cliquer « go » (s'il en a sauvé au moins un) ou « carte ». Pas de bouton de rejeu : le seul moyen de rejouer est de quitter et de revenir.
- **Sortie anticipée** : « go » avec des Zoombinis non testés les perd (ils n'ont pas `+0x127 = 1`) ; « carte » perd tout le groupe (dialogue, [../screens.md](../screens.md) §3.4).

## 8. Tampon de partie à la sortie

Le jeu ne stocke rien d'autre que ce que `1168:36e1` écrit ([../screens.md](../screens.md) §3.4, §6.3), appelé par `Exit` via `11a8:021c` :
- **par Zoombini** : `+0x127` (0 = perdu, 1 = sauvé) ; `36e1` remet à 0 tout Zoombini dont `+0xe0 = 0`, puis copie les 4 attributs dans la liste du groupe (`S − 0x56cc`, 19 octets par membre) avec l'indicateur « sauvé / perdu ». **Les Zoombinis perdus retournent au dernier arrêt de l'étape 4 : le camp 2** (réserve `S − 0x5938`, `S + 0x4C += perdus`).
- **Marque de réussite** : si l'étape courante est connue (`1108:02f9 ≠ 0`), l'octet `S + 0x56 + (17 − 7) = S + 0x60` reçoit le bit `1 << niveau` (`niveau` = `S + 0xc2 + 2 × (étape − 1)` avec l'étape 4, valeur 0 à 3 ; `1`, `2`, `4`, `8`) ; si **aucun** Zoombini n'est perdu (et seulement dans les conditions du chapitre 3.4 : `S + 0x54 ≠ 0`, mode normal) le bit `0x10 << niveau` est aussi posé.
- **Progression** : Smoke n'est pas la dernière épreuve de l'étape (c'est Maze2), donc ni monument ni montée de niveau ici.
- Rien d'autre n'est écrit : pas de score, pas de nombre d'erreurs, pas d'enregistrement de la disposition de cristaux. `1168:5c57(S + 0x42)` est appelée à l'`Enter` (mémoire de dialogue) et son usage ici se limite au test des voix de perte (§5.3).

## 9. Points ouverts

1. **Générateur `1158:4dbf`** (niveaux 3-4) : phases 2 et 4 (cristaux 3 à 6) et branche `else` de la phase 1 relues dans un décompilé confus ; les probabilités sont fiables, le détail des index (`R`, `S`, `T`) est une **lecture probable**. À simuler pour confirmer qu'un tirage est **toujours soluble** (je l'ai prouvé seulement pour le niveau 2, par simulation). Les 70 octets de tables sont à `DS:953c…9632`.
2. **Niveau 4** : le rôle exact de `[94ba]`, de la cible n° 8 et de l'enchaînement `3b9c` → `3ce9` → `11011` (arguments 17 / 18 de `3e59`) est une **reconstruction** ; en particulier le test **automatique** du second Zoombini et le moment où la cible n° 7 est recachée n'ont pas été observés. À relire : `1158:3b9c`, `1158:3ce9`, `1158:3e59`, `1158:236b`.
3. **Arrivée du premier Zoombini aux niveaux 3-4** : les deux wagonnets d'arrivée se lancent à la création (flags `0x4108000`) ; la chaîne exacte `arg 30 … 36` n'a pas été confirmée image par image (en particulier `arg 32`, `arg 33`, `arg 21`, `arg 25` n'ont **aucun cas** dans la table : événements ignorés).
4. **Images de la planche `tBMP` 10000** : la correspondance image ↔ valeur d'attribut (silhouettes mauves et cristaux) n'est pas établie ; elle dépend de `1140:0000` (module non lu). De même l'ordre des 4 octets d'attribut (cheveux, yeux, nez, pieds) n'est pas prouvé ([../screens.md](../screens.md) §2.1) : la règle (égalité octet par octet) n'en dépend pas, mais les **pieds** (4e octet, `+0xef`) choisissent la variante des `SCRS` (12000 + pieds…) et des danses.
5. **`SCRB` / `SCRS` non référencés par `Enter`** : 11000, 11010, 11014, 11020–11023, `SCRS` 12044 (hors danse), 12050 : usage non trouvé (variantes d'une version antérieure ?).
6. **Positions de départ des deux derniers Zoombinis** (niveaux 1-2, `Enter`, `+0x116 = 200 / 0xa0`) et rôle de `4231(0, 7)` : non élucidés.
7. **Tables de bonds** `DS:2038…20ec` : 13 et 17 entrées, mais 8 seulement sont consommées (événement `arg 16` huit fois) ; le reste est probablement mort.
8. **Danse de victoire** : filtre `[9358]`, `[935a]`, `[935c]` (les trois premiers Zoombinis sauvés, partis avec les wagonnets du « go ») et cas `N < 5` (`1168:521e({14c0:0006})`) non démontés.
9. **Voix `20066 / 20067`** (`[a2c4]`) : tirées à l'`Enter`, jamais jouées dans le code de l'écran.
10. **Correspondance avec la « Mirror Machine »** : hypothèse de mémoire, voir §1.3.
