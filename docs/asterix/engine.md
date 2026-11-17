# ASTERIX.EXE : moteur et règles du jeu (rétro-ingénierie)

Vague C. Ce document est la référence de comportement du portage d'*Astérix : le défi de César* (version CD DOS française, `ASTERIX.EXE` « Version 2.5 », « May 30 1995 »). Il décrit l'enchaînement des écrans, l'horloge, les entrées, le rendu, le son, l'état de partie et toutes les règles du plateau, d'après la décompilation Ghidra et le désassemblage (`archives/asterix/re/`), qui reste la référence quand la décompilation est douteuse. Rien n'a été exécuté. Les formats de fichiers sont dans `formats.md` et l'inventaire dans `files.md` ; ils ne sont pas répétés ici. Le jeu frère est décrit dans `docs/teleportaschtroumpf/engine.md` : quand une fonction a un équivalent dans `SMURF.EXE`, il est cité sous la forme « = SMURF `seg:off` ».

Niveaux de confiance : **sûr** (code lu et cohérent), **probable** (déduction solide mais non exécutée), **hypothèse** (à vérifier). Les adresses de code sont `segment:offset` ; les globales sont données en offset de DGROUP : `DS:xxxx`.

**Limite de ce document** : les quinze mini-jeux (segments `1f01` à `2840`, modules M22 à M36) **ne sont pas encore lus** ; ils relèvent de la vague E. Seuls leur aiguillage, leur annonce et le niveau de difficulté qu'ils consultent sont établis ici.

## 0. Conventions et pièges de lecture

- **DGROUP = segment `2de2`**. Ghidra écrit les globales en adresse linéaire : `uRam000342ad` est `DS:648d` (on retire `0x2de20`). Ce document donne toujours `DS:xxxx`.
- Dans la décompilation, `(char *)s_apostou___d_2de2_2ddf + 3` désigne simplement le segment DS, et une autre chaîne de ce genre un autre segment constant. Ce ne sont pas des textes.
- **Arguments collés** : un `PUSH` de 32 bits apparaît comme un seul argument. `0x800004` vaut les deux mots (4, 0x80) ; `135a:02ac(0x20012)` vaut `(0x12, 2)`. Ghidra perd aussi souvent les arguments des appels lointains (`FUN_xxx()` sans argument alors que des `PUSH` précèdent) : les valeurs données ici viennent du désassemblage.
- **Noms de fonctions mal segmentés** (`FUN_2000_22fa`, `FUN_16cb_7179`) : l'adresse réelle est celle de l'en-tête du fichier décompilé (`20fa:135a`, `1d24:0be9`).
- **Les tables de `switch` sont dans le segment de code** (`CS:[BX]` pour la valeur, `CS:[BX + 2n]` pour la cible) et Ghidra en fait parfois de fausses fonctions. Sont des tables et non du code : `1abf:13cf` (types de case), `20fa:146d` (15 mini-jeux), `20fa:1198` (6 pièges), `20fa:05d9` (4 repos), `20fa:00c0` (9 vignettes), `1d24:150d` (durées), `1d24:1c5e` (marbre de route), `1d24:0e00`, `19e2:0b14` (menu principal), `135a:0248` (dossiers de voix, que Ghidra présente comme `135a:0258`), `1948:0363` (types de blocs MUX). Les `case 0x1be9c` de la décompilation sont des adresses linéaires.
- La décompilation du segment `20fa` est inutilisable autour de ces tables (`000d`, `05d9`, `1198`, `146d`) : les règles des cases ont été relues dans le désassemblage.
- **Unités de temps** : un « tick » est 1/60 s (`DS:6104`) ; « cs » désigne le centième de seconde de l'horloge de jeu (§2). `1a93:0101(n)` et `1a93:013d(n)` attendent des **centièmes**, pas des ticks ; `1831:030a(n)` attend des **ticks**.
- **Positions et cases** : `pos` va de 0 à 53 (champ `+6` du joueur) ; la « case N » du manuel et du plateau imprimé est `pos + 1`.
- **Voix** : `voix(n)` désigne `135a:02ac(n, mode)`, qui joue le fichier numéro `|n| + 1` du dossier courant (§5.3). Les noms `K63TE38` de ce document sont donc déjà les noms de fichiers.
- Langue : `19e2:034d` appelle `17c1:000c('f')`. Le jeu est figé en français (`DS:6163 = 'f'`, `DS:6162 = 0`).

## 1. Démarrage et enchaînement général

### 1.1 `main` (`19e2:030c`, 2054 octets) (sûr)

1. `chdir` vers le dossier de l'exécutable (`19e2:02ae`), langue `f`, recherche du lecteur de CD par MSCDEX (`19e2:02a1`, résultat dans `DS:6549`), EMS exigée (512 Ko au moins), messages de diagnostic.
2. Initialisation `19e2:0114` : `17a8:0151` (vecteur INT 97h, trois blocs EMS de 64 Ko A, B et C dans `DS:037a`, `DS:037c`, `DS:037e`, mode 13h, INT 8, clavier, souris, rappel de tick), manettes, polices `m52d0.pfn` (`DS:19e8`) et `m52d1.pfn` (`DS:19e4`), carte son (`16cb:0c13`), **introduction `15d7:0a80`** (sauf si `DS:19db`, qui vaut 0 dans l'image), préchargements `19e2:0008` (11 bruitages, §5.2, et les planches `m43sa.hy8` dans `DS:6451` et `M02S.HY8` dans `DS:644d`), zone de dessin 0..319 × 0..199, graine du hasard.
3. Test de vitesse : dix recopies plein écran (`2ba7:000a`) ; si elles prennent plus de 25 ticks, `DS:19e1 = 0` (machine lente : le plateau ne défile plus, il change en fondu, §9.2).
4. Boucle du menu principal M07 (§1.3) jusqu'à `DS:64a8 != 0`.
5. Sortie : écran noir, générique `15d7:0369` (§12), puis `1831:0003("")` (nettoyage et `exit`).

### 1.2 Logos et introduction M06 (`15d7:0a80`) (sûr)

1. Trois logos par `15d7:0006(préfixe)` avec `m52a`, `m52b` (en français ; `m52f` dans les autres langues) et `m52c`. Pour chacun : image `<préfixe>0.mcc` avec fondu d'entrée de 16 pas, vidéo `<préfixe>.mux` (options `0x20D08`), image finale `<préfixe>1.mcc` sans changer la palette ; **si la vidéo a été interrompue**, attente de 3 s au plus (clic ou Échap) ; fondu au noir de 8 pas.
2. `M06AAA.MUX` (options `0x22D00`) ; si elle n'est pas interrompue, `M32AB.MUX` (options `0x22D04`, palette de `M06AAA` conservée). Fondu au noir 16. (Langues `e`, `i`, `p` : `M06AA.MUX` seul ; sans objet ici.)
3. `M06AB.MUX` (options `0x22D00`), fondu au noir 16.
4. `M06AC.MUX` (options `0x2C84`, rappel d'image `15d7:093b`) : un personnage animé posé sur six décors `M06DC001.MCG` à `M06DC006.MCG`, choisis par les marqueurs `08` du fichier. Le mécanisme est détaillé au §4.6 parce qu'il est l'exemple type de l'usage des marqueurs.
5. Fondu au noir 16.

Chaque vidéo est interruptible séparément (bouton ou Échap) ; une interruption ne saute que la vidéo en cours, sauf `M32AB` qui est sautée avec `M06AAA`.

### 1.3 Menu principal M07 (dans `main`, reprise en `19e2:04d5`) (sûr)

**Entrée dans le menu** : `DS:6104 = DS:184e = 0` (l'horloge repart de zéro) ; dossier de voix clé 607 (dossier 63) ; palette noire ; fond `M07da000.MCC`, recopié dans le bloc B ; couleurs 122 à 125 de la palette mises à (0x19, 0x19, 0x19) ; fondu d'entrée 16 ; sprites `M07s.HY8` (Idéfix, objet d'animation du séquenceur `1345`, dessiné en (35, 173)). Si la partie précédente a rendu vrai et a dépassé 20 tours (`DS:6487 > 20`), et hors démo : voix `K63TE08`. `DS:6487` est remis à 0. Musique `m07m.voc` en boucle (options `0xA00002`), relancée dès que la voie est libre. `DS:64b2 = DS:64b1 = DS:64b0 = 0`, `DS:64ae = 0`. Le chrono 0 est lancé une seule fois.

**Les cinq choix** (curseur `c`) :

| `c` | Pancarte | Action (table `19e2:0b14`) |
|---|---|---|
| 0 | JOUER | fondu, `DS:64ad = 0`, partie `1abf:2431` (§9) |
| 1 | REJOUER | fondu, `DS:64ad = 1`, partie `1abf:2431` sans les écrans de réglage (§8.3) |
| 2 | REGLE | `15d7:0e8b` : trois vidéos M44 (§12.2) |
| 3 | FIN | confirmation `1d24:0006(0x2b, …)` : voix `K63TE44`, écran oui/non (§9.12) ; le résultat va dans `DS:64a8` |
| 4 | Idéfix (à gauche du poteau) | animation de départ, puis `23d1:09c1(0)` : le jeu d'Idéfix (M34) hors partie |

**Navigation** : haut (bit 1 de `DS:4b69`) : `c - 1` si `c > 0` et `c != 4` ; bas (bit 2) : `c + 1` si `c < 3` ; gauche (bit 4) : `c = 4` (animation 3 d'Idéfix, bruitage `DS:1a00` en boucle) ; droite (bit 8) depuis 4 : `c = 0`. Chaque déplacement joue `DS:19fa`, impose 30 cs d'attente puis recentre le pointeur.

**Surbrillance** : la couleur `122 + c` passe à (0xE6, 0xE6, 0xE6) et les trois autres à (0x19, 0x19, 0x19) : « l'option devient blanche », comme le dit le manuel. Les 128 premières couleurs sont renvoyées au DAC.

**Idéfix** : à chaque image, `rnd() % 200 == 0` lance une animation d'attente (animation 1 depuis l'état 0, ou animation 4 avec l'aboiement `DS:19fe` depuis l'état 3), puis retour à 0 ou 3. Zone restaurée : (0x1C, 0x62), 0x37 × 0x4B. Cadence du menu : `1831:030a(4)`, soit 15 images par seconde (2 ticks pendant l'animation 4).

**Validation** : `1a93:02a5(60)` : clic gauche, **ou 60 secondes après l'entrée dans le menu** (la navigation ne relance pas le chrono). Sur clic : son `DS:19fc` (pour Idéfix : animation 2 et son `DS:19fe`), attente de la fin du son, 25 cs, nettoyage `1a93:000e`.

**Démo** : si les 60 s s'écoulent sans clic, `DS:64b2 = 1` et le choix est pris dans une variable de rotation qui vaut 4 au départ : premier délai, jeu d'Idéfix (4) ; deuxième, REGLE (2) ; troisième, partie de démonstration (0) ; puis de nouveau 4. Les entrées de la démo sont décrites au §3.4.

**Après chaque choix** : fondu `13e5:0021(1)` (32 pas) et retour au menu. Si `DS:64a8 != 0` : sortie du programme (§1.1, étape 5).

### 1.4 Vue d'ensemble d'une partie

`1abf:2431` (§9.1) enchaîne : remise à zéro (`1abf:13e5`), choix des joueurs M08 (`1abf:1532`), réglages M09 (`1abf:1f3e`), puis la boucle des tours (`1abf:0f99` pour chaque joueur), et enfin l'écran de fin (`1abf:0da3`) ou les seules voix d'adieu si la partie a été arrêtée par FIN.

| Écran | Module | Fonction d'entrée |
|---|---|---|
| Logos, introduction | M52, M06 | `15d7:0a80` |
| Menu principal | M07 | `19e2:030c` |
| Choix des joueurs et niveaux | M08 | `1abf:1532` |
| Réglages durée et objets | M09 | `1abf:1f3e` |
| Écran de jeu à 9 cases | M01, M43 | `1d24:0618`, `1d24:1c6e`, `1abf:08e4` |
| Carte générale | M02 | `1d24:0e08` |
| Marbre de route, score | M03 | `1d24:161b`, `1d24:112b` |
| Confirmation oui/non | M49 | `1d24:0006` |
| Pause | M48 | `1abf:07f4` |
| Cases | M13 à M21, M37 à M41, M51 | `20fa:*`, `288f:000f`, `25f1:042d` (§10) |
| Mini-jeux | M22 à M36 | `20fa:135a` (§10.11) |
| Commentaires de Panoramix | M42 | `1d24:112b` |
| Victoire, défaite | M11, M12, M42 | `1abf:0da3` |
| Règle du jeu | M44 | `15d7:0e8b` |
| Générique | M47 | `15d7:0369` |

## 2. Horloge et cadence

### 2.1 PIT, ticks, centièmes (sûr)

- `2af4:002d` (= SMURF `3559:0031`) programme le canal 0 du PIT avec le diviseur `DS:38dc`, qui vaut **19886 (0x4DAE)** dans l'image : 1 193 182 / 19 886 = **60,0 Hz**. Pendant une vidéo, `2904:034e` y met le diviseur de l'en-tête du MUX ; `1948:070c` remet 0x4DAE à la fin.
- L'INT 8 est détournée (`2af4:0072` et suivants, = SMURF `3559:0076`) avec six emplacements de rappels : le tick de jeu `17a8:000b`, le pointeur au clavier `1902:03b3`, la souris `1902:0434`, le curseur de bibliothèque `18a1`, et `1948:04b0` pendant une vidéo.
- `17a8:000b` (= SMURF `16dc:0002`) : `DS:6104 += 1` (compteur de ticks sur 32 bits), décrément de l'anti-répétition du volume `DS:60fc`, puis mise à jour du pointeur (`153c:029d`).
- **Horloge de jeu** `1831:02d1` (= SMURF `1764:0300`) : `(DS:6104 - DS:184e) × 100 / 60`, en **centièmes de seconde**. `DS:184e` est la compensation des vidéos (§2.3). Les deux compteurs sont remis à 0 à chaque entrée dans le menu principal, ce que SMURF ne fait pas.

### 2.2 Primitives de temps (segment `1a93`, = SMURF `1f33`) (sûr)

| Fonction | Sémantique |
|---|---|
| `1831:011c(drapeau)` et `1831:014d(drapeau)` | **pompe**, sans aucune attente : flux sonore (`16cb:0744`), lecture des entrées si `drapeau`, recalibrage de la manette (touche J), volume F1/F2 |
| `1831:02fd()` | repère de cadence : `DS:6250 = DS:6104` |
| `1831:030a(n, rappel)` | attend que `DS:6104 >= DS:6250 + n` (ticks bruts de 1/60 s) en pompant et en appelant `rappel` ; le repère n'est pas remis à jour : période = max(n ticks, durée du travail) |
| `1a93:0101(n)` | attend `n` cs en pompant ; redessine le curseur 9×15 s'il est actif (`DS:0146`) |
| `1a93:013d(n)` | attend `n` cs, sans curseur |
| `1a93:016d(k)` / `1a93:0186(k)` | démarre le chrono `k` (départ en cs dans `DS:6495 + 4k`) / secondes entières écoulées |
| `1a93:01ab(m)` | horloge en cs, masquée par `m` (clignotements) |
| `1a93:01c3(n)` | attend `n` s ou un clic gauche ; sauve et restaure le chrono 0 |
| `1a93:0215(n)` | attend `n` s, un bouton quelconque ou Échap |
| `1a93:026e()` | attend le relâchement des boutons, 500 cs au plus (SMURF attendait les directions) |
| `1a93:02a5(n)` | vrai si clic gauche (`DS:4b6b == 1`) ou si le chrono 0 a atteint `n` s |
| `1a93:000e()` | nettoyage entre deux écrans : police `DS:19e8` en couleur 0x7E, attente du relâchement, restauration du fond (`1481:0448`) |
| `1a93:003a()` | présente : tampon A vers l'écran |
| `1a93:0051()` | l'écran courant devient le fond (A vers B), présentation, retour vertical, envoi de la palette `DS:576e` |

Chronos utilisés : **0** = délai de l'écran courant (relancé par presque chaque écran), **1** = temps de partie (§9.8), **2** = temps de réponse du quiz.

### 2.3 Pendant une vidéo (probable)

`1948:04b0`, rappel d'ISR posé pendant un MUX, incrémente `DS:184e` un appel sur deux. L'ISR tournant alors à `1 193 182 / diviseur` (144 Hz pour 8285, 132 Hz pour 9039), l'horloge de jeu avance à 72 ou 66 unités par seconde au lieu de 60. Le temps de partie compté pendant les vidéos est donc légèrement accéléré dans l'original. Le portage peut compter le temps réel (écart sans effet sur les règles).

### 2.4 Cadences relevées

| Écran | Attente | Cadence |
|---|---|---|
| Menu M07 | `1831:030a(4)` | 15 images/s |
| Dé qui tourne (`1abf:0016`) | 12 ticks par face | 5 faces/s |
| Déplacement du pion (`1abf:00f9`) | 3 images de 10 cs par case | 0,3 s par case |
| Clignotement d'annonce (`1abf:01b4`) | 10 cs par pas | 5 clignotements/s |
| Générique (`15d7:02cf`) | 1 tick par pixel | 60 px/s au plus (§12.1) |
| Vidéos | cadence du fichier | voir `formats.md` |

## 3. Entrées

### 3.1 Chaîne de lecture (sûr)

- **Clavier** (INT 9, `1902:01d8`) : scancode brut dans `DS:4040` (0 au relâchement) ; `153c:036a` range dans `DS:0142` le scancode (+0x48 pour une touche étendue, 0 au relâchement). Table de traduction `1902:0004` (mêmes valeurs que SMURF) :

| Scancode | Touche | Effet |
|---|---|---|
| `48`, `50`, `4B`, `4D` | flèches haut, bas, gauche, droite | bits 1, 2, 4, 8 de `DS:403c` |
| `10`, `1E`, `2C`, `2D` | Q, A, Z, X en position QWERTY (A, Q, W, X sur un clavier AZERTY) | haut, bas, gauche, droite |
| `39` | Espace | bouton 1 (bit 0 de `DS:4046`) |
| `1C` | Entrée | bouton 2 (bit 1 de `DS:4046`) |

  La table d'échange AZERTY (`1902:0140`) n'est jamais activée (`DS:405a` reste à 0).
- **Souris** (`1902:0434`, à chaque tick) : `INT 33h` fonction 3 pour les boutons (quand l'état change, `DS:4046` reçoit 0, 1, 2 ou 3 : affectation et non OU), fonction 0Bh pour les déplacements, ajoutés à `DS:404e` (x) et `DS:4050` (y), bornés à 0..319 × 0..199.
- **Pointeur au clavier** (`1902:03c0`) : seulement en mode « pointeur libre » (`DS:0144 == 1`) : 4 pixels par tick et par direction (`DS:4048 = 2` ; `1fe6:02bd` le met à 1).
- **Position lue** (`153c:029d`, à chaque tick) : **`DS:4b67` = x**, **`DS:4b65` = y**.
- **Manette** (`153c:0085`, `0118`, `0189`, port 201h) : `DS:0145` vaut 0 dans l'image et ne peut être activé que par le menu caché (§3.6). Non portée (décisions D5 et D9).

### 3.2 `153c:01c0` et `153c:0043` (sûr)

`153c:01c0` (= SMURF `14b3:01c9`) :

- `DS:4b6b` (boutons lus) = `DS:4046` ; `DS:4b69` (directions lues) = octet bas de `DS:403c`.
- **`DS:4b6b`** : 1 = bouton gauche ou Espace, 2 = bouton droit ou Entrée, 3 = les deux.
- **`DS:4b69`** : bit **1 = haut, 2 = bas, 4 = gauche, 8 = droite**.
- Tant que le bouton gauche est tenu, la direction « bas » est effacée (`DS:4b69 &= 0xCD`).
- Toute entrée réelle met `DS:64b1 = 1` (démo interrompue).

`153c:0043` (= SMURF `14b3:004c`, seuils différents) ajoute la **navigation par les bords** : `x < 10` donne gauche ; sinon `x > 310` donne droite ; sinon `y < 10` donne haut ; sinon `y > 190` donne bas. Dès qu'une direction est levée, le pointeur est recentré en (160, 100) (`153c:0030`). `153c:0004` attend 3 cs, vide les drapeaux, attend 3 cs et recentre.

Certains écrans ajoutent leurs propres seuils sur la position : menu du tour (y < 20 ou y > 180), écran des niveaux (x < 20, x > 300, y < 20, y > 180).

### 3.3 Conséquence : pas de zones cliquables (sûr)

Aucun écran du socle ne teste la position du clic. Tout se pilote par les quatre directions (clavier, ou souris poussée vers un bord puis recentrée) et le bouton gauche valide l'élément sous le curseur du jeu. Le manuel (édition Macintosh) décrit des clics directs sur les réponses, les objets ou les cases : ce n'est pas le comportement de l'exécutable DOS (§13). Seuls trois mini-jeux affichent une flèche libre : `1fe6:0043` (Coloriages), `207c:000c` (Des détails à la loupe) et `24e3:0406` (Sangliers, Pirates), avec le curseur logiciel 9×15 `153c:05b4` (= SMURF `14b3:055e`, forme en `DS:114c`, couleur 255, point chaud en haut à gauche).

### 3.4 Démo : clic simulé (sûr)

En mode démo (`DS:64b2`), `153c:01c0` compte dans `DS:64ae` les lectures sans entrée réelle ; au-delà de 100, il pose `DS:4b6b = 1` (un clic simulé) et remet le compteur à 0. La branche « direction au hasard » qui suit est morte (`rnd() % 20 == 20`), et le drapeau `DS:64b0` qui l'autorise n'a donc aucun effet. Une vraie entrée met `DS:64b1 = 1` : chaque écran teste ce drapeau et rend la main, jusqu'au menu principal. Un clic simulé n'interrompt ni les voix ni les vidéos.

Le manuel dit qu'un clic interrompt la démo et que « le retour au menu se fait à la fin du jeu en cours » : conforme au dépilage observé.

### 3.5 Touches du moteur (sûr)

| Touche | Effet | Adresse |
|---|---|---|
| Échap (`DS:0142 == 1`) | saute une vidéo lancée avec l'option `0x800`, le générique, les attentes `1a93:0215` ; annule un personnage sur l'écran des niveaux ; coupe le défilement du plateau | `1948:0373`, `1abf:1532`, `1d24:038d` |
| F1 / F2 | volume moins / plus (0..15, `DS:027a`, répétition toutes les 20 ticks) | `1831:00ac` (= SMURF `1764:00f4`) |
| P (`DS:61a8 = 0x19`) ou les deux boutons (`DS:4b6b == 3`) | pause M48, seulement depuis le menu du tour | `1abf:08e4`, `1abf:07f4` |
| J | recalibrage de la manette si elle est active | `1831:011c` |
| O, A, R, I | boîtes d'erreur (sortie, abandon, réessayer, ignorer) | `1831:01b3`, `13ef:0416` |
| Ctrl+Alt+Suppr | absorbé | `1345:0156` |

Le manuel Macintosh annonce le volume sur « - » et « + » : dans l'exécutable DOS ce sont F1 et F2.

### 3.6 Pause M48, menu caché et triche : non portés sauf la pause (décision D9)

**Pause** (`1abf:07f4`, sûr) : image `M48DA000.MCC`, vidéo `M48a.mux` en boucle (options `0x28D08`, rappel `1abf:02fc`) jusqu'à une entrée. En sortie, le temps passé en pause est ajouté à `DS:6499` (départ du chrono 1) : **la pause ne consomme pas de temps de partie**. La pause est à porter.

**Séquence secrète** (`1abf:029a`, sûr) : pendant la pause, chaque nouvelle direction est empilée dans `DS:6900[0..6]`. Si les six dernières sont, dans l'ordre, droite, gauche, haut, bas, droite, gauche, alors `DS:690e = 6` et le rappel arrête la vidéo : on entre dans le menu caché.

**Menu caché** (`1abf:0380`, sûr) : cadre (50, 50)-(220, 120), trois lignes (`1abf:0312`, police `DS:19e8`, texte en (60, 60 + 20 × ligne)) : « CheatMode : ON/OFF » (`DS:19df`), langue (`DS:6163` parmi f, a, g, h, i, e, p), « JOYSTICK : ON/OFF » (`DS:0145`). Gauche ou droite bascule la ligne, un bouton sort. Taper I, K, O, S, C, H, 9, 4 bascule un second drapeau `DS:19e0` (lu par le jeu d'Idéfix).

**Effets de `DS:19df`** (sûr) : bandeau « Version 2.5.f / May 30 1995 » et « Time : %d/%d - Turn : %d » sur le plateau (`1d24:0618`) ; gauche et droite déplacent le pion d'une case dans le menu du tour et sur la carte ; un second passage par le menu du tour après le dé ; édition des objets, gourdes et sesterces sur le marbre de route (sélections 5 à 7) ; écran « DEBUG QUIZZ » avec la touche B (`25f1:042d`, toutes les questions d'un pays, la bonne réponse marquée d'un `*`).

**Décision D9** : le menu caché, la triche, le choix de la langue et la manette **ne sont pas portés**. `DS:19df`, `DS:19e0`, `DS:19d6` valent toujours 0 dans le portage, la langue est `f`. Les branches correspondantes sont signalées dans ce document par « triche » et peuvent être ignorées.

## 4. Rendu

### 4.1 Tampons (sûr)

Mode 13h, 320 × 200, 256 couleurs. Trois blocs EMS de 64 Ko :

| Bloc | Handle | Rôle |
|---|---|---|
| A | `DS:037a` | tampon de travail (« tampon arrière »), visible par le pointeur lointain `DS:402a` |
| B | `DS:037c` | **fond** : copie propre du décor, que l'on restaure avant de redessiner les sprites |
| C | `DS:037e` | sauvegarde (introduction) |

`DS:402e` pointe sur la mémoire vidéo. Le cycle d'une image de jeu est : `1481:0448` (restaurer le fond, B vers A), dessiner les sprites et les textes dans A, `1481:0430` ou `1a93:003a` (présenter, A vers l'écran, sans attendre le retour vertical). `1a93:0051` fait de l'écran courant le nouveau fond.

Autres aides : `1481:045e(src, sx, sy, dst, dx, dy, l, h)` copie un rectangle entre deux tampons ; `1481:06b4` entre deux blocs EMS ; `1481:07c3(n, rectangles)` restaure `n` rectangles du fond ; `1481:0333(x1, y1, x2, y2)` trace un cadre de boîte (couleurs 0x74 à 0x78) ; `2c8b:000c` trace un rectangle vide ; `2c66:0028` un rectangle plein.

### 4.2 Images MCG et MCC (segment `1481`, = SMURF `13fc`) (sûr)

Formats : voir `formats.md`. Chargement : `1481:0089` (MCG), `1481:01ff` (MCC : palette puis paires couleur, longueur, dernière série coupée à 64 000 pixels). Affichage : `1481:0155(nom, drapeaux)` pour un MCG et `1481:027d(nom, drapeaux)` pour un MCC, avec les mêmes drapeaux :

| Drapeau | Effet |
|---|---|
| `1` | fondu d'entrée de 16 pas après le chargement |
| `2` | fondu au noir de 16 pas avant le chargement |
| `4` | ne touche pas à la palette (ni palette noire, ni palette de l'image) |
| `0x200` | recopie l'écran dans le fond B |
| `0x4000` | décale l'image dans les couleurs 128..255 (`1481:0007`, §4.5) |

`1481:0155(nom, 3)`, très fréquent, est donc « fondu au noir, chargement, fondu d'entrée ».

**Couleur 0** : contrairement à SMURF, la palette d'une image est envoyée telle quelle. Seuls les MUX et les MUK forcent l'entrée 0 à noir.

`1abf:0d1c(nom)` (portrait du vainqueur) : charge une image dans le tampon de travail, recopie ses 128 premières couleurs dans les couleurs 128..255, puis copie vers l'écran tout pixel différent de 0x7D en lui ajoutant 0x80. Ici 0x7D est bien une couleur transparente.

### 4.3 Palette et fondus (segment `15b0`, = SMURF `1523`) (sûr)

Tampons de 768 octets : `DS:576e` palette courante (couleur `i` en `DS:576e + 3i`, composantes sur 8 bits, ramenées à 6 bits à l'envoi), `DS:4e6e` travail des fondus, `DS:546e` palette noire, `DS:4b6e` copie de ce que le DAC a reçu.

- `15b0:01f5(n)` : fondu au noir en `n + 1` pas, un par retour vertical, puis **efface l'écran**.
- `15b0:00e6(n)` : fondu d'entrée.
- `15b0:0233(palette, début, nombre)` : envoi au DAC.
- `13e5:000e(k)` et `13e5:0021(k)` : fondus de `(k + 1) × 16` pas. `13e5:0039(d)` : fondu sonore (volume ramené à 1 pas par pas, `d` cs entre deux).

**Couleurs réservées de l'interface** (sûr) :

| Couleurs | Usage |
|---|---|
| 122 à 125 | pancartes du menu M07 ; bulles OUI (122, 123) et NON (124, 125) de M49 ; pancartes JOUER (124) et ANNULER (125) de M08 |
| 123, 124, 125 | sur le plateau : couleurs du pion du joueur courant (table `DS:1d4b`, §9.3) |
| 126, 127 | teinte normale et teinte de surbrillance (curseur flèche, coche) |
| 0x7E, 0x7D, 0x79, 0x7F | textes (ombre, générique, ligne active, ligne inactive) |
| 255 | curseur logiciel 9×15 |

### 4.4 Sprites HY8 et police (sûr)

`2bdb:0477(numéro, x, y, planche)` dessine un sprite ; le format et la règle d'ancrage (x = bord gauche, y = ligne du bas, corrigés par le point de la partie) sont ceux de `docs/teleportaschtroumpf/hy8.md`. Le séquenceur d'animations `1345` est identique à SMURF `12d7`. Textes : `2cd0:001e(x, y, tampon, texte)` avec la police courante, `2cd0:0129(police, couleur)` pour la choisir, `2cd0:0198` pour la largeur ; format PFN dans `docs/teleportaschtroumpf/pfn.md`.

Planche commune **`m43sa.hy8`** (`DS:6451`, 17 sprites, vérifiée) :

| Sprite | Contenu | Ancrage |
|---|---|---|
| 0 | pion (disque 23 × 24, couleurs 123 à 126) | le point demandé est le **centre** du pion |
| 1 à 12 | dé (32 × 25) : face `d` fixe = sprite `2(d - 1) + 1` ; les sprites pairs sont les images « en mouvement » | coin haut gauche |
| 13 | flèche du curseur de jeu (32 × 33, couleurs 126 et 127) | coin haut gauche |
| 14 | croix « objet acquis » | point (-10, +9) |
| 15 | coche du menu (16 × 11) | coin haut gauche |
| 16 | porte de prison (48 × 47) | centrée comme le pion |

Autres planches : `M02S.HY8` (`DS:644d`, six mini-pions 16 × 16 pour la carte, un par personnage), `M43SB00{perso}.hy8` (`DS:642f + 5j`, portrait 64 × 77 du joueur `j`), `m03sb.hy8` (bandeaux 160 × 27 des personnages sur l'écran de score), `M08S.HY8`, `M07s.HY8`, `M39S.HY8`.

### 4.5 Lecteur MUX `1948:04cc` (= SMURF `179a:0673`) (sûr)

`1948:04cc(nom, options, cb_image, cb_bloc)` rend 0 si la vidéo a été jouée jusqu'au bout, 1 si elle a été interrompue ou si le fichier est introuvable (`DS:631e`). Déroulé :

1. **Attend la fin de la voie voix/musique** (boucle sur `16cb:08c9(0, 0x100000)`). Une vidéo ne commence donc jamais sur une voix en cours ; la musique en boucle doit avoir été arrêtée par l'appelant.
2. Résout le chemin (§5.4) ; fichier absent : boîte d'erreur, nouvel essai, puis retour 1.
3. Alloue deux tampons de 0x5000 octets (0xF000 avec `0x2000`) : `DS:6319` (bloc vidéo en attente) et `DS:6315` (travail du décodeur).
4. Lit l'en-tête, programme le PIT avec le diviseur du fichier, lit les blocs. Deux rappels internes : `1948:018e` à chaque bloc et `1948:0373` à chaque pas d'image.
5. Avec `0x8000` : revient au début et recommence tant qu'il n'y a pas d'interruption.
6. Ferme, remet le PIT à 60 Hz.

**Blocs** (`1948:018e`, table `1948:0363`) : `05` fin d'image ; `08` marqueur (§4.6) ; `6F` vidéo ; `70` palette ; tout autre type est ignoré. Les blocs `05` vides de `07/M07A.MUX` sont avalés sans effet visible : les ignorer est conforme (probable).

- **Palette** : ignorée entièrement avec `0x4`. Sinon : efface l'écran la première fois (sauf `0x8`), copie 768 octets dans `DS:576e` (384 seulement avec `0x1000`), met l'entrée 0 à noir, attend le retour vertical et envoie les 256 couleurs.
- **Vidéo** : avec `0x20000`, le bloc est décodé tout de suite dans la cible ; sinon il est mis en attente dans `DS:6319` et décodé au pas d'image. La cible est le tampon arrière avec `0x80`, l'écran avec `0x100`. `cb_bloc` est appelé à chaque bloc vidéo.

**Pas d'image** (`1948:0373`) : pompe et entrées ; pas du décodeur asservi au son (`29ad:0205`) ; chien de garde (50 pas sans nouveau bloc) ; test d'interruption ; décodage de l'image en attente ; puis, avec `0x1000`, recopie A vers l'écran et restauration B vers A ; sans `0x1000`, appel de `cb_image` si une image vient d'être décodée.

**Interruption** : (`0x400` et un bouton quelconque, Espace et Entrée compris) ou (`0x800` et Échap) ou chien de garde, **et** (pas en démo, ou vrai bouton). SMURF ne réagissait qu'au clic gauche.

**Options, bit par bit** :

| Bit | Effet |
|---|---|
| `0x4` | la palette du MUX est ignorée, la palette courante reste |
| `0x8` | ne pas effacer l'écran à la première palette |
| `0x80` | cible = tampon arrière A |
| `0x100` | cible = écran |
| `0x400` | interruption par n'importe quel bouton |
| `0x800` | interruption par Échap |
| `0x1000` | surimpression : palette de 128 couleurs, A vers l'écran puis B vers A à chaque image |
| `0x2000` | tampons de 0xF000 octets |
| `0x4000` | lu seulement par les enveloppes `15d7:06eb` et `15d7:07f7` : décalage de palette |
| `0x8000` | lecture en boucle jusqu'à interruption |
| `0x10000` | redécodage et rappel à chaque pas, même sans nouvelle image |
| `0x20000` | décodage immédiat du bloc à sa lecture (absent de SMURF) |
| `0x40`, `0x200` | jamais lus |

**Enveloppes** (segment `15d7`, = SMURF `154c`) :

| Fonction | Nom du fichier | Options ajoutées |
|---|---|---|
| `15d7:06eb(n, c, cb, options)` | `M{nn}A{'A' + c}.MUX` (dossier `MDF\nn`) ; attend d'abord le relâchement des boutons et d'Échap | sans rappel et sans `0x1000` : `0x2D08` (plein écran, interruptible) ; sinon `0x2C88` (tampon arrière, interruptible) |
| `15d7:07f7(n, c, cb, options)` | idem, sans attente de relâchement | `0x2108` ou `0x2088` : **non interruptible** |
| `15d7:08e9(nom)` | nom donné | `0x22D08` |
| `15d7:0006(préfixe)` | logos (§1.2) | `0x20D08` |

Exemple : `15d7:06eb(0x2a, 3, 0, 0x5000)` joue `M42AD.MUX`.

**Différences avec SMURF** : attente de la fin de la voie avant de commencer ; marqueur `08` converti en entier ; `0x20000` ; `0x4` ignore la palette ; `0x400` accepte tout bouton ; garde du mode démo ; valeur de retour ; horloge compensée (§2.3).

### 4.6 Composition des calques et rôle des marqueurs `08`

**Trois façons de composer** (sûr pour le mécanisme), toutes au-dessus du même décodeur `2b17:0119`, qui n'écrit que les pixels codés (les « sauts » d'une image inter laissent la cible intacte) :

1. **Plein écran** (`0x100`) : décodage direct à l'écran, palette du fichier, pas de fond. Logos, introduction, règle du jeu, annonces M13.
2. **Surimpression** (`0x1000`, presque toujours avec `0x4000`, soit `0x5000`) : c'est le cas de Panoramix et des personnages qui parlent par-dessus un écran du jeu. L'enveloppe décale d'abord l'écran courant dans les couleurs 128..255 (`1481:0007(palette, pixels, +1)` : les 128 premières couleurs sont recopiées dans les 128 suivantes et chaque pixel reçoit +0x80), le présente et en fait le fond B. La vidéo n'apporte que 128 couleurs (0..127). À chaque image : décodage sur A, A vers l'écran, B vers A. À la fin, `1481:0007(…, -1)` remet l'écran dans les couleurs 0..127. **Il n'y a pas de couleur clé** : est transparent tout pixel non codé de l'image. La zone concernée est l'écran entier.
3. **Rappel d'image** (`0x80`, souvent avec `0x4`) : le lecteur décode sur A puis appelle le rappel, qui compose lui-même. Les animations de case jouées dans une vignette du plateau fonctionnent ainsi (§10) : la vidéo est décodée dans un coin du tampon et le rappel recopie un rectangle à l'emplacement de la case (`1481:045e`). Le sens exact de cette copie reste à vérifier (§14).

Le conteneur `.vid` du portage garde le masque des pixels écrits (`formats.md`), ce qui suffit aux trois cas. Le fond « magenta ou noir » visible dans les fichiers n'est pas traité comme une couleur clé par le lecteur.

**Marqueurs `08`** (sûr pour le lecteur) : le lecteur ne fait qu'une chose, **`DS:6425 = atoi(texte du bloc)`**, au moment où le bloc est lu, avant la fin de son image. Le texte est de l'ASCII décimal (« 1 », « 10 », « -1 »). Il n'y a ni boucle, ni attente, ni synchronisation dans le lecteur : ce sont les **rappels des modules** qui lisent `DS:6425`, agissent, puis le remettent à 0 ou à -1. Plusieurs rappels arrêtent eux-mêmes la vidéo (`DS:3755 = 0`, `DS:631e = 1`), et c'est ainsi qu'un marqueur sert de point d'arrêt ou de boucle. Un marqueur peut être écrasé par le suivant si le décodeur rattrape un retard. Les enregistrements MUK de type 0 écrivent la même globale.

| Fichier | Lecteur de `DS:6425` | Sens des valeurs |
|---|---|---|
| `06/M06AC.MUX` | `15d7:093b` | numéro de plan (ci-dessous) : sûr |
| `26/M26AA.MUX` | `1f31:022c` | vague E |
| `27/M27AA` à `AF` | `2840:014c` | vague E |
| `30/M30A.MUX` | `24a1:0219` | vague E |
| `36/M36A.MUX` | `1f84:0388` | vague E |
| `34/M34AA` à `AF` | segment `23d1` | vague E |
| `07/M07A.MUX` | aucun relevé | fichier apparemment inutilisé par le menu (§14) |

**Exemple lu : `M06AC` et `15d7:093b`** (sûr). Avant la vidéo, six décors sont chargés avec leurs palettes P1 à P6 ; les couleurs 133 et 137 de P1 et P2 sont retouchées en (0x63, 0x38, 0x4C) et (0x75, 0x4C, 0xB7) ; `DS:6425 = -1`. À chaque image décodée : si `DS:6425` vaut 1 à 10, charger la palette du plan et retenir le plan (`DS:5ae6`) ; copier le décor du plan courant dans A ; redécoder le bloc en attente par-dessus (le personnage se pose sur le décor) ; si un marqueur vient d'arriver, envoyer la palette ; présenter ; `DS:6425 = -1`.

| Marqueur | Palette | Décor |
|---|---|---|
| 1, 4, 6 | P2 entière | `M06DC002` |
| 2, 5 | P4 entière | `M06DC004` |
| 3 | moitié haute (128..255) de P5 | `M06DC005` |
| 7, 9 | P3 entière | `M06DC003` |
| 8 | P1 entière | `M06DC001` |
| 10 | moitié haute de P6 | `M06DC006` |

### 4.7 MUK (`19b9`) (sûr)

Format dans `formats.md`. `19b9:000c(handle, cb, dessiner)` lit un enregistrement : type 0, deux octets dans `DS:6425` ; type 1, palette (entrée 0 à noir, envoyée aussitôt) ; type 2, bloc vidéo, décodé directement à l'écran sans rappel, ou dans le tampon arrière puis `cb()`. `19b9:019f(nom, cb)` joue un fichier entier **sans aucune temporisation** (la cadence est celle du disque et du rappel), puis attend la fin de la voie sonore ; elle ne sert que pour `m34ag.muk`. Les autres MUK sont lus enregistrement par enregistrement par les mini-jeux (`23d1`, `1f31`) : vague E.

## 5. Son

### 5.1 Voie voix/musique : `16cb:08c9` (= SMURF `15f9:089f`) (sûr)

Une **voie unique** en flux, partagée par les voix, les musiques et les sons longs. `16cb:08c9(pointeur, options)` :

| Bit | Sens |
|---|---|
| `0x100000` | test : rend 1 si un flux est en cours (0 si le son est coupé, `DS:19da == 0`) |
| `0x400000` | arrêt |
| `0x800000` | jouer (arrête d'abord le flux courant) |
| `0x200000` | avec jouer : en boucle |
| `1`, `2`, `4` | source : mémoire, fichier sur disque (chemin résolu, §5.4), EMS (`*pointeur` = handle) |

Combinaisons vues : `0x800002` voix sur disque, `0xA00002` musique en boucle, `0x800004` son préchargé en EMS, `(0, 0x100000)` test, `(0, 0x400000)` arrêt. Une voix **remplace** donc la musique ; chaque écran relance sa musique quand la voie est libre.

Musiques relevées : `m07m.voc` (menu), `m13m.voc` (espion), `m40ma.voc` à `m40md.voc` et `M40MF.VOC` (quiz), `m47m.voc` (générique).

### 5.2 Bruitages : `16cb:0a4f` et les sons préchargés (sûr)

`16cb:0a4f(pointeur, options)` est un **canal de bruitage mélangé** au flux principal, à un seul emplacement : `0x800000` joue (remplace le bruitage en cours ; `0x200000` boucle), `0x400000` arrête, `0x100000` teste, `0x8` retire la boucle. Sources : EMS ou mémoire seulement. Le mélange (`186c:013e`, somme saturée d'échantillons 8 bits) est fait par la pompe du flux principal : dans l'original, **un bruitage ne s'entend que si la voie principale joue**, et il est rejoué à la fréquence du flux. Le portage peut le jouer comme un son indépendant, comme pour SMURF (voir la question ouverte du §14).

Les bruitages de l'interface du plateau sont lancés sur la voie principale par `16cb:08c9(handle, 4, 0x80)`, et coupent donc une voix en cours.

**Onze bruitages préchargés en EMS** (`19e2:0008`), libérés par le générique :

| Handle | Fichier (sur disque `MDF\nn\`, tiret remplacé par `_`) | Usage |
|---|---|---|
| `DS:19ec` | `b01-01b.voc` | déplacement d'un curseur |
| `DS:19ee` | `b13-12a.voc` | validation |
| `DS:19f0` | `m43b0009.voc` | pas du pion (un par case) |
| `DS:19f2` | `m43b0001.voc` | sesterce gagné |
| `DS:19f4` | `m43b0003.voc` | sesterce perdu |
| `DS:19f6` | `m43b0000.voc` | secousse (piège) |
| `DS:19f8` | `b13-11a.voc` | dé qui tourne |
| `DS:19fa` | `b07-01b.voc` | déplacement dans le menu M07 |
| `DS:19fc` | `b07-12a.voc` | validation du menu M07 |
| `DS:19fe` | `m07b0000.voc` | aboiement d'Idéfix |
| `DS:1a00` | `m07b0002.voc` | Idéfix sélectionné (boucle) |

Chargés à la demande : `m13b0000/1/2.voc` (espion), `b40-01b.voc`, `b40-08a.voc`, `b40-01a.voc` (quiz : déplacement, juste, faux), `b41-01a.voc` (achat chez Epidemaïs).

### 5.3 Voix : `135a:02ac` et le système `K NN TE nn` (sûr)

**`135a:02ac(n, mode)`** :

- **`mode == 2` : retour immédiat, rien n'est joué** (test en `135a:02b3`).
- Sinon : construit le nom par `135a:00fb(|n|)`, joue (`16cb:08c9(nom, 0x800002)`), pompe jusqu'à la fin, puis attend 10 cs. **Un clic gauche coupe la voix si `n >= 0`** et hors démo ; **`n < 0` rend la voix non interruptible**. Fichier introuvable : boîte de message avec le chemin.
- `135a:00fb(n)` seule construit le nom sans jouer ; elle sert aux voix lancées sans attente (annonce du joueur, jeu d'ambiance).

**Nom du fichier** : `md{langue}\{NN}\K{NN}TE{nn}.voc`, avec `nn = n + 1` écrit sur deux chiffres au moins (`0%d` sous 10), et repli sur `mdf\…` si le fichier n'existe pas dans la langue. Le dossier `NN` vient de la **clé `DS:6412 + 100 × DS:6410`**, que chaque module pose avant de parler, par la table `135a:0248` (25 clés, 25 cibles) :

| Clé | Dossier | Usage relevé |
|---:|---:|---|
| 0 | 05 | non relevé |
| 1 | 08 | choix des joueurs, réglages |
| 16 | 11 | victoire |
| 28 | 13 | espion (aucune voix relevée) |
| 33 | 20 | prison |
| 54 | 21 | repos, jeux d'ambiance |
| 63 | 22 | mini-jeu M22 |
| 64 | 23 | mini-jeu M23 |
| 100 | 24 | mini-jeu M24 |
| 130 | 25 | mini-jeu M25 |
| 154 | 26 | mini-jeu M26 |
| 166 | 34 | mini-jeu M34 |
| 169 | 35 | mini-jeu M35 |
| 200 | 37 | potion |
| 222 | 38 | Détritus (aucune voix jouée) |
| 234 | 39 | devin |
| 300 | 40 | quiz |
| 339 | 41 | Epidemaïs |
| 400 | 60 | annonces des mini-jeux, accueil du quiz |
| 500 | 61 | annonces du tour |
| 600 | 62 | marbre de route, « tu as tous tes objets » |
| 607 | 63 | Panoramix : menu, score, délais, fin |
| **652** | **46** | abandon |
| **665** | **51** | surprise |
| **700** | **45** | aide au clic droit |

Les trois dernières lignes corrigent le premier relevé (qui donnait 45, 46, 51) : elles ont été relues dans le désassemblage (`135a:01ea` pousse 0x2E, `135a:01f4` pousse 0x33, `135a:01e0` pousse 0x2D) et recoupées par le nombre de fichiers (13 voix dans `MDF/46`, 35 dans `MDF/51`, 24 dans `MDF/45`). Certaines notes de lecture nomment donc à tort `K45TE…` les voix d'abandon et `K51TE…` les voix d'aide ; ce document emploie les noms corrigés.

**L'aide au clic droit est muette** (sûr). Tous les écrans testent le clic droit (`DS:4b6b == 2`), posent la clé 700 et appellent `135a:02ac(n, 2)` : avec `mode == 2`, rien n'est joué. Tous les sites d'appel relevés dans le désassemblage (`1abf:1d53`, `1abf:2315`, `1d24:0129`, `0b0a`, `0e5b`, `14a9`, `1919`, et ceux de `20fa`) poussent le mode 2. Les 24 voix de `MDF/45` (`K45TE14` niveaux, `TE15` réglages, `TE16` carte, `TE17` score, `TE18` marbre, `TE19` oui/non, `TE21` choix d'un joueur, `TE22` devin, `TE24` Epidemaïs) ne sont donc jamais entendues dans cette version. Seuls effets de bord réels du clic droit : le chrono 0 de l'écran est relancé (le délai repart), et la clé de voix est restaurée ou non selon l'écran. Le portage reproduit le comportement muet ; rendre l'aide audible serait un écart à décider à part.

**Voix de délai** : quand un choix chronométré expire, la plupart des écrans jouent `K63TE38` (clé 607) puis gardent la sélection courante : c'est le « Panoramix choisit à sa place » du manuel.

### 5.4 Chemins de fichiers (`13ef:011b`, = SMURF `134d`) (sûr)

- Nom nu (`M21AA.MUX`, `b01-01b.voc`) : gabarit **`md?\??\` + nom**, où `?` est la lettre de langue et `??` les deux caractères `nom[1..2]` (le numéro du module). Essais successifs : langue courante ; puis `f` ; puis en remplaçant le premier `-` par `_`. Ainsi `b01-01b.voc` est lu dans `MDF\01\B01_01B.VOC`.
- Chemin déjà complet (`md?\nn\…`, quatrième caractère `\`) : le premier `?` devient la lettre de langue et le premier `-` devient `_`.
- `13ef:0084` essaie le dossier courant, le chemin relatif, puis `X:\chemin` sur le lecteur de CD.
- Chargement : `13ef:06f3(nom, drapeau)` en mémoire conventionnelle, `13ef:0772(nom, &taille)` en EMS. Erreur de lecture : quatre essais puis boîte Abandon, Réessayer, Ignorer (`13ef:0416`).
- Le dossier d'un fichier est toujours celui de ses deux chiffres : une vidéo `M32AB.MUX` jouée pendant l'introduction vient de `MDF\32`.

### 5.5 Segment `2d7b` : pilote de musique absent (sûr pour « mort »)

`2d7b` est l'interface d'un pilote résident appelé par INT F0h (signature `IFGM`). Son initialisation n'a aucun appelant et son drapeau reste à 0 : `2d7b:011f`, appelée par le quiz et deux mini-jeux, ne fait rien. À ignorer.

## 6. Aléatoire

### 6.1 Générateur `1a93:00cb` (sûr)

`rnd() = (DS:654a++ + ticks + rand() × 10000 / 32768) & 0x7fff`, où `rand()` est celui de Borland (`1000:077f`), `ticks` l'horloge et `DS:654a` un compteur d'appels. Tous les tirages du jeu s'écrivent `rnd() % n` ou `rnd() & masque`.

### 6.2 Graine `1a93:008a` (sûr)

Appelée au démarrage et au début de chaque partie : appelle `rnd()` un nombre de fois égal aux centièmes courants modulo 100, puis `srand(time(0))`.

### 6.3 Conséquences pour le portage

- Le résultat dépend de l'horloge à chaque tirage : **aucune séquence de l'original n'est reproductible**, même à graine égale. Le portage n'a pas à reproduire le générateur bit à bit ; il doit reproduire les **lois** (modulo, masque, rejets) données dans ce document. Un générateur à graine suffit, avec une graine fixée pour les tests.
- Les rejets comptent : « retiré tant que égal au précédent » (Détritus, introduction de l'espion, question du quiz, voix d'annonce) change les probabilités et doit être conservé.
- **Mémoires jamais remises à zéro entre deux parties** (elles vivent tant que le programme tourne) : `DS:7592` (dernier tour de Détritus), `DS:6b56` (dernière introduction de l'espion), `DS:7182` (dernière question par pays et niveau), `DS:2aa6` (variante d'annonce de chaque mini-jeu), `DS:1ff4` (dernière voix d'annonce), `DS:219a` (instant du dernier commentaire de score), `DS:1a02` (aucune vraie partie encore lancée). Le portage les garde pour la durée de la session, pas dans la sauvegarde d'une partie, sauf décision contraire.
- Le dé n'est pas un tirage direct : son résultat dépend de l'instant du clic (§9.6).

## 7. État de partie

### 7.1 Structure du joueur : `DS:64b3 + 25 × j`, 25 octets, 4 joueurs au plus (sûr)

| Décalage | Adresse (j = 0) | Taille | Sens |
|---|---|---|---|
| `+0x00` | `64b3` | mot | personnage : **0 Astérix, 1 Obélix, 2 Bonemine, 3 Agecanonix, 4 Falbala, 5 Goudurix** |
| `+0x02` | `64b5` | mot | niveau **Réflexion** : 0 facile, 1 moyen, 2 difficile |
| `+0x04` | `64b7` | mot | niveau **Action** : 0, 1, 2 |
| `+0x06` | `64b9` | mot | position 0..53 |
| `+0x08` | `64bb` | mot | nombre d'objets acquis (comparé à `DS:1f9f`) |
| `+0x0a` à `+0x12` | `64bd` à `64c5` | 9 octets | drapeaux des objets, un par pays (indice = position du pays / 6) |
| `+0x13` | `64c6` | mot | sesterces, bornés 0..99 |
| `+0x15` | `64c8` | mot | gourdes de potion, 0..5 (des sangliers pour Obélix : seul l'habillage change) |
| `+0x17` | `64ca` | mot | en prison (0 ou 1) |

Il n'y a ni champ « objets requis » par joueur (c'est la globale `DS:1f9f`) ni drapeau d'abandon : un abandon **retire** la structure du tableau (§9.10). Les noms des personnages sont en `DS:1a03 + 120 × langue + 20 × perso` (minuscules sans accent). Le niveau Réflexion est sûr pour le quiz et pour la dotation en gourdes ; l'étiquette des deux niveaux pour chaque mini-jeu est probable (§10.11).

### 7.2 Globales de partie (sûr sauf mention)

| DS: | Rôle |
|---|---|
| `648f` | nombre de joueurs en jeu (1..4 ; diminue à chaque abandon) |
| `648d` | joueur courant (indice dans le tableau) |
| `6487` | numéro du tour de table (1 au départ ; +1 après le dernier joueur) |
| `1f9d` | durée de la partie en **secondes** (1800, 3600, 5400, 7200 ; 7200 dans l'image) |
| `1f9f` | nombre d'objets à rapporter (3, 5, 7, 9 ; 9 dans l'image) |
| `1fa1` | face courante du dé (1..6), conservée d'un tour à l'autre |
| `6491` | dernière valeur lue des secondes écoulées (chrono 1) |
| `6499` | départ du chrono 1 en cs (décalé par la pause) |
| `6493` | rangée affichée en haut de l'écran de jeu (0..17) |
| `2198` | dernière rangée affichée (-1 au départ) |
| `64a5` | indice du vainqueur |
| `64a7` | un joueur vient d'abandonner (remis à 0 à chaque tour) |
| `64a8` | fin demandée (FIN, abandon du dernier joueur) ; au menu principal : quitter le programme |
| `64a9` | victoire d'un joueur |
| `64aa` | partie terminée (victoire ou temps écoulé) |
| `64ab` | dernier tour de table (moins de 60 s restantes au début du tour) |
| `64ac` | vrai avant le premier tour de table |
| `64ad` | partie lancée par REJOUER |
| `1a02` | aucune vraie partie n'a encore été lancée (1 dans l'image, 0 après le premier tour hors démo) |
| `6912` | présentation de début de partie à faire |
| `64b2`, `64b1`, `64ae`, `64b0` | démo, démo interrompue, compteur du clic simulé, drapeau sans effet |
| `6485`, `6479[4]`, `646d[4]`, `6461[4]`, `645f`, `645d` | configuration sauvegardée pour REJOUER : nombre de joueurs, personnages, niveaux Réflexion, niveaux Action, durée, objets |
| `6489`, `648b` | devin : indice du parieur (-1 = aucun pari), nombre parié (0..5) |
| `7592` | dernier tour joué par Détritus (0..3) |
| `6b56` | dernière introduction de l'espion (0..3) |
| `7182` | 27 octets : dernière question tirée par `pays × 3 + niveau` |
| `3459` | la table `7182` a été initialisée |
| `2aa6` | 15 mots : variante d'annonce de chaque mini-jeu |
| `1ff4` | dernière voix d'annonce du tour |
| `219a` | secondes écoulées lors du dernier commentaire de score |
| `6ea8`, `6eaa` | piège en cours : position d'origine, numéro du module de son animation |
| `6412`, `6410` | clé du dossier de voix (§5.3) |
| `6425` | dernier marqueur de vidéo (§4.6) |
| `19e1` | machine rapide : le plateau défile (1 dans l'image) |
| `19e3` | vrai pendant le menu du tour |
| `19df`, `19e0`, `19d6`, `33e2`, `0145` | triche et manette (non portés) |
| `6163`, `6162` | lettre et indice de langue (`f`, 0) |

Tables de données de `DGROUP` utilisées par les règles : `1d81` plateau (§9.2), `1ded` centres du pion, `1ec5` grille de la carte, `1d4b` couleurs des pions, `2144` ordonnées des lignes de score, `219c` positions des objets sur le marbre, `2a3a` directions de l'espion, `2ac5` étal d'Epidemaïs, `2afb` gourdes du devin, `201a` ajustement des objets, `1ff6` emplacements de M08, `33e4` noms des fichiers de quiz. Conformément à D4, le portage les lit dans l'exécutable quand c'est possible ; elles sont recopiées ici pour référence.

## 8. Réglages

### 8.1 Choix des joueurs M08 (`1abf:1532`) (sûr)

Rend 1 (jouer) ou 0 (annulé). Clé de voix 1 (dossier 08). Image `M08DA000.mcc`, sprites `M08S.HY8`, vidéo d'ouverture `M08AA` (`15d7:06eb(8, 0, 0, 0x5000)`). `DS:648f = 0`.

**De 1 à 4 joueurs, six personnages.** Emplacements à l'écran, de gauche à droite (table `DS:1ff6`, triplets x, y, personnage) :

| Emplacement | (x, y) | Personnage |
|---|---|---|
| 0 | (74, 113) | Goudurix (5) |
| 1 | (138, 82) | Obélix (1) |
| 2 | (181, 144) | Bonemine (2) |
| 3 | (231, 99) | Falbala (4) |
| 4 | (257, 150) | Agecanonix (3) |
| 5 | (315, 140) | Astérix (0) |

Curseur `c` : 0..5 un emplacement, 6 la pancarte **JOUER**, 7 la pancarte **ANNULER**. Flèche (sprite 13 de `m43sa.hy8`) en (x - 22, y - 30) ; un personnage déjà pris est recouvert du sprite de son numéro en (x - 32, y - 60). Pancarte active : couleur 127 recopiée dans sa couleur (124 pour JOUER, 125 pour ANNULER), sinon couleur 126.

- Au début et après chaque joueur validé : `c` = emplacement libre d'indice le plus élevé (donc Astérix d'abord), ou 6 si quatre joueurs sont inscrits (**le curseur est alors forcé sur JOUER**).
- Gauche : `c - 1` si `0 < c < 6` (sans sauter les personnages pris) ; depuis 6, va en 7. Droite : `c + 1` si `c < 5` ; depuis 7, va en 6. Bas : d'un emplacement vers 6. Haut depuis 6 ou 7, s'il y a moins de quatre joueurs : emplacement libre le plus à droite. Anti-rebond 25 cs.
- Clic sur un personnage pris : ignoré. Clic sur JOUER sans aucun joueur : voix `K08TE06`. Clic sur ANNULER (ou démo interrompue) : rend 0.
- Après exactement 5 s sans action, avec 1 à 3 joueurs inscrits : voix `K08TE{nb + 1}` (02 à 04).
- Sortie par JOUER : voix `K08TE14` (un joueur) ou `K08TE15` (plusieurs).
- **L'ordre de jeu est l'ordre d'inscription** (le joueur 0 est le premier inscrit).
- Démo : les clics simulés inscrivent Astérix, Agecanonix, Falbala, Bonemine (niveaux moyens), puis JOUER.

**Écran des niveaux** (image `M08DB00{perso}.mcc`), ouvert par un clic sur un personnage libre. Les deux niveaux partent de 1 (moyen).

- Bulle 0, à gauche (x < 20 ou bit 4) : niveau **Réflexion** (`+2`). Bulle 1, à droite (x > 300 ou bit 8) : niveau **Action** (`+4`). L'attribution gauche = Réflexion est probable (ordre du manuel et usage des champs ; à vérifier sur l'image).
- Haut (y < 20 ou bit 1) : niveau - 1, minimum 0 (facile). Bas (y > 180 ou bit 2) : niveau + 1, maximum 2 (difficile). Anti-rebond 45 cs.
- Voix `K08TE05` à 7 s. Validation : clic, ou 30 s. Échap annule ce personnage.
- Validé : voix `K08TE{perso + 7}` (07 à 12), `DS:648f += 1`.

**Gourdes de départ : `3 - niveau Réflexion`**, soit 3 en facile, 2 en moyen, 1 en difficile (posées ici et de nouveau par `1abf:13e5` pour les quatre structures). Le manuel dit « selon le niveau » sans préciser lequel : c'est le niveau Réflexion.

### 8.2 Réglages M09 (`1abf:1f3e`) (sûr)

Clé de voix 1. Image `M09DA000.mcg`. Deux lignes : durée (indice `d` de 0 à 3 pour 30, 60, 90, 120 minutes) et objets (indice `o` de 0 à 3 pour 3, 5, 7, 9).

- À l'ouverture : **`d = 2` (90 minutes)** et `o = DS:201a[(nb - 1) × 4 + d]`.
- Haut et bas changent de ligne. Gauche et droite : sur la ligne durée, `d ± 1` (borné) **et** `o` repris de la table ; sur la ligne objets, `o ± 1` (borné). Un choix manuel des objets tient donc tant qu'on ne retouche pas la durée. Anti-rebond 15 cs puis attente du relâchement.
- Table d'ajustement `DS:201a` (nombre d'objets proposé) :

| Joueurs | 30 min | 60 min | 90 min | 120 min |
|---|---:|---:|---:|---:|
| 1 | 5 | 7 | 9 | 9 |
| 2 | 3 | 5 | 7 | 9 |
| 3 | 3 | 5 | 7 | 9 |
| 4 | 3 | 3 | 5 | 7 |

- Trois cadres (`2c8b:000c`, couleur 0) ; en français : ligne active (15, 8 + 34l)-(118, 35 + 34l) ; durée (121 + 44d, 8)-(166 + 44d, 35) ; objets (121 + 44o, 42)-(166 + 44o, 69). Les tables `DS:1fa6` à `DS:1ff2` donnent la géométrie des autres langues.
- Voix `K08TE13` à 7 s. Validation : clic, ou 60 s (alors voix `K63TE38`).
- Écrit `DS:1f9d = 1800 × (d + 1)` et `DS:1f9f = 3 + 2o`.

### 8.3 Remise à zéro, REJOUER et valeurs par défaut (`1abf:13e5`) (sûr)

Au début de toute partie : graine ; `DS:64ac = 1` ; `64a9 = 64ab = 64aa = 64a8 = 64a7 = 0` ; joueur courant 0 ; `DS:648b = 0` ; `DS:6489 = -1` (aucun pari) ; tour 1 ; `DS:6912 = 1` ; toutes les positions à 0 (case 1, le village) ; 0 sesterce, 0 objet, personne en prison ; `DS:1fa1 = rnd() % 6 + 1` (face de départ du dé).

- **JOUER** : joueurs remis à zéro, puis M08 et M09. Hors démo, la configuration est sauvegardée pour REJOUER après M09.
- **REJOUER après une vraie partie** (`DS:64ad` et `DS:1a02 == 0`) : ni M08 ni M09 ; nombre de joueurs, personnages, deux niveaux, durée et objets repris de la sauvegarde.
- **REJOUER sans partie préalable** (`DS:1a02 != 0`) : **un joueur, Astérix, Réflexion moyen, Action moyen, donc 2 gourdes ; durée 7200 s (120 minutes) et 9 objets**, valeurs statiques de `DS:1f9d` et `DS:1f9f` dans l'image. Le manuel Macintosh annonce 90 minutes : écart (§13).
- Une partie de démonstration ne modifie ni la sauvegarde ni `DS:1a02`.

## 9. Plateau et déroulé d'un tour

### 9.1 Boucle de partie (`1abf:2431`) (sûr)

1. Remise à zéro `1abf:13e5` (§8.3). Hors REJOUER : M08 (annulé : retour au menu) puis M09.
2. Chargement du portrait `M43SB00{perso}.hy8` de chaque joueur (`DS:642f + 5j`).
3. Sauvegarde de la configuration (hors démo et hors REJOUER).
4. `DS:64b0 = 1` ; **le chrono 1 (temps de partie) démarre ici**, après les réglages.
5. Boucle. Pour chaque joueur, dans l'ordre des indices : `DS:64a7 = 0`. **Au début d'un tour de table** (`DS:648d == 0`) : `DS:6491` = secondes écoulées ; si `DS:1f9d - DS:6491 < 60`, alors `DS:64ab = 1` (dernier tour de table) ; écran de score avec commentaire `1d24:112b(1)` au tour 1, `1d24:112b(0)` aux tours suivants **seulement à plusieurs** (§9.11) ; hors démo `DS:1a02 = 0` ; `DS:64ac = 0`. Puis le tour du joueur `1abf:0f99` (§9.4) et un nettoyage. Après le dernier joueur : `DS:648d = 0`, `DS:6487 += 1`, et si `DS:64ab` alors `DS:64aa = 1`.
6. Sortie de la boucle si `DS:64aa` (victoire ou temps), `DS:64a8` (fin demandée) ou démo interrompue.
7. Libération des portraits, puis la fin de partie (§9.9). Rend 1.

### 9.2 Le plateau : 54 cases (`DS:1d81`) (sûr)

54 mots, un type par position : 0 repos, 1 prison, 2 espion Zérozérosix, 3 piège, 4 Tullius Détritus, 5 potion, 6 jeu, 7 pays (quiz), 8 marchand Epidemaïs, 9 devin, 10 surprise. Le parcours est une boucle : après la case 54 vient la case 1. Compte : 9 pays, 15 jeux, 4 prisons, 4 potions, 6 pièges, 4 repos, 4 espions, 3 Détritus, 2 Epidemaïs, 1 devin, 2 surprises, comme l'annonce le manuel.

| Case | `pos` | Type | Rôle |
|---:|---:|---:|---|
| 1 | 0 | 7 | Village : pays Gaule (objet 0) ; arrivée du banquet final |
| 2 | 1 | 6 | Jeu M22, Des poissons pas très frais |
| 3 | 2 | 6 | Jeu M23, Non, tu ne chanteras pas |
| 4 | 3 | 6 | Jeu M24, Des détails à la loupe |
| 5 | 4 | 1 | Prison |
| 6 | 5 | 3 | Piège dans la forêt (vers la case 34) |
| 7 | 6 | 7 | Pays Bretagne (objet 1) |
| 8 | 7 | 6 | Jeu M26, Le brouillard |
| 9 | 8 | 5 | Potion |
| 10 | 9 | 4 | Tullius Détritus |
| 11 | 10 | 6 | Jeu M27, Tempête en mer du Nord |
| 12 | 11 | 8 | Epidemaïs |
| 13 | 12 | 7 | Pays Normands (objet 2) |
| 14 | 13 | 2 | Zérozérosix |
| 15 | 14 | 3 | Coup de bélier (vers les cases 22 à 30) |
| 16 | 15 | 1 | Prison |
| 17 | 16 | 0 | Repos |
| 18 | 17 | 9 | Devin |
| 19 | 18 | 7 | Pays Germanie (objet 3) |
| 20 | 19 | 6 | Jeu M28, Les sangliers |
| 21 | 20 | 10 | Surprise |
| 22 | 21 | 5 | Potion |
| 23 | 22 | 6 | Jeu M36, Le ciel sur la tête |
| 24 | 23 | 3 | Catapulte (vers les cases 7 à 15) |
| 25 | 24 | 7 | Pays Rome (objet 4) |
| 26 | 25 | 0 | Repos |
| 27 | 26 | 6 | Jeu M35, Coloriages |
| 28 | 27 | 3 | Boxeur (vers les cases 13 à 21) |
| 29 | 28 | 2 | Zérozérosix |
| 30 | 29 | 1 | Prison |
| 31 | 30 | 7 | Pays Grèce (objet 5) |
| 32 | 31 | 4 | Tullius Détritus |
| 33 | 32 | 6 | Jeu M30, Les jeux olympiques |
| 34 | 33 | 0 | Repos |
| 35 | 34 | 5 | Potion |
| 36 | 35 | 6 | Jeu M31, Le fakir |
| 37 | 36 | 7 | Pays Mésopotamie et Palestine (objet 6) |
| 38 | 37 | 3 | Puits (vers les cases 46 à 54) |
| 39 | 38 | 8 | Epidemaïs |
| 40 | 39 | 6 | Jeu M25, Anachronismes |
| 41 | 40 | 2 | Zérozérosix |
| 42 | 41 | 6 | Jeu M32, Bagarre avec les Romains |
| 43 | 42 | 7 | Pays Egypte (objet 7) |
| 44 | 43 | 6 | Jeu M33, Les hiéroglyphes de Cléopâtre |
| 45 | 44 | 10 | Surprise |
| 46 | 45 | 0 | Repos |
| 47 | 46 | 6 | Jeu M34, Idéfix dans la pyramide |
| 48 | 47 | 1 | Prison |
| 49 | 48 | 7 | Pays Ibérie (objet 8) |
| 50 | 49 | 4 | Tullius Détritus |
| 51 | 50 | 3 | Taureau (vers les cases 34 à 42) |
| 52 | 51 | 6 | Jeu M29, Pirates à bâbord |
| 53 | 52 | 2 | Zérozérosix |
| 54 | 53 | 5 | Potion |

### 9.3 Écran de jeu à 9 cases (`1d24:0618`, `1d24:038d`, `1d24:1c6e`) (sûr)

**Géométrie.** Zone plateau : x = 0..250, trois bandes de 66 pixels (y = 0, 66, 132), trois cases par bande. Une rangée = `pos / 3` (18 rangées en boucle). `DS:6493` est la rangée de la bande du haut ; l'image `n` montre les rangées `n`, `n + 1`, `n + 2`. À droite, panneau fixe : portrait du joueur en (260, 27), dé en (273, 88), marbre gris (marbre de route) et marbre rose (carte).

**Image de fond** (`DS:69c8`) : `M01DA0{nn}.mcg` avec `nn = DS:6493` sur deux chiffres (noms `M01DA000` à `M01DA017`). **Variante « banquet final »** : si le joueur courant a `objets >= DS:1f9f` et que la rangée 0 est visible (`DS:6493` vaut 0, 16 ou 17), l'image est `M01DA020` (rangée 0 en haut), `M01DA018` (`6493 == 16`) ou `M01DA019` (`6493 == 17`) : le village y occupe les trois cases de sa bande.

**Transition** entre deux rangées (`DS:2198` = rangée précédente) : même rangée, simple rechargement ; rangée + 1 ou + 2 et machine rapide (`DS:19e1`), **défilement** `1d24:038d` de 66 ou 132 pixels par pas de 2 pixels, sur 251 pixels de large seulement (le panneau droit ne bouge pas), coupé par Échap ou un bouton hors démo ; tous les autres cas (dont le bouclage de la rangée 17 à la rangée 0), fondu au noir, chargement, fondu d'entrée.

**Dessin** (`1d24:0618`) : couleurs 123 à 125 du pion (table `DS:1d4b`) ; porte de prison (sprite 16) sur la case du joueur courant s'il est en prison ; portrait ; dé à sa face courante ; bandeau de triche ; palette ; présentation.

**Pion** (`1d24:1c6e`, appelée à chaque image par toutes les boucles du plateau) :

1. Si la position du joueur courant n'est pas visible : rangée affichée - 1 si le pion est juste au-dessus, + 1 s'il est juste en dessous, sinon `DS:6493 = pos / 3` ; puis réaffichage du plateau.
2. Sprite 0 de `m43sa.hy8` en `(X[pos] - 32, Y[pos] + 66 × rang - 40)`, où `rang` (0, 1 ou 2) vient de `1d24:0a02`. **Seul le pion du joueur courant est dessiné** sur l'écran de jeu ; les autres ne se voient que sur la carte.
3. Positions 23 et 37 (cases 24 et 38) : un rectangle de 7 lignes est restauré depuis le décor sous le pion, (218, 66 × rang + 39)-(240, 66 × rang + 45) et (136, 66 × rang + 31)-(159, 66 × rang + 37). **Hypothèse** : le décor repasse devant le bas du pion.
4. Dé : sprite `2 × (DS:1fa1 - 1) + 1` en (273, 88).

`1d24:09b9(pos)` dit si une position est dans les trois rangées affichées (avec bouclage) ; `1d24:0a02(pos)` rend son rang à l'écran ou -1.

**Table `DS:1ded`** : centre du pion (x, y) dans la bande, par position.

```
 0:(54,91)   1:(168,55)  2:(209,59)   3:(81,84)   4:(159,81)  5:(246,83)
 6:(93,90)   7:(174,91)  8:(263,77)   9:(54,64)  10:(164,85) 11:(228,84)
12:(56,65)  13:(175,84) 14:(236,81)  15:(64,81)  16:(134,65) 17:(213,55)
18:(97,55)  19:(186,57) 20:(263,91)  21:(47,83)  22:(179,80) 23:(262,72)
24:(75,55)  25:(166,88) 26:(223,63)  27:(91,66)  28:(130,80) 29:(233,81)
30:(48,55)  31:(132,78) 32:(217,73)  33:(93,62)  34:(182,86) 35:(217,75)
36:(69,60)  37:(180,62) 38:(254,91)  39:(85,80)  40:(194,57) 41:(262,91)
42:(99,68)  43:(186,83) 44:(263,91)  45:(62,86)  46:(176,91) 47:(233,81)
48:(90,90)  49:(166,63) 50:(218,77)  51:(80,88)  52:(148,55) 53:(264,84)
```

**Table `DS:1d4b`** : couleurs 123, 124, 125 du pion (RVB 8 bits) par personnage.

| Perso | 123 | 124 | 125 |
|---|---|---|---|
| 0 Astérix | (235,235,235) | (235,181,16) | (235,214,33) |
| 1 Obélix | (235,235,235) | (16,120,160) | (100,190,210) |
| 2 Bonemine | (235,235,235) | (175,16,175) | (235,90,235) |
| 3 Agecanonix | (190,190,190) | (75,75,75) | (115,115,115) |
| 4 Falbala | (90,198,107) | (33,82,16) | (57,148,16) |
| 5 Goudurix | (235,90,235) | (110,16,110) | (175,16,175) |

### 9.4 Tour d'un joueur (`1abf:0f99`) (sûr)

Ordre exact :

1. `DS:6493 = pos / 3`, plateau, palette. Le pion du joueur est donc toujours sur la bande du haut au début de son tour, comme le dit le manuel.
2. **Annonce** (§9.5).
3. **Prison** : si le joueur est en prison, `20fa:02c1()` (§10.1) ; un résultat non nul termine le tour.
4. `DS:64b0 = 0`, puis **menu du tour** `1abf:08e4()` (§9.6), avec la règle du délai et de la perte du tour.
5. **Dé** `1abf:0016()` (§9.7), **déplacement** `1abf:00f9(face)` (§9.8), **test de victoire** `1abf:0cde()` (§9.9). En cas de victoire, retour immédiat : la case d'arrivée n'est pas jouée.
6. `DS:64b0 = 1`, puis **effet de la case d'arrivée** : aiguillage sur `DS:1d81[pos]` par la table `1abf:13cf`, chaque module étant précédé d'un nettoyage et suivi du test de victoire.

| Type | Module | Suite |
|---:|---|---|
| 0 | repos `20fa:05e9` | fin du tour |
| 1 | prison `20fa:00d2` | fin du tour |
| 2 | Zérozérosix `20fa:0b83` | **la nouvelle case est jouée** |
| 3 | piège `20fa:0f38` | **la nouvelle case est jouée** |
| 4 | Détritus `288f:000f(0)` | fin du tour |
| 5 | potion `20fa:1223` | fin du tour |
| 6 | jeu `20fa:135a` | fin du tour |
| 7 | pays `25f1:042d` | fin du tour |
| 8 | Epidemaïs `20fa:14a9` | fin du tour |
| 9 | devin `20fa:192e` | fin du tour |
| 10 | surprise `20fa:231b` | la nouvelle case est jouée **si la surprise était l'espion** |

**Enchaînements.** Après l'espion (directement ou par la surprise), le plateau est recalé et redessiné, le pion clignote 7 pas de 10 cs, puis la case d'arrivée est jouée. Après un piège, la case d'arrivée est jouée directement (le piège anime lui-même l'arrivée). La boucle s'arrête sur `DS:64a8`, `DS:64a7`, `DS:64a9` ou une démo interrompue. **Rien ne limite la longueur d'une chaîne** (piège, puis espion, puis piège…). Les déplacements causés par Détritus ou par un jeu d'ambiance ne déclenchent aucun effet de case.

### 9.5 Annonce du joueur (`1abf:01b4` et bloc d'annonce de `1abf:0f99`) (sûr)

Une voix d'annonce n'est jouée que s'il y a **plusieurs joueurs** et que le joueur n'est pas « en prison avec au moins une gourde » (auquel cas la question de la prison vient tout de suite). Clé 500 (dossier 61). Tirage de la voix `v`, recommencé tant que `|v - DS:1ff4| < 6`, puis `DS:1ff4 = v` :

- tours de table 1 et 2 : `v = 5 + perso + 6 × (rnd() % 6)` ;
- ensuite : une fois sur huit (`rnd() & 7 == 0`), `v = rnd() % 5` (`K61TE01` à `05`, phrases courtes non nominatives) ; sinon `v = 5 + perso + 6 × (rnd() & 15)` (16 variantes par personnage, `K61TE06` à `K61TE101`).

`1abf:01b4(v)` lance la voix **sans attendre** et fait clignoter le pion (une image sur deux sans le pion) par pas de 10 cs : 8 pas au moins, puis jusqu'à la fin de la voix. Un clic coupe la voix (hors démo). En solo, ou pour un prisonnier qui a une gourde : `1abf:01b4(-1)`, 8 pas de clignotement sans voix, non interruptibles.

Ce bloc ne fait que choisir une phrase : il n'a aucun effet sur l'état du jeu.

### 9.6 Menu du tour et perte du tour (`1abf:08e4`) (sûr)

Curseur `c` (flèche, sprite 13) : 0 le **dé** en (290, 101), 1 le **marbre de route** en (294, 129), 2 la **carte** en (294, 168). Haut : y < 20 ou bit 1 ; bas : y > 180 ou bit 2. Anti-rebond 15 cs. Chrono 0 lancé à l'entrée. `DS:19e3 = 1` pendant l'écran.

- Clic sur 0 : rend 1 (lancer le dé).
- Clic sur 1 : marbre de route `1d24:161b` (§9.10). Clic sur 2 : carte `1d24:0e08` (§9.11). Au retour : `c = 0` et **chrono 0 relancé**.
- Touche P ou les deux boutons : pause (§3.6), puis chrono relancé.
- `DS:64a8` ou `DS:64a7` posé (FIN ou abandon) : rend 1.
- **15 s sans clic gauche** (`1a93:02a5(15)`) : rend 0.

**Règle du délai** (dans `1abf:0f99`) :

| Situation | Premier délai de 15 s | Second délai de 15 s |
|---|---|---|
| Plusieurs joueurs | rappel `K61TE{103 + perso}` (103 à 108), puis le menu est rouvert | voix `K61TE{109 + perso}` (109 à 114) et **le tour est perdu** |
| Solo | rappel `K61TE102` une fois sur trois, puis le menu est rouvert | **le dé part tout seul**, aucun tour perdu |

Consulter le marbre ou la carte relance le délai. Il n'y a pas d'autre perte de tour dans ce menu.

### 9.7 Dé (`1abf:0016`) (sûr)

Six faces, 1 à 6 (`DS:1fa1`). Il n'y a **pas de tirage direct** :

1. `DS:6910 = 0` (clic mémorisé), chrono 0 lancé.
2. À chaque image : bruitage `DS:19f8` relancé ; la face avance d'un cran (`1, 2, …, 6, 1`) ; plateau redessiné ; sprite `2 × face` (image « en mouvement ») en (273, 88) ; attente de **12 ticks** (0,2 s), pendant laquelle le rappel `1abf:0003` mémorise un clic bref dans `DS:6910`.
3. Un compteur vaut -1 au départ. Dès qu'il est négatif et qu'il y a un clic gauche (ou plus de **10 s** écoulées), il prend `3 + (rnd() & 3)`, soit 3 à 6. Il décroît ensuite de 1 par image ; à 0, le dé s'arrête.
4. Fin : arrêt du son, attente du relâchement.

Le résultat est donc « la face au moment du clic, plus 3 à 6 crans ». La face de départ est tirée au début de la partie (`rnd() % 6 + 1`) puis conservée d'un tour à l'autre. Le clic du menu du tour **lance** le dé, un second clic l'**arrête** (avec l'inertie ci-dessus) : c'est bien le « cliquer pour lancer, cliquer pour arrêter » du manuel.

### 9.8 Déplacement (`1abf:00f9`) (sûr)

`n` signé (le dé donne 1 à 6). Pour chaque case : bruitage `DS:19f0`, `pos = (pos ± 1) mod 54`, puis trois images du plateau à 10 cs. Avant le premier pas, trois images d'attente aussi : 0,3 s puis 0,3 s par case. La bande affichée suit le pion (§9.3). Rend le type de la case d'arrivée.

**Aucun effet au passage** : ni le village ni aucune autre case ne compte quand on la traverse. Seule la case d'arrivée est jouée.

### 9.9 Victoire, banquet, temps et fins de partie (sûr)

**Test de victoire** (`1abf:0cde`), appelé après le déplacement et après chaque effet de case : pour `j` de 0 à `nb - 1`, le premier joueur tel que `objets[j] >= DS:1f9f` **et** `pos[j] / 3 == 0` (cases 1, 2 ou 3) gagne : `DS:64a5 = j`, `DS:64a9 = 1`, `DS:64aa = 1`.

- Il faut **s'arrêter** sur l'une des trois cases de la bande du village (le « banquet final » élargi). Dépasser oblige à refaire un tour de plateau.
- Le test porte sur **tous les joueurs**, dans l'ordre des indices, et pas seulement sur le joueur courant : un joueur amené sur les cases 1 à 3 par un autre (Détritus) alors qu'il a tous ses objets gagne aussitôt, et s'ils sont plusieurs dans ce cas, c'est celui de plus petit indice.
- Arriver sur la case 1 sans tous ses objets joue le quiz de la Gaule ; si la bonne réponse donne le dernier objet, le test qui suit la case donne la victoire (cas décrit par le manuel).
- Avec tous ses objets, on gagne dès le test qui suit le déplacement : la case d'arrivée (y compris les jeux des cases 2 et 3) n'est pas jouée.

**Temps.** Le chrono 1 démarre après les réglages et la pause en est déduite. Il n'est testé qu'**au début de chaque tour de table** : s'il reste moins de 60 s (ou si le temps est déjà dépassé), `DS:64ab = 1` et ce tour de table est le dernier ; à sa fin, `DS:64aa = 1` : César gagne. La partie peut donc dépasser la durée choisie de la longueur d'un tour de table. L'écran de score affiche le temps restant en minutes : `max(1, (durée - écoulé) / 60 + 1)`, et 0 quand César a gagné.

**Fins de partie** (`1abf:2431` étape 7, `1abf:0da3`) :

| Cas | Déroulé |
|---|---|
| Victoire d'un joueur (`DS:64a9`) | Clé 16 (dossier 11). Tableau de score `M03DB000.mcg` avec bandeaux et compteurs. Portrait du vainqueur `M11DA00{perso}.mcc` incrusté (`1abf:0d1c`). Voix `K11TE12`, puis `K11TE{perso + 1}` (son nom), puis `K11TE{7 + rnd() % 5}` (07 à 11). Puis clé 607, `K63TE07`, attente de 4 s ou clic. Vidéo `M11AA` (surimpression `0x1000`), fondu, écran noir, image `M11AB.mcc`, vidéo `M11AB` (`0x1004`). |
| Temps écoulé, César gagne | Même tableau de score (temps affiché 0). Vidéos `M42AA` puis `M12AA` (`0x5000`). Voix `K63TE07`, attente de 4 s ou clic. |
| FIN demandée (`DS:64a8`) | Aucun écran. Clé 607 : voix `K63TE06` en solo ; à plusieurs `K63TE05` ou `K63TE06` (`4 + (rnd() & 1)`). |
| Démo interrompue | Rien. |

Au retour au menu principal, si la partie a dépassé 20 tours de table : voix `K63TE08` (§1.3).

### 9.10 Marbre de route (`1d24:161b`, `1d24:151d`) (sûr)

Image `M03DA00{perso}.mcg` (fondu). Clé 600 (dossier 62). Compteurs du joueur courant (`1d24:151d`) : sesterces en (46, 60), gourdes en (99, 54), objets « acquis/requis » en (161, 56) ; une croix (sprite 14) sur chaque objet acquis, en `(PX[k] - 32, PY[k] - 40)` avec la table `DS:219c` :

| k | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| (PX, PY) | (61,136) | (131,149) | (201,140) | (54,171) | (109,184) | (197,180) | (58,218) | (135,215) | (201,224) |

**Remarque d'entrée** : le **dernier** test vrai de cette liste l'emporte, et la voix `K62TE{n + 1}` est jouée :

| n | Condition |
|---:|---|
| 1 | aucun objet et plus de 600 s de jeu (`DS:6491`, dernière valeur lue, non rafraîchie ici) |
| 2 | exactement un objet |
| 0 | il manque exactement un objet |
| 3 | aucune gourde, sauf pour Obélix |
| 4 | au moins 3 sesterces |
| 5 | objets = requis |
| 6 | objets > requis |

**Menu** : cinq boutons à droite, coche (sprite 15) en (295, 40 + 30s). Haut et bas déplacent la sélection `s` (0 à 4), un mouvement par image puis 15 cs. **30 s sans clic** : sortie comme RETOUR.

| s | Bouton | Effet |
|---:|---|---|
| 0 | RETOUR | retour à l'écran de jeu |
| 1 | CARTE | carte générale (§9.11), puis retour direct à l'écran de jeu |
| 2 | SCORE | `1d24:112b(1)` (§9.11), puis retour à l'écran de jeu |
| 3 | ABANDON | clé 652 (dossier 46) : confirmation `K46TE{perso + 1}` sur `M49DA00{perso}` |
| 4 | FIN | à plusieurs : clé 607, confirmation `K63TE44` ; en solo : la même question que l'abandon (`K46TE{perso + 1}`) |

- **ABANDON, non** : le marbre est rechargé, on reste dans le menu (`s = 0`).
- **ABANDON, oui, à plusieurs** : `1d24:0be9` retire le joueur. Si un pari du devin est en cours : il est annulé si le joueur retiré est le parieur, et l'indice du parieur est décrémenté s'il est plus grand. Le portrait est libéré, les structures suivantes sont tassées, `DS:64a7 = 1`, `nb - 1`, `courant - 1` (ou `nb - 1` s'il devient négatif), de sorte que l'incrément de fin de tour tombe sur le joueur qui suivait. **Les autres continuent.**
- **S'il ne reste alors qu'un joueur** : image `M49DA00{perso du joueur restant}`, voix `K46TE{perso + 8}` (08 à 13) puis `K46TE07`, puis question oui/non sans autre voix : oui, le dernier joueur continue seul (`DS:64a8 = 0`) ; non, la partie s'arrête (`DS:64a8 = 1`).
- **ABANDON, oui, en solo** : `DS:64a8 = 1`, fin de partie.
- **FIN, oui** : `DS:64a8 = 1`, la partie s'arrête pour tous (voix d'adieu du §9.9, pas d'écran de fin) ; **non** : retour au menu.

### 9.11 Carte générale et écran de score

**Carte** (`1d24:0e08`, sûr). Image `m02da000.mcg` (fondu) : grille de 11 colonnes sur 9 lignes, cellule de 29 × 21 pixels, origine y = 6 ; le village occupe trois cellules de large. Table `DS:1ec5` (colonne, ligne) par position :

```
 0:(4,4)  1:(6,3)  2:(6,2)  3:(6,1)  4:(6,0)  5:(7,0)  6:(8,0)  7:(9,0)  8:(10,0)
 9:(10,1) 10:(10,2) 11:(9,2) 12:(9,3) 13:(8,3) 14:(8,4) 15:(8,5) 16:(9,5) 17:(10,5)
18:(10,6) 19:(10,7) 20:(10,8) 21:(9,8) 22:(8,8) 23:(7,8) 24:(6,8) 25:(6,7) 26:(6,6)
27:(5,6) 28:(4,6) 29:(4,7) 30:(3,7) 31:(3,8) 32:(2,8) 33:(1,8) 34:(0,8) 35:(0,7)
36:(0,6) 37:(0,5) 38:(1,5) 39:(2,5) 40:(2,4) 41:(2,3) 42:(1,3) 43:(0,3) 44:(0,2)
45:(0,1) 46:(0,0) 47:(1,0) 48:(2,0) 49:(3,0) 50:(4,0) 51:(4,1) 52:(4,2) 53:(4,3)
```

- Cadres (`1d24:0cb0`) : un rectangle de couleur 0x6D autour de chacune des 9 cases affichées à l'écran de jeu : `(col × 29, lig × 21 + 6)` de 29 × 21 ; pour la position 0, 87 × 32.
- Pions (`1d24:0d21`) : un mini-pion par joueur (sprite `perso` de `M02S.HY8`) en `(col × 29 + dx + 15, lig × 21 + dy + 17)`. Plusieurs joueurs sur la même case sont décalés selon leur rang : (-8, -5), (+8, -5), (-8, +5), (+8, +5). Sur la position 0 : dx + 29, dy + 5. Le pion du joueur courant **clignote** (masqué quand `horloge & 0x20` est nul : période de 64 cs).
- Sortie : clic gauche ou **60 s**. Puis `DS:6493 = pos / 3`.

**Écran de score et commentaires de Panoramix** (`1d24:112b(force)`, sûr pour la logique, probable pour le sens des voix). Ce n'est pas un classement : c'est le tableau des joueurs, avec selon le moment un commentaire. Appelée au début de chaque tour de table (`force = 1` au tour 1 ; `force = 0` ensuite et seulement à plusieurs) et par le bouton SCORE (`force = 1`). Clé 607.

Contenu (`1d24:0f93`, `1d24:0ff2`) : fond `M03DB000.mcg` ; temps « restant/durée » en minutes en (70, 74) ; pour chaque joueur, à l'ordonnée `Y[nb][j]` : bandeau du personnage (sprite `perso` de `m03sb.hy8` en (0, Y - 10)), gourdes à x = 172, sesterces à x = 228, objets « acquis/requis » à x = 284.

| Joueurs | Ordonnées `DS:2144 + 12 × nb + 2j` |
|---|---|
| 1 | 140 |
| 2 | 124, 162 |
| 3 | 116, 143, 170 |
| 4 | 106, 131, 156, 181 |

Choix du commentaire (S = voix `K63TE{S + 1}`, M = vidéo `M42A{'A' + M}.MUX` en surimpression `0x5000`), premier cas vrai :

1. **Présentation de début de partie** (`DS:6912`, tour 1, joueur 0), une seule fois :
   - partie normale, ou toute première partie du programme : selon la durée, 30 min M = 1 (`M42AB`), 60 min M = 2 (`M42AC`), 90 min M = 3 (`M42AD`), 120 min M = 4 (`M42AE`) à plusieurs et M = 10 (`M42AK`) en solo ;
   - partie rejouée : en solo S = 12 (`K63TE13`) ; à plusieurs S = 13 + `rnd() % 3` (`K63TE14` à `16`).
2. **Dernier tour de table** (`DS:64ab`, joueur 0) : M = 7 + `rnd() % 3` (`M42AH` à `M42AJ`).
3. Sinon, seulement si **plus de 360 s** se sont écoulées depuis le dernier commentaire (`DS:219a`) :
   - durée > 30 min et 1680 s < temps restant < 1920 s : M = 5 (`M42AF`, « il reste une demi-heure », probable) ;
   - sinon 780 s < restant < 1020 s : M = 6 (`M42AG`, « un quart d'heure », probable) ;
   - sinon, `r = rnd()` :
     - `r` impair ou solo : S = 31 + (`rnd() & 3` si le joueur courant est le joueur 0, sinon `(rnd() & 1) × 2`), soit `K63TE32` à `35` ; après 600 s de jeu, S = 31 et S = 33 sont écartés (pas de commentaire) ;
     - `r` pair à plusieurs : remarque sur le classement. On cherche le meneur L et le dernier D par nombre d'objets (les joueurs ayant déjà leurs objets requis comptent avec les meneurs), en comptant les ex æquo `nL` et `nD`. Puis `r2 = rnd()` : si `r2` est pair et que le dernier est seul (`nD == 1`), S = 25 + perso du dernier (`K63TE26` à `31`) ; sinon, si le meneur est seul (`nL == 1`), S = 16 + perso du meneur (`K63TE17` à `22`) ; sinon, si tous sont à égalité d'objets, de gourdes et de sesterces, S = 23 (`K63TE24`) ; sinon S = 22 + `(rnd() & 1) × 2` (`K63TE23` ou `25`). Cette branche produit donc toujours un commentaire (relu dans la décompilation de `1d24:112b`).

Si `force == 0` et qu'aucun commentaire n'est choisi, **rien n'est affiché**. Sinon : tableau, commentaire, puis attente d'un clic gauche ou d'un délai de **3 s** (tour 1 ou `force == 0`) ou **8 s** (bouton SCORE après le tour 1).

Le détail exact du calcul du meneur et du dernier (ordre des tests dans la boucle) est dans le désassemblage de `1d24:112b` et devra être repris tel quel à l'implémentation.

### 9.12 Confirmation oui/non et désignation d'un joueur

**`1d24:0006(voix, image)`** (sûr) : rend 1 pour OUI, 0 pour NON.

- Si `voix >= 0` : la voix est jouée (clé de l'appelant), puis fondu, image `M49DA00{image}.mcc` (une par personnage), fondu d'entrée. Si `voix < 0` : l'écran est supposé déjà affiché.
- **NON est à gauche (couleurs 124, 125) et sélectionné par défaut ; OUI est à droite (couleurs 122, 123).** La bulle choisie prend la couleur 126, l'autre est grisée en (0xB4, 0xB4, 0xB4). Gauche choisit NON, droite choisit OUI, avec le bruitage `DS:19ec` et 20 cs d'attente.
- Sortie : clic gauche ou **60 s**. Au délai : voix `K63TE38` et **le choix courant est gardé** (donc NON si le joueur n'a rien touché). Bruitage `DS:19ee`.
- Appelants : quitter le jeu, abandon et fin, prison, surprise, rattrapage du quiz.

**`1d24:0a44(voix)`** (sûr) : désignation d'un joueur sur le tableau de score déjà affiché (jeux d'ambiance, Détritus). Sélection initiale **`rnd() % nb`** ; haut et bas la déplacent (15 cs) ; flèche (sprite 13) en (100, `Y[nb][sélection]`) ; sortie au clic gauche ou après **20 s** (alors `K63TE38`, et le joueur sous le curseur est retenu : sans action, c'est le tirage initial). Le joueur courant peut être désigné.

## 10. Cases

Positions des cases : voir §9.2. « Solo » désigne une partie à un seul joueur en jeu (`DS:648f == 1`), y compris après les abandons des autres.

### 10.1 Prison (type 1) (sûr)

**Arrivée** (`20fa:00d2`) : `en prison = 1`, animation `M20AA.MUX` dans la vignette du pion (options `0x20C84`, rappel `20fa:000d`). Ni voix ni tirage. Le tour se termine. On entre aussi en prison par Détritus et par le jeu d'ambiance « perdant ».

**Au début du tour suivant** (`20fa:02c1`, clé 33, dossier 20) ; rend 1 si le tour est perdu :

| Situation | Plusieurs joueurs | Solo |
|---|---|---|
| Aucune gourde | voix `K20TE{7 + rnd() % 3}` (07 à 09), **tour perdu** | sortie gratuite (`M20AM`), le tour continue |
| Au moins une gourde | question oui/non : voix `K20TE{perso + 1}` (01 à 06) si `rnd() & 1`, sinon `K20TE{15 + rnd() % 6}` (15 à 20) | même question |
| Réponse OUI | `gourdes - 1`, animation `M20AJ` (la porte brisée), le tour continue | idem : **la gourde est dépensée même en solo** |
| Réponse NON (ou délai de 60 s) | voix `K20TE{10 + (rnd() & 3)}` (10 à 13 ; pour Obélix `10 + (rnd() & 1)`), **tour perdu** | voix `K20TE14` (sauf Obélix), puis `K20TE21` non interruptible, sortie gratuite, le tour continue |

**Dans tous les cas le drapeau de prison est remis à 0 en sortie** : la prison ne coûte jamais plus d'un tour. **En solo elle ne fait jamais perdre de tour.**

Rappels d'image (probable) : `20fa:000d` recopie l'animation de 76 × 62 pixels dans la vignette de la case du pion (colonnes x = 3, 98, 172 ; lignes y = 3, 69, 135 ; table `20fa:00c0`) ; `20fa:0112` fait de même pour `M20AM`, toujours sur la bande du haut. `20fa:0174` joue `M20AM` puis redessine le pion.

### 10.2 Repos et jeux d'ambiance hors écran (type 0) (sûr)

`20fa:05e9`, clé 54 (dossier 21). Un seul tirage `t` : **en solo `rnd() % 5`** (0 à 4) ; **à plusieurs `rnd() % 5 + 2`** (2 à 6).

| `t` | Probabilité | Effet |
|---|---|---|
| 0 à 3 | solo 4/5 ; à plusieurs 2/5 | **halte** : animation de la case, rien d'autre |
| 4 | 1/5 | halte, puis **brigands** si le joueur a au moins un sesterce : voix `K21TE01`, perte de `rnd() % 3 + 1` sesterces (1 à 3, bornée à ce qu'il possède), un tintement par pièce |
| 5 | à plusieurs 1/5 | **jeu d'ambiance « perdant »** ; mais si un joueur quelconque est en prison, `t` devient 6 |
| 6 | à plusieurs 1/5 (2/5 si quelqu'un est en prison) | **jeu d'ambiance « gagnant »** |

**Halte** : animation `M21AA` (case 17), `M21AD` (case 26), `M21AG` (case 34) ou `M21AJ` (case 46), jouée dans la vignette (options `0xC84`, rappel `20fa:053e`, table `20fa:05d9`).

**Jeu « perdant »** (décision D8 : porté tel quel) :

1. Vidéo d'annonce `M21AN`, fond `M03DB000.MCG`.
2. La voix **`K21TE09`** (environ 18 s) est lancée sans attente ; après `rnd() % 1000 + 500` cs (**5,00 à 14,99 s**), le volume est baissé et **le son est coupé** ; attente de 10 cs. C'est le signal du jeu : les joueurs réagissent à l'arrêt du son (probable, à écouter).
3. Tableau des joueurs, vidéo `M21AP` (« désignez le perdant »), désignation `1d24:0a44(-1)`, vidéo `M21AR`.
4. Sur la carte `M02DA000.MCG`, **le joueur désigné recule case par case** (bruitage `DS:19f0`, 30 cs par pas, au moins un pas) **jusqu'à la première prison rencontrée**, et il est mis en prison. Attente de 50 cs. Aucun effet de case.

**Jeu « gagnant »** : vidéo d'annonce `M21AM` ou `M21AO` (une chance sur deux, deux jeux différents), tableau des joueurs, vidéo `M21AQ` (« désignez le gagnant »), désignation `1d24:0a44(-1)`, vidéo `M21AS`, puis **+1 sesterce au gagnant**.

Les joueurs désignent eux-mêmes le perdant ou le gagnant ; le joueur courant peut être désigné ; sans action en 20 s, c'est le tirage initial qui est retenu. Les voix `K21TE02` à `08` ne sont jamais jouées par ce code (le contenu parlé est dans les vidéos). **En solo il n'y a aucun jeu d'ambiance.**

### 10.3 Espion Zérozérosix (type 2) (sûr)

`20fa:0b83` (aussi appelée par la surprise) ; rend le type de la case d'arrivée, que `1abf:0f99` joue ensuite.

1. Carte `M02DA000.MCG` (fondu), sons `m13b0000/1/2.voc`.
2. **`pos = (pos + 1) % 54` d'office** : le curseur part de la case suivante.
3. Introduction : `n = rnd() & 3`, retiré tant qu'il égale la précédente (`DS:6b56`), vidéo `M13A{'A' + n}` (`15d7:06eb(0x0d, n, 0, 0x20000)`). La toute première n'est jamais `M13AA` (la mémoire vaut 0 au lancement).
4. Son `m13b0000`, 25 cs, chrono 0, musique `m13m.voc` en boucle.
5. Choix (`20fa:09c7` à chaque image) jusqu'au **clic** ou à **30 s**. Au délai : voix `K63TE38` et la case sous le curseur est retenue (au pire la case suivante).

**Déplacement du curseur** : le mini-pion du joueur est dessiné sur la carte (§9.11). Chaque case a un mot de directions `DS:2a3a[pos]` : le quartet bas donne les directions qui font **avancer** (+1), le quartet haut celles qui font **reculer** (-1), avec les bits habituels (1 haut, 2 bas, 4 gauche, 8 droite). Les flèches suivent ainsi le tracé du circuit sur la carte. À chaque pas : son `m13b0002`, `pos ± 1` modulo 54, **et l'on continue tant que la case est interdite** ; puis 36 cs avant la répétition.

**Cases interdites** : les quatre cases Zérozérosix (14, 29, 41, 53), et, **seulement si le joueur a déjà tous ses objets**, les cases 2 et 3 (alors recouvertes par le banquet). Tout le reste est permis : prison, pièges, Détritus, village.

Table `DS:2a3a` (54 mots, hexadécimal, positions 0 à 53) :

```
49 61 21 21 28 48 48 48 42   12 14 82 14 82 12 18 48 42   12 12 14 84 84 84 81 21 24
84 82 14 82 14 84 84 81 21   21 28 48 41 21 24 84 81 21   21 28 48 48 48 42 12 12 1a
```

### 10.4 Pièges (type 3) (sûr)

`20fa:0f38`, table `20fa:1198`.

| Case | Nom | Vidéo | Destination |
|---:|---|---|---|
| 6 | Piège dans la forêt | `M15AA` | **fixe : case 34** (repos) |
| 15 | Coup de bélier | `M17AA` | `rnd() % 9 + 21` : cases 22 à 30, sauf 24 et 28 |
| 24 | Catapulte | `M18AA` | `rnd() % 9 + 6` : cases 7 à 15, sauf 15 |
| 28 | Boxeur | `M19AA` | `rnd() % 9 + 12` : cases 13 à 21, sauf 15 |
| 38 | Puits | `M14AA` | `rnd() % 9 + 45` : cases 46 à 54, sauf 51 |
| 51 | Taureau | `M16AA` | `rnd() % 9 + 33` : cases 34 à 42, sauf 38 |

Les formules donnent une position (0..53) ; les intervalles ci-dessus sont en numéros de case. **Le tirage est refait tant que la destination est elle-même un piège** ; les cases restantes sont équiprobables.

Suite : vidéo dans la bande de la case (options `0x22C84`, rappel `20fa:0e83`), plateau recalé sur la destination, le pion « tombe » sur sa nouvelle case en 4 images (25 pixels plus haut par image restante), puis secousse de l'écran `1d24:0260` (= SMURF `1f33:03ee` : bruitage `DS:19f6`, 16 allers et retours de 3 lignes, 2 ticks par position). **L'effet de la case d'arrivée s'applique ensuite** : un piège peut mener en prison (case 30), chez l'espion (cases 14, 29, 41, 53), etc.

### 10.5 Tullius Détritus (type 4) (sûr)

`288f:000f(force_soi)` : 0 depuis une case Détritus, 1 depuis la surprise. Clé 222 (dossier 38), mais **aucune voix n'est jouée** : tout est dans les vidéos `M38AA` à `M38AH` (surimpression, non interruptibles).

**Tirage** : `d = rnd() & 3`, **retiré tant qu'il égale le tour précédent** (`DS:7592`, commun aux deux modes, jamais remis à zéro) : une chance sur trois pour chacun des trois autres tours, avant les substitutions.

**Mode A, le joueur courant subit**, si **moins de 3 joueurs** ou si `force_soi`. Substitutions : `d = 0` devient 1 si le joueur n'a pas de gourde ou s'il est Obélix ; `d = 1` devient `2 + (rnd() & 1)` si le joueur est déjà en prison.

| `d` | Vidéo | Effet |
|---|---|---|
| 0 | `M38AH` | perd 1 gourde (affichée sur son marbre de route) |
| 1 | `M38AE` | recule case par case jusqu'à la première prison ; mis en prison |
| 2 | `M38AF` | recule de 6 cases |
| 3 | `M38AG` | avance de 6 cases |

**Mode B, choix d'une victime**, à **3 ou 4 joueurs** et sans `force_soi`. Substitutions : `d = 0` devient 1 si le joueur courant est Obélix, ou a déjà 5 gourdes, ou si un autre joueur n'a aucune gourde ; `d = 1` devient `2 + (rnd() & 1)` si un joueur quelconque est en prison. Tableau des joueurs, vidéo, puis désignation `1d24:0a44(-1)` (le joueur courant peut se désigner).

| `d` | Vidéo | Effet |
|---|---|---|
| 0 | `M38AD` | **vol de potion** : +1 gourde au joueur courant, -1 à la victime (aucune borne revérifiée ; sans effet si l'on se désigne) |
| 1 | `M38AA` | la victime recule jusqu'à la première prison ; mise en prison |
| 2 | `M38AB` | la victime recule de 6 cases |
| 3 | `M38AC` | la victime avance de 6 cases (le « cadeau » possible) |

**Règles des déplacements de 6 cases** : pas à pas sur la carte (`DS:19f0`, 30 cs par pas), puis **on continue dans le même sens tant que la case d'arrivée est un piège** ; à l'arrivée, `en prison = 1` si c'est une prison, **sinon 0** (un prisonnier déplacé est donc libéré). Attente finale de 100 cs.

Points de règle :

- **Aucun effet de case à l'arrivée** : seul le drapeau de prison est posé. Avancer de 6 ne joue ni le village ni la case atteinte ; mais le test de victoire qui suit le module peut faire gagner un joueur amené sur les cases 1 à 3 avec tous ses objets.
- Le tour « prison directe » est écarté dès que quelqu'un (mode B) ou le joueur (mode A) est déjà en prison ; les tours 2 et 3 restent possibles sur un prisonnier.
- Aucun vol ni cadeau en sesterces.
- **À 1 ou 2 joueurs, et toujours sur la case surprise, il n'y a pas de victime à désigner : le joueur subit lui-même.**

### 10.6 Potion (type 5) (sûr)

`20fa:1223`, clé 200 (dossier 37).

- Déjà **5 gourdes** : rien n'est gagné, voix `K37TE{perso + 11}` (11 à 16).
- Sinon `gourdes + 1`, animation `M37AA` dans la vignette (rappel `20fa:11b0`), puis une voix : si le joueur vient de dépasser d'une gourde sa dotation de départ (`gourdes == 4 - niveau Réflexion`), `K37TE{perso + 1}` (01 à 06) ; sinon, pour Obélix avec moins de 5, `K37TE02` ; sinon, à 5 gourdes, `K37TE{perso + 17}` (17 à 22) ; sinon `K37TE{7 + (rnd() & 3)}` (07 à 10).

+1 par passage, maximum 5, conforme au manuel. Obélix n'a aucun traitement particulier hors les voix.

### 10.7 Pays et quiz (type 7) (sûr)

`25f1:042d`. Le pays est `pos / 6` ; l'objet a le même indice.

| Case | Pays | Fichier (`MDF/40`) | Objet (indice) | Voix « objet gagné » |
|---:|---|---|---|---|
| 1 | Gaule (village) | `M40GAULE.TXT` | 0 saucisson | `K40TE13` |
| 7 | Bretagne | `M40GBRET.TXT` | 1 ballon ovale | `K40TE14` |
| 13 | Normands | `M40NORMD.TXT` | 2 crâne | `K40TE15` |
| 19 | Germanie (Belgique, Allemagne, Suisse) | `M40GERMA.TXT` | 3 fromage à trous | `K40TE16` |
| 25 | Rome | `M40ROMAN.TXT` | 4 plaque « Circus Maximus » | `K40TE17` |
| 31 | Grèce | `M40GRECE.TXT` | 5 statue grecque | `K40TE18` |
| 37 | Mésopotamie et Palestine | `M40MEPAL.TXT` | 6 outre « oléa pétroléum » | `K40TE19` |
| 43 | Egypte | `M40EGYPT.TXT` | 7 sphinx | `K40TE20` |
| 49 | Ibérie | `M40IBERE.TXT` | 8 castagnettes | aucune (toujours une voix générique) |

Le nom des objets est lu sur l'image du marchand (probable ; le manuel ne les nomme pas et son dessin du marbre suggère d'autres libellés pour les objets 3 et 8).

**Voix d'accueil** (clé 400, dossier 60). Avec `obj` = objet du pays déjà acquis, `n` = objets acquis, `T` = objets requis :

- si l'objet manque, `n == T - 1`, et (pas dernier tour de table, ou pays = Gaule) : `K60TE52` ;
- sinon, si l'objet manque, `n < T`, pas dernier tour, et une fois sur trois : `K60TE50` ou `51` ;
- sinon, une fois sur deux, voix du pays `K60TE{53 + 2 × pays + (rnd() & 1)}` (53 à 70) ; sinon générique : `K60TE{46 + (rnd() & 3)}` si l'objet manque, `K60TE46` ou `48` s'il est acquis.

**Tirage de la question** (`25f1:0046(niveau Réflexion, pays)`) : le fichier compte 99 questions (format dans `formats.md`).

| Niveau | Numéros | Tirage |
|---|---|---|
| Facile (0) | 1 à 30 | `rnd() % 30 + 1` |
| Moyen (1) | 31 à 70 | `rnd() % 40 + 31` |
| Difficile (2) | 71 à 99 | `rnd() % 29 + 71` |

**Non-répétition** : on retire tant que le numéro égale `DS:7182[pays × 3 + niveau]`, puis on l'y mémorise. Seule la **dernière** question tirée pour ce pays et ce niveau est donc exclue ; la table est commune à tous les joueurs et n'est remise à zéro qu'au lancement du programme. La lettre F, M ou D du fichier n'est pas comparée au niveau : seul le numéro compte.

**Mise en page** : question en lignes de 29 caractères au plus, coupées au dernier espace, 5 lignes en (20, 30 + 18i) (`25f1:0357`) ; un `?` qui se retrouverait seul en début de ligne emmène avec lui le dernier mot de la ligne précédente. Trois réponses en (20, 118 + 18i) (`25f1:0386`), dans un ordre tiré au hasard (permutation `DS:719f`) ; la ligne du curseur est en couleur 0xF0, les autres en 0xFF.

**Déroulé** (clé 300, dossier 40), pour l'essai 0 puis l'essai 1 (rattrapage) :

1. À l'essai 1 : **`gourdes - 1`** d'entrée.
2. Tirage de la question et de l'ordre des réponses. Fond `M40DA000.MCC`. Musique `m40ma.voc` ; une fois sur trois, la lettre devient `'a' + rnd() % 5`, et la lettre `e` est remplacée par `f` en français (`M40MF.VOC`). Elle est relancée quand elle se termine.
3. Curseur sur la première réponse ; bas et haut le déplacent (bruitage, 15 cs) ; clic gauche valide. **Temps : 15 secondes, le même pour les trois niveaux** (chrono 2).
4. **Temps écoulé** : bruitage « faux », 25 cs, vidéo `M40AE`. **Pas de rattrapage.** Fin.
5. **Bonne réponse** : bruitage « juste », 25 cs.
   - Objet pas encore acquis : `objets + 1`, drapeau posé, image `M40DB00{pays}.MCC`, voix `K40TE{37 + rnd() % 3}` (si pays = Ibérie ou une fois sur deux) ou `K40TE{13 + pays}`. Puis, **sauf pour la Gaule** : si `n == T`, clé 600 `K62TE06` (« tu as tous tes objets », probable) ; si `n > T`, `K62TE07`.
   - Objet déjà acquis : vidéo `M40AA`, rien n'est gagné.
6. **Mauvaise réponse** : bruitage « faux », 25 cs. S'il s'agit déjà du rattrapage ou si le joueur n'a pas de gourde : vidéo `M40AB`, `AC` ou `AD` au hasard, fin. Sinon question oui/non `K40TE{perso + 7}` (07 à 12) sur `M49DA00{perso}` : non, fin ; oui, essai 1.

Points de règle : **un seul rattrapage** ; il est proposé même si l'objet du pays est déjà acquis (d'où le conseil du manuel de ne pas gaspiller une gourde) ; la question de rattrapage est forcément différente de la première ; **le quiz ne rapporte aucun sesterce**, seulement l'objet. On peut posséder plus d'objets que le nombre requis. Rien ne change en solo.

### 10.8 Epidemaïs (type 8) (sûr)

`20fa:14a9`, clé 339 (dossier 41), fond `M41DA000.mcc`. Les 9 objets sont toujours proposés ; table `DS:2ac5` (x, y, objet) dans l'ordre du curseur, flèche en (x - 32, y - 40) :

| Rang | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| (x, y) | (56,110) | (78,200) | (108,114) | (146,195) | (170,87) | (214,137) | (258,102) | (292,200) | (330,130) |
| Objet | 0 | 4 | 5 | 2 | 8 | 7 | 6 | 3 | 1 |

1. Si le joueur a déjà `objets >= T` : clé 600, `K62TE06` (égal) ou `K62TE07` (supérieur), **aucune vente**.
2. Sinon, s'il a **moins de 3 sesterces** : vidéo `M41AC`, sortie.
3. Sinon vidéo `M41AA` ou `M41AB`, puis sélection : droite, objet suivant (boucle) ; gauche, précédent ; 15 cs d'anti-rebond ; sortie au clic ou après **60 s**.
4. Délai écoulé : clé 607, `K63TE36`, sortie sans achat.
5. Clic sur un objet déjà possédé : vidéo `M41AD`, retour à la sélection.
6. Clic sur un objet non possédé : bruitage d'achat, drapeau posé, `objets + 1`, image `M41DB00{objet}.mcc`, voix (`K41TE{objet + 7}`, ou une fois sur deux, s'il manque encore des objets, `K41TE06`, `16` ou `17`), **débit de 3 sesterces** ; si `n >= T`, clé 600 `K62TE06` ou `07`. Sortie : **un seul achat par passage**.

### 10.9 Devin (type 9) (sûr)

`20fa:192e`, clé 234 (dossier 39), fond `M39DA000.MCC`, vidéos du dossier 39 en surimpression. Six groupes de gourdes, pari 0 à 5, table `DS:2afb` : (83,115), (124,128), (156,210), (198,99), (231,184), (313,110) ; flèche en (x - 28, y - 36).

- **Aucun pari en cours** (`DS:6489 == -1`) : vidéo `M39AD` en solo, `M39A{'K' + perso}` à plusieurs (`M39AK` à `AP`) ; puis saisie du pari.
- **Pari en cours** : le curseur est montré sur le groupe parié, avec deux lignes de texte en (8, 15) et (8, 35) : « tu avais parié: %d » (si le parieur est le joueur courant) ou « %s a parié: %d » ; puis « réponse exacte ! » si **les gourdes du joueur courant égalent le pari**, sinon « faux ! c'était: %d ».

| Résultat | Parieur | Suite |
|---|---|---|
| Juste | un autre joueur | voix `K39TE{perso du parieur + 23}`, **+3 sesterces au parieur**, puis nouveau pari du joueur courant |
| Juste | le joueur courant | voix `K39TE{perso + 5}`, vidéo `M39AB`, **+3 sesterces**, pari effacé, **pas de nouveau pari** |
| Faux | le joueur courant | voix `K39TE{perso + 5}`, vidéo `M39AA`, pari effacé, pas de nouveau pari |
| Faux | un autre joueur | voix `K39TE{perso du parieur + 17}`, puis nouveau pari du joueur courant |

- **Saisie du pari** : `DS:6489 = joueur courant` ; (avant un nouveau pari : image rechargée et vidéo `M39AE`) ; pari initial 0 ; droite +1 (de 5 revient à 0), gauche -1 (de 0 passe à 5) ; sortie au clic ou après **60 s** (alors `K63TE38` et le pari reste la valeur du curseur) ; voix `K39TE{30 + rnd() % 3}`.
- Enjeu : **3 sesterces**, aucune mise. Le pari porte sur le **prochain visiteur, quel qu'il soit**, y compris le parieur.
- Abandon d'un joueur : voir §9.10 (le pari suit le parieur ou disparaît avec lui).
- Les quatre textes existent en sept langues (`DS:2c1d` et suivantes) ; seuls les textes français servent. En solo, le joueur parie donc sur lui-même.

### 10.10 Surprise (type 10) (sûr)

`20fa:231b`, clé 665 (dossier 51). Rend 1 seulement si l'effet a été l'espion.

1. Question oui/non : voix `K51TE{1 + rnd() % 5}` (01 à 05), écran `M49DA00{perso}`.
2. **Refus** (ou délai) : voix `K51TE{6 + rnd() % 6}` (06 à 11), rien ne se passe.
3. **Acceptation** :

| Tirage | Probabilité | Effet |
|---|---|---|
| `rnd() & 1 == 0` | 1/2 | voix `K51TE{27 + rnd() % 9}` (27 à 35), puis **Détritus en mode « sur soi »** `288f:000f(1)` |
| sinon `rnd() % 3 == 0` | 1/6 | **+1 gourde** si moins de 5 gourdes et pas Obélix (image du marbre, voix `K37TE01`, 100 cs) ; sinon on passe au cas suivant |
| `== 1` | 1/6 | **+1 à 3 sesterces** (`rnd() % 3 + 1`) si le joueur en a moins de 97 (voix `K51TE{18 + 3(k - 1) + rnd() % 3}`, 18 à 26, marbre réaffiché à chaque pièce) ; sinon on passe au cas suivant |
| `== 2` | 1/6 | voix `K51TE{12 + rnd() % 6}` (12 à 17), puis **espion Zérozérosix** : la case choisie sera jouée |

Pour Obélix ou à 5 gourdes, la part des sesterces monte à 1/3. Le manuel ne décrit pas cette case.

### 10.11 Jeu (type 6) : aiguillage des mini-jeux et annonces (sûr pour l'aiguillage)

`20fa:135a`, table `20fa:146d` (15 positions puis 15 cibles). Chaque cible appelle l'annonce `20fa:130f(i)` puis le jeu.

| Case | `pos` | Annonce `i` | Fonction | Module | Jeu | Niveau lu (probable) |
|---:|---:|---:|---|---|---|---|
| 2 | 1 | 0 | `2580:03b3` | M22 | Des poissons pas très frais | Action |
| 3 | 2 | 1 | `275a:0052` | M23 | Non, tu ne chanteras pas | Réflexion |
| 4 | 3 | 2 | `207c:000c` | M24 | Des détails à la loupe | Réflexion |
| 8 | 7 | 4 | `1f31:0294` | M26 | Le brouillard | Réflexion |
| 11 | 10 | 5 | `2840:023a` | M27 | Tempête en mer du Nord | Action |
| 20 | 19 | 6 | `24e3:0406(0)` | M28 | Les sangliers | Action |
| 23 | 22 | 14 | `1f84:040a` | M36 | Le ciel sur la tête | Action |
| 27 | 26 | 13 | `1fe6:0043` | M35 | Coloriages | Réflexion |
| 33 | 32 | 8 | `24a1:027a` | M30 | Les jeux olympiques | non relevé |
| 36 | 35 | 9 | `27ba:0561` | M31 | Le fakir | Action |
| 40 | 39 | 3 | `1f01:0008` | M25 | Anachronismes | Réflexion |
| 42 | 41 | 10 | `26a6:0804` | M32 | Bagarre avec les Romains | Action |
| 44 | 43 | 11 | `2353:0005` | M33 | Les hiéroglyphes de Cléopâtre | Réflexion |
| 47 | 46 | 12 | `23d1:09c1(1)` | M34 | Idéfix dans la pyramide | Action |
| 52 | 51 | 7 | `24e3:0406(1)` | M29 | Pirates à bâbord | Action |

Le jeu d'Idéfix est aussi lancé du menu principal avec l'argument 0 (hors partie). Une position absente de la table lancerait `23d1:09c1(1)` sans annonce (cas impossible avec le plateau d'origine).

**Annonce** (`20fa:130f(i)`, clé 400, dossier 60) : chaque jeu a trois annonces, `K60TE{3i + 1}` à `K60TE{3i + 3}`. La voix jouée est `K60TE{3i + 1 + DS:2aa6[i]}` ; puis `DS:2aa6[i]` passe de 0 à `1 + (rnd() & 1)`, et ensuite alterne entre 1 et 2. La première annonce (sans doute la plus complète) n'est donc entendue qu'**une fois par jeu et par lancement du programme**, la table n'étant jamais remise à zéro.

**Les mini-jeux eux-mêmes ne sont pas lus** : règles, vitesses, effet des trois niveaux, gains en sesterces, rappels vidéo et sens de leurs marqueurs relèvent de la vague E. Ce qui est établi : ils reçoivent la main après l'annonce, modifient les sesterces par `1d24:0912`, et le tour se termine à leur retour (après le test de victoire).

### 10.12 Ce qui change en solo (récapitulatif)

| Sujet | À plusieurs | Solo |
|---|---|---|
| Annonce du tour | voix nominative | clignotement seul |
| Délai du menu du tour | tour perdu au second délai | le dé part tout seul |
| Commentaire de score en début de tour de table | à chaque tour (s'il y a matière) | au tour 1 seulement |
| Prison | tour perdu sans gourde ou sur refus | jamais de tour perdu, sortie gratuite |
| Repos | halte, brigands, deux jeux d'ambiance | halte, brigands |
| Détritus | victime désignée à 3 ou 4 joueurs ; sur soi à 2 | toujours sur soi |
| Devin | pari sur le prochain visiteur | pari sur soi-même, vidéo d'accueil `M39AD` |
| FIN du marbre | question `K63TE44` | question de l'abandon |
| Présentation à 120 min | `M42AE` | `M42AK` |
| Espion, pièges, potion, quiz, Epidemaïs, surprise, mini-jeux | identiques | identiques |

## 11. Sesterces et score

**Il n'y a pas de score au sens d'un total de points.** La partie se gagne par les objets et le retour au village (§9.9) ; l'écran « SCORE » montre gourdes, sesterces et objets. Les sesterces servent à acheter des objets chez Epidemaïs.

Toute variation passe par **`1d24:0912(joueur, delta, attendre)`** (sûr) : le total est borné à **0..99** (le delta est réduit pour y rester), puis un tintement est joué par pièce effectivement gagnée (`DS:19f2`) ou perdue (`DS:19f4`), en attendant la fin de chacun si `attendre`. Chaque joueur part de 0 sesterce.

| Source | Variation | Adresse |
|---|---|---|
| Brigands sur une case repos (1 passage sur 5) | -1 à -3 | `20fa:05e9` |
| Jeu d'ambiance « gagnant » | +1 au joueur désigné | `20fa:05e9` |
| Pari du devin gagné | +3 au parieur | `20fa:192e` |
| Surprise | +1 à +3 | `20fa:231b` |
| Achat chez Epidemaïs | -3 | `20fa:14a9` |
| Mini-jeux réussis | 1 à 3 d'après le manuel (selon le jeu : difficulté, temps, qualité, niveau) | **vague E** ; `1d24:0912` a 18 appelants, dont les mini-jeux |
| Quiz, potion, prison, espion, pièges, Détritus | aucune | |

Gourdes : dotation `3 - niveau Réflexion` ; +1 par case potion (maximum 5) ; +1 par la surprise ; +1 ou -1 par le vol de Détritus ; -1 par Détritus sur soi ; -1 pour sortir de prison ; -1 pour un rattrapage au quiz. Le vol de Détritus est le seul chemin qui ne revérifie pas les bornes (la substitution l'écarte quand le voleur a 5 gourdes ou qu'un autre joueur n'en a aucune, mais la victime désignée peut être le voleur lui-même).

Objets : +1 par bonne réponse au quiz d'un pays dont on n'a pas l'objet, +1 par achat. Aucun objet ne se perd.

## 12. Générique et règle du jeu

### 12.1 Générique (`15d7:0369`, = SMURF `154c:052e`) (sûr)

Joué une seule fois, à la sortie du programme (ou sur « Abandon » d'une boîte d'erreur) : il libère les bruitages et les blocs EMS, il est donc terminal.

1. Fondu au noir 16 ; fond `m47da000.mcg` ; polices `m52d3.pfn` (titres, hauteur 12) et `m52d2.pfn` (texte, hauteur 10) ; texte `m47.dat` (voir `formats.md`) ; musique `m47m.voc` lancée **sans boucle** (SMURF bouclait) ; fondu d'entrée 16.
2. Chaque fin de ligne du texte devient une fin de chaîne.
3. **Défilement** (`15d7:02cf`) : un cran = une ligne de texte = 12 pas d'un pixel. À chaque pas : restauration des lignes d'écran 20 à 179 depuis le fond, dessin de la page décalée, recopie des lignes 20 à 179, attente d'un tick (60 pixels par seconde au plus ; sur la machine d'époque la recopie ralentissait sans doute le défilement).
4. **Page** (`15d7:0249`) : 15 lignes à y = 14, 26, …, 182 (pas de 12), moins le décalage. Chaque ligne est **centrée** (`15d7:0187`), dessinée deux fois : ombre en couleur 0x7E à (x + 1, y + 1), texte en couleur 0x7D à (x, y).
5. **Balises en tête de ligne** :

| Balise | Effet |
|---|---|
| `@1` | ligne de **titre** : police `m52d3.pfn`, espacement des lettres réduit de 1 |
| `@2` | fin de la première phase du défilement |
| `@3` | début de la **page finale fixe** |

   Les deux caractères de la balise ne sont pas affichés. Phase 1 : défilement jusqu'à ce que la ligne du haut commence par `@2` ; phase 2 : jusqu'à `@3`. Un clic ou Échap (pris en compte au relâchement) **saute à la balise de fin de la phase en cours**.
6. Page finale à partir de la ligne `@3`, affichée fixe, attente de **200 cs**, fondu au noir de **64** pas, fondu sonore, arrêt du son.

### 12.2 Règle du jeu M44 (`15d7:0e8b`) (sûr pour l'enchaînement)

Fondu au noir 16 ; `M44AB.mux` (options `0x2500` : plein écran, **interruptible au clic seulement**, écran effacé à la première palette) ; attente du relâchement ; `M44AC.mux` (`0x2508`) ; attente ; `M44AD.mux` (`0x2508`) ; attente ; fondu au noir 16. Chaque vidéo se saute d'un clic. En mode démo, une entrée réelle arrête la suite. C'est la pancarte REGLE (« séquence de présentation du jeu » selon le manuel).

## 13. Questions tranchées par le désassemblage, recoupées avec le manuel

Le manuel disponible est celui de l'édition Macintosh ; il sert à recouper, pas de référence (décision D7 : le désassemblage fait foi).

| Question | Réponse du désassemblage | Adresse | Ce que dit le manuel | Écart |
|---|---|---|---|---|
| Nombre de joueurs | **1 à 4** ; à 4 inscrits le curseur est forcé sur JOUER ; 0 joueur refusé | `1abf:1532` | ne le dit pas ; cite le solo et « une partie à 4 joueurs », écrans de score à 4 lignes | aucun ; les sources annonçant 6 joueurs confondent avec les 6 personnages |
| Nombre de cases | **54** | `DS:1d81` | 54 (9 pays, 15 jeux, 4 prisons, 4 potions, 6 pièges, 4 repos, 10 rencontres, 2 surprises) | aucun (le plan parle de 50 cases : à corriger) |
| Durées et objets | 30, 60, 90, 120 min ; 3, 5, 7, 9 objets ; 90 min proposées par défaut | `1abf:1f3e` | idem | aucun |
| Ajustement des objets | table par nombre de joueurs et durée ; appliqué à l'ouverture et à chaque changement de durée | `DS:201a` | « s'ajuste automatiquement » ; captures : 90 donne 7, 30 donne 3, 60 donne 7 | « 60 donne 7 » n'est vrai qu'en solo : cohérent |
| REJOUER en solo sans partie préalable | Astérix, niveaux moyens, **120 min, 9 objets** | `1abf:13e5`, `DS:1f9d` | « 90 minutes, niveau moyen, avec Astérix » | **écart** : 120 contre 90 (le code DOS fait foi) |
| Gourdes de départ | `3 - niveau Réflexion` | `1abf:1532`, `1abf:13e5` | facile 3, moyen 2, difficile 1, « selon le niveau » | précision : c'est le niveau Réflexion |
| Maximum de gourdes | 5 | `20fa:1223` | 5 | aucun |
| Dé | un dé, faces 1 à 6, défilement cyclique arrêté 3 à 6 crans après le clic, arrêt automatique à 10 s | `1abf:0016` | un clic pour lancer, un second pour arrêter | aucun (l'inertie n'est pas dite) |
| Temps limite du tour | 15 s, rappel, 15 s : tour perdu à plusieurs ; en solo le dé part seul | `1abf:08e4`, `1abf:0f99` | « s'il tarde trop, il peut perdre son tour » | précision ; le solo n'est pas décrit |
| Case de départ sans importance | aucun effet au passage ; seule la case d'arrivée est jouée | `1abf:00f9` | idem | aucun |
| Chaînes de cases | espion, piège et surprise-espion rejouent la case d'arrivée, sans limite | `1abf:0f99` | non dit | précision |
| Victoire | tous ses objets **et** arrêt sur les cases 1, 2 ou 3 ; test sur tous les joueurs ; la case d'arrivée n'est alors pas jouée | `1abf:0cde` | village élargi à la bande ; dépasser = un tour de plus | aucun |
| Temps écoulé | testé au début de chaque tour de table ; moins de 60 s = dernier tour ; puis César gagne | `1abf:2431` | « si l'heure limite est atteinte, César gagne » | précision : la partie peut dépasser d'un tour de table |
| Pause | touche P ou les deux boutons, depuis le menu du tour ; temps décompté | `1abf:07f4` | touche P depuis l'écran à 9 cases | aucun |
| Volume | F1 et F2 | `1831:00ac` | touches « - » et « + » | **écart** (édition Macintosh) |
| Sauvegarde | aucune | | menu Fichier, Enregistrer | **écart** (édition Macintosh) ; le portage ajoute une sauvegarde automatique (D6) |
| Clics directs sur les éléments | aucun ; directions et validation | `153c:0043` et tous les écrans | clic sur la réponse, l'objet, la case de destination, la plaque | **écart** (édition Macintosh) ; le portage peut ajouter le clic direct comme confort, à décider |
| Aide au clic droit | codée mais **muette** (mode 2) | `135a:02b3` | non mentionnée | aucun |
| Prison | un tour perdu au plus ; 1 gourde pour sortir aussitôt ; en solo jamais de tour perdu | `20fa:02c1` | « sans potion on reste en prison » | précision : un seul tour ; solo non décrit |
| Repos | halte ; brigands 1 fois sur 5, 1 à 3 sesterces | `20fa:05e9` | brigands, montant non dit | précision |
| Jeux d'ambiance hors écran | **seulement sur les cases repos, à plusieurs** : 1/5 « perdant » (recule jusqu'à la prison), 1/5 « gagnant » (+1 sesterce) ; les joueurs désignent | `20fa:05e9`, `1d24:0a44` | jeux collectifs de Panoramix sur les cases repos ; désigner gagnant ou perdant ; pas en solo | aucun ; enjeux précisés |
| Espion | toute case sauf les 4 cases espion (et les cases 2 et 3 si tous les objets) ; 30 s | `20fa:0b83`, `20fa:09c7` | « saute les cases interdites » | précision |
| Pièges | destinations du §10.4 | `20fa:0f38` | « renvoi automatique sur une autre case » | précision |
| Détritus | victime désignée **à 3 ou 4 joueurs seulement** ; 4 tours, sans répétition immédiate ; aucun vol de sesterces | `288f:000f` | « on désigne la victime » ; « parfois des cadeaux » | **écart** à 1 et 2 joueurs ; pas de rareté particulière des cadeaux |
| Potion | +1, maximum 5 | `20fa:1223` | idem | aucun |
| Quiz | niveau Réflexion ; 15 s ; un rattrapage contre une gourde après une mauvaise réponse seulement ; aucun sesterce | `25f1:042d` | question selon le niveau, temps limité, rattrapage contre une gourde | précision : pas de rattrapage au temps écoulé |
| Non-répétition des questions | seule la dernière par pays et niveau | `25f1:0046` | « le nombre de questions étant limité » | précision |
| Epidemaïs | 3 sesterces, un achat par passage ; refus si le joueur a déjà ses objets requis | `20fa:14a9` | 3 sesterces, un seul objet | précision : le refus n'est pas dit |
| Devin | pari 0 à 5 sur les gourdes du prochain visiteur ; +3 sesterces ; pas de mise | `20fa:192e` | pari, gain en sesterces | précision : montant |
| Surprise | oui/non ; Détritus sur soi 1/2, gourde 1/6, sesterces 1/6, espion 1/6 | `20fa:231b` | rien | précision |
| Abandon | le joueur est retiré, les autres continuent ; le dernier restant choisit de continuer seul ou non | `1d24:161b`, `1d24:0be9` | « abandonne et laisse les autres continuer » | précision |
| Démo | après 60 s au menu, rotation Idéfix, règle, partie | `19e2:030c` | démonstration automatique, interrompue par un clic | aucun |
| Idéfix au menu | sélection (gauche) puis validation : jeu d'action M34 hors partie | `19e2:030c` | « un premier clic l'anime, un second lance le jeu » | aucun sur le fond |

## 14. Questions ouvertes et points à vérifier

**À vérifier sous DOSBox-X**

1. Délai de 60 s du menu principal compté depuis l'entrée, navigation comprise (lu ainsi).
2. REJOUER sans partie préalable : 120 minutes et 9 objets à l'écran de score.
3. Vitesse réelle du générique (1 tick par pixel dans le code) et durée de `m47m.voc` par rapport au texte (pas de boucle).
4. Sens de la copie des rappels de vignette (`1481:045e` vers `2bac:0004`) : position exacte des animations de prison, repos, potion et pièges dans la case.
5. Positions 23 et 37 : le rectangle restauré sous le pion (`1d24:1c6e`) est-il bien un morceau de décor qui passe devant ?
6. Ordre visuel de la porte de prison (dessinée dans le fond) et du pion (dessiné par-dessus).
7. Bruitages lancés par `16cb:0a4f` alors que la voie principale est muette : inaudibles dans l'original ; à repérer dans les mini-jeux avant de décider du comportement du portage.
8. Détritus, vol de potion quand la victime désignée est un joueur sans gourde ou le voleur lui-même (bornes non revérifiées).
9. Cas des horloges pendant les vidéos (§2.3) : écart réel sur le temps de partie.

**À vérifier à l'image**

10. Écran des niveaux `M08DB00x.mcc` : la bulle de gauche est-elle bien « Réflexion » ?
11. Noms exacts des 9 objets (marbre `M03DA00x`, étal `M41DA000`) ; le dessin du manuel suggère une palette de peintre et une outre là où la lecture de l'étal donne un fromage et des castagnettes.
12. Libellés et ordre des pancartes de M07 et des boutons du marbre (déduits du manuel et de la logique).
13. `07/M07A.MUX` : aucune référence dans l'exécutable ; fichier sans doute inutilisé (le menu anime `M07s.HY8`).

**À vérifier à l'écoute** (rôles déduits des conditions du code, contenu non écouté)

14. Voix d'annonce `K61TE01` à `05` et variantes longues `K61TE60` à `71`.
15. `K63TE05`, `06`, `07`, `08` (fins), `K63TE13` à `35` (commentaires de score), `K63TE36`, `38` (délais), `K63TE44` (quitter), `K63TE45` (non référencée).
16. Vidéos `M42AA` à `M42AK` (présentations par durée, demi-heure, quart d'heure, dernier tour).
17. `K62TE01` à `07` (remarques du marbre ; `06` et `07` = « tous tes objets, retourne au village », probable).
18. `K46TE01` à `13` (abandon), `K11TE07` à `12` (victoire), `K60TE46` à `70` (accueil du quiz).
19. Jeux d'ambiance : contenu des annonces `M21AM`, `M21AN`, `M21AO` et de la voix `K21TE09` coupée au hasard (le signal du jeu « perdant »).
20. Vidéos `M38AA` à `AH` : confirmer « reculer de 6 », « avancer de 6 », « vol de potion ».
21. Voix apparemment inutilisées : `K21TE02` à `08`, `K38TE01` à `12`, `K40TE01` à `06` et `22` à `36`, les 24 voix d'aide de `MDF/45`.

**Restes de lecture**

22. **Les quinze mini-jeux** (vague E) : règles, niveaux, gains, rappels vidéo, marqueurs `08` de `M26AA`, `M27AA` à `AF`, `M30A`, `M34AA` à `AF`, `M36A`, et le niveau lu par M30.
23. Clé de voix non restaurée après un clic droit sur la carte et le score (`1d24:0e08`, `1d24:112b`) : sans effet connu puisque chaque module repose sa clé, à surveiller à l'implémentation.
24. Remarque « aucun objet » du marbre de route : dépend de `DS:6491`, valeur éventuellement ancienne (comportement à reproduire tel quel).
25. `1948:000b` (erreur du pilote vidéo), manettes (`1884`), fonctions non identifiées `2c71`, `2c90`, `1481:0ad0`, `138e:0151` : sans incidence sur le portage.
26. Différences avec `SMURF.EXE` : établies d'après `docs/teleportaschtroumpf/engine.md`, le code de SMURF n'a pas été relu pour ce document.
27. Décisions de portage à prendre, hors désassemblage : durée de vie des mémoires de session (§6.3), aide au clic droit laissée muette ou non (§5.3), clic direct sur les éléments (§13).
