# Le bac du père mathieu (`FERRY.MHK`, écran 10) : étude de rétro-ingénierie

Tâche T7. Première épreuve de l'étape 2 (chemin A, avant `LILLY` et `SLIDES`) de L'Odyssée des Zoombinis (`ZOOMBINI.EXE` 1.0FR). Le moteur (table des écrans, `SCRB` / `SCRS`, RNG, ticks de 17 ms) est dans [../engine.md](../engine.md), le parcours et la sortie générique dans [../screens.md](../screens.md) ; l'épreuve jumelle la plus proche (glisser-déposer, boutons, Tick) est [bridge.md](bridge.md).

Confiance : **sûr** = lu dans le code ; **probable** = déduit de plusieurs indices ; **hypothèse** = non vérifié. Les adresses sont des `sélecteur:offset` ; `DS` = `1530` ; `1520` est le segment de données du moteur (tables des features et des cibles de dépôt, partagé par tous les écrans). Les noms de variables (`DS:72c4`…) sont ceux des offsets.

## 0. Résumé

- Le joueur dispose d'un **radeau de tabourets** (16 à 20 tabourets, un par Zoombini du groupe) posé sur l'eau devant un ponton. Le père mathieu, un homme-grenouille armé d'une perche, ne pousse le radeau que si **chaque Zoombini assis a au moins un trait en commun avec chacun de ses voisins déjà assis**. Le joueur glisse les Zoombinis du ponton vers les tabourets.
- **Règle cachée** (sûre) : fixe, il n'y a **aucun tirage** : un Zoombini déposé sur un tabouret libre est accepté si, pour **chaque tabouret voisin occupé**, les deux Zoombinis ont **au moins une valeur égale parmi leurs 4 attributs** (peu importe lequel). Sinon il est **refusé** : la grenouille fait une remarque, le tabouret l'éjecte, il retourne sur le ponton.
- **Sortie** : le bouton « go » est actif dès qu'un seul Zoombini est assis. Il n'y a ni limite d'erreurs, ni chrono : on peut partir avec le radeau incomplet. Les Zoombinis **assis au départ traversent** ; **tous les autres sont perdus** (renvoyés au camp 1). La suite est l'écran 11 (`LILLY`).
- **Niveaux** (sûr) : le niveau ne change que la **forme du radeau** (4 formes) et donc le nombre de voisins par tabouret : niveau 0 = une file (chaque tabouret a 1 ou 2 voisins), niveau 3 = un réseau serré (jusqu'à 6 voisins). Aucun autre paramètre ne varie.

## 1. Identification

| Élément | Valeur |
|---|---|
| Écran | 10 (`DS:8552`), descripteur `1530:106a`, étape 2 (`1108:02f9`) |
| Archive | `FERRY.MHK` (chaîne `1530:10f4`) |
| Enter | `10d8:0071` (réinitialisation des variables : `10d8:0000`) |
| Exit | `10d8:059b` (appelle `11a8:021c`, qui appelle `1168:36e1(0, 1)` : voir §6) |
| Tick | `10d8:0615` |
| Key | `10d8:0df6` (débogage, §4.4) |
| Clic de région | `10d8:0984(code)` (`1038:0000(0xc000, 1, 0x105e)`) |
| Rappel d'événements des Zoombinis de l'écran (`+0x10`) | `10d8:0ff0` (`switch` sur `n − 1` = `CS:11fd`) |
| Rappel d'événements des Zoombinis revenant à l'eau | `10d8:1209` |
| Rappel d'événements du radeau (départ) | `10d8:17af` |
| Rappel de dessin des boutons | `10d8:051a` ; rappel de Tick des boutons `10d8:0538` |
| Dessin d'un bouton | `10d8:046d(redessiner, enfoncé, bouton)` |
| Création des tabourets et décors | `10d8:1861` → `10d8:1271(id SCRB)` |
| Graphe de voisinage des tabourets | `10d8:18d6` (table `DS:7300`) |
| Choix d'une place libre sur le ponton | `10d8:1b71` |
| Réaction à un refus (choix de la variante) | `10d8:1614(variante)` |
| Lancement d'une animation de Zoombini | `10d8:0f7f` ; animation du tabouret `10d8:0f15` |

Ressources de `FERRY.MHK` (vérifiées) : `tBMP` 100 (« terrain » 160 × 120, chargé par `11a8:1783`, jamais utilisé par cette épreuve : pas de déplacement libre dans l'écran), 1300 (fond 640 × 480, palette `SHPL` 1300), 1400 (6 images 38 × 36 : boutons), 1450 (3 images : les pieux du ponton), 1500 (13 images : tabourets et décors), 1600 (109 images : le père mathieu et ses effets), 1700 (64 images : tabourets qui basculent, éclaboussures), 1800 (232 images : le père mathieu qui parle) ; `SCRB` 1450–1452, 1500–1529, 1600–1609, 1700–1706, 1800–1832 (83) ; `SCRS` 1000–1009 et 1900–1907 ; `\0SND` 1600–1607, 1700–1705, 1800–1833, 1900–1903 (52). Pas de `REGS`, `NODE` ni `PATH` (aucun déplacement sur chemin).

Chargement par Enter (sûr) : groupes de formes 0 = `tBMP` 1500 (`SCRB` 1500–1509), 1 = 1600 (1600–1609), 2 = 1700 (1700–1706), 3 = 1800 (1800–1832), 4 = 1450 (1450–1452) ; planche des boutons `tBMP` 1400 (`DS:0fde`) ; `1168:03ef(0, 8, 1900)` charge les 8 `SCRS` 1900–1907 (« REJECT ») et `1168:04d0(1, 10, 1000)` les 10 `SCRS` 1000–1009 (« NORMAL ») ; fond `SHPL` + `tBMP` 1300 (`11a8:1475`). Aucun `REGS` : les parties sont dessinées à leur position brute.

Préchargement de sons (`11a8:313a(indicateur, dernier, premier)`) : indicateur 1 : `\0SND` 1606–1607, 20000–29999 (voix), 1800–1899 ; indicateur 0 : 996–997, 1704–1705, 425–499 (voix des Zoombinis), 1600–1699, 1900–1999, 1700–1799. Le sens de l'indicateur est celui d'`engine.md` §6.2 (non élucidé).

## 2. Règle

### 2.1 Les Zoombinis et le radeau

- Un Zoombini a 4 attributs de 1 à 5 en `+0xec…+0xef` de l'objet (`engine.md` / `screens.md` §2.1). L'épreuve les compare **octet par octet** sans jamais nommer l'attribut : l'ordre cheveux / yeux / nez / pieds n'a pas d'importance pour la règle (sûr). Ni le tirage ni la partie ne cachent rien : la règle est la même à chaque visite et pour tous les groupes.
- **Nombre de tabourets `N`** (`10d8:1861`) : nombre de Zoombinis du groupe (`1168:02cc`, compté à l'entrée : tous ont `+0x127 = 1`), borné : si `N < 16` ou `N > 20`, `N = 16` (un groupe de moins de 16 Zoombinis reçoit donc un radeau de 16 places, sûr). `DS:72bc` (surcharge de `N`) vaut 0 en permanence (jamais posé ailleurs).
- **Forme du radeau** : le script `SCRB` n° `1510 + 5 × niveau + (N − 16)` (niveau 0 à 3, `DS:72be`, §3). L'**image 0** du script liste jusqu'à 24 cases `(w, x, y)` : chaque case avec `w` de 1 à 3 est un **tabouret** à la position `(x, y)` (coin haut-gauche de l'image, 44 × 36 pixels) ; `w` vaut 1, 2 ou 3 au hasard de la mise en page, c'est la **variante graphique du tabouret** (script `SCRB` 1500, 1501 ou 1502), sans effet sur la règle (sûr). Les cases `w = 0` sont vides. L'ordre des tabourets (numéro 1 à `N`) est l'ordre des cases non vides de l'image 0. L'**image 1** liste des décors (`w` de 4 à 10 → `SCRB` 1503–1509 : tonneau, caisse, cordages…) à leurs positions ; ils ne sont créés que si `S+0x20 == 0` (réglage « plus d'action ») et n'ont aucun effet sur la règle.
- **Voisinage** (`10d8:18d6`, sûr, vérifié par simulation sur les 20 mises en page) : deux tabourets `i ≠ j` sont voisins si leurs rectangles (`R = (x, y, x + 44, y + 36)`) vérifient l'un des tests suivants (intersection à bords exclus : `max(gauches) < min(droites)` et `max(hauts) < min(bas)`), avec `h = 36 / 2 − 2 = 16` :
  1. `R_i` coupe `(x_j + h, y_j − h, x_j + 44 − h, y_j + 36 + h)` (colonne étroite, 12 de large, 68 de haut, centrée sur `j`) ;
  2. sinon `R_i` coupe `(x_j − h, y_j + h, x_j + 44 + h, y_j + 36 − h)` (bande large, 76 de large, 4 de haut) ;
  3. sinon, **au niveau 3 seulement**, `R_i` coupe `(x_j, y_j − h, x_j + 44, y_j + 36 + h)`.
  La table `DS:7300` (20 × 8 octets) garde, par tabouret, jusqu'à 8 numéros de voisins (1-based, par ordre croissant, terminés par 0) ; les tests sont symétriques (vérifié) et aucun tabouret n'atteint 8 voisins.
- **Test d'acceptation** (`10d8:0984`, code 3, sûr). Soit `Z` le Zoombini déposé sur le tabouret `t` (numéro 1-based `DS:72f2 = 1168:166e()`). Pour chaque voisin `v` de `t` (dans l'ordre de la table, jusqu'à 8) dont le tabouret est occupé par un Zoombini `Y` :
  - si `Z` et `Y` n'ont **aucun attribut identique** (`Z[k] ≠ Y[k]` pour `k = 0…3`), le test s'arrête : **refus** ;
  - sinon, les bits `1 << k` des attributs communs sont ajoutés au masque `DS:730a` (rôle : aide de l'entraînement, voir §4.2).
  Si tous les voisins occupés partagent au moins un attribut avec `Z` (ou s'il n'y a **aucun voisin occupé**), `Z` est **accepté**.
  Pseudo-code équivalent : `ok = tous(v ∈ voisins(t), occupé(v) ⇒ ∃k : Z[k] = occupant(v)[k])`.
- **Invariant** : seules les paires voisines comptent, la règle est vérifiée **au dépôt seulement**. Retirer un Zoombini d'un tabouret ne demande aucune vérification ; l'arrangement final est valide car toute paire voisine assise a été validée au moment où le second est arrivé (un Zoombini repris puis redéposé est revérifié contre ses voisins du moment).
- Un tabouret occupé ne reçoit pas de dépôt (la capture du glisser-déposer `1168:1742` ne considère que les tabourets libres) ; il faut d'abord reprendre l'occupant.

### 2.2 Conditions de réussite, d'échec, erreurs

- **Aucune limite d'erreurs** : un refus ne coûte que le temps de l'animation (§5.3). Les compteurs `DS:7310` (refus consécutifs) et `DS:730e` / `DS:7312` (dépôts acceptés consécutifs) ne règlent que les répliques du père mathieu (§5.1) ; aucun ne termine l'épreuve.
- **Aucun échec d'épreuve** (pas de « perdu ») : le départ est volontaire (bouton « go », §4.2). Le nombre de Zoombinis qui traversent est le nombre de Zoombinis **assis** (`+0x127 ≠ 0`) à la sortie.
- **Zoombinis renvoyés au camp** : ceux dont `+0x127 = 0` à la sortie (restés sur le ponton, ou tous si le joueur choisit « Tant pis » en retournant à la carte, `a2de = 3` → `1168:3dd0(0, 0)`). Ils retournent à la **réserve du camp 1** (`S−0x5B9E`, `S+0x4A += perdus`), puisque l'écran 10 est dans l'étape 2 : voir §6.
- Le puzzle n'est **pas toujours résoluble en entier** : le radeau a un tabouret par Zoombini, mais le groupe est tiré au hasard à Zoombinîle et rien ne garantit qu'un arrangement place les `N` Zoombinis (aucun test dans le code). C'est le choix du joueur de partir avec moins (**sûr** pour l'absence de test).

## 3. Les quatre niveaux

Le niveau est `1168:515d` (0 à 3 en aventure, `niveau d'entraînement − 1` en entraînement) copié en `DS:72be` à l'entrée ; hors de `[0, 4]` il serait ramené à 0 (cas impossible). **Seuls la mise en page et le test de voisinage 3 dépendent du niveau** (sûr, `10d8:1861`, `10d8:18d6` ; aucune autre lecture de `DS:72be` hors `10d8:044b` : voix d'introduction, §5.4).

| Niveau | `SCRB` de forme (N = 16 → 20) | Forme du radeau | Arêtes (N = 16…20) | Voisins par tabouret |
|---:|---|---|---|---|
| 0 | 1510 → 1514 | **une file en U** : rangée haute de 7 à 8 tabourets (`y = 254`), rangée basse de 7 à 8 (`y = 374`), reliées côté gauche par 2 tabourets (`y = 294` et `334`) ; N = 19 et 20 en ajoutent côté droit. Pour N = 16 à 19 c'est un chemin sans boucle (1 → 2 → … → 9 → 16 → 15 → … → 10 pour N = 16, 15 arêtes pour 16 tabourets) ; pour N = 20 les deux extrémités se rejoignent par la droite : anneau de 20 | 15, 16, 17, 18, 20 | 1 ou 2 |
| 1 | 1515 → 1519 | **deux rangées de 8** décalées de 10 px (`y = 294` et `334`) ; N = 17 à 20 ajoutent 1 à 4 tabourets en une troisième rangée (`y = 374`) | 22, 23, 25, 26, 28 | 1 à 4 |
| 2 | 1520 → 1524 | **quatre rangées** (`y = 254, 294, 334, 374`) de 4 à 5 tabourets, en parallélogramme (chaque rangée décalée de 12 px vers la droite) | 24, 25, 27, 29, 31 | 1 à 4 |
| 3 | 1525 → 1529 | mêmes quatre rangées de 4 à 5, décalées de façon irrégulière, avec le **test 3** (voisinage vertical élargi) : réseau dense | 33, 36, 38, 41, 43 | 2 à 6 |

- Les arêtes sont celles du graphe produit par `10d8:18d6` sur les positions de l'image 0 de chaque script (calcul fait sur les 20 scripts : tous les graphes sont connexes et symétriques). Les nombres de la dernière colonne sont extraits de cette simulation (**sûr**).
- Les quatre niveaux ont le même groupe, les mêmes sons, les mêmes animations et la même règle d'acceptation ; plus le niveau est haut, plus un Zoombini a de voisins à satisfaire en même temps.
- Les 5 scripts de chaque niveau ont exactement `N` tabourets (16 à 20) ; les mises en page de plus de 16 tabourets ajoutent des tabourets aux extrémités des rangées. Les `SCRB` dont l'image 0 contient exactement 24 cases (1517–1519, 1523–1524, 1527, 1529) n'ont pas de terminateur lisible après la 24e case : le lecteur doit s'arrêter à 24 cases (voir Points ouverts 7).

## 4. Déroulé et état

### 4.1 Variables de l'écran (`DS`)

| Offset | Rôle | Valeur / source |
|---|---|---|
| `7304` | **visites** de l'écran depuis le lancement du programme (+1 à chaque Enter, **non sauvegardé**) | `10d8:0071` ; 1 → le père mathieu joue l'introduction `SCRB` 1803 |
| `72be` | niveau (0 à 3) | `1168:515d` |
| `72bc` | surcharge de `N` | toujours 0 |
| `7314` | `N` réel = nombre de Zoombinis du groupe | `1168:032c` à l'entrée |
| `72e0` | nombre de Zoombinis assis | `1168:02cc` en fin de chaque glisser-déposer ; 0 → « go » grisé |
| `72de` | écran prêt (garde du Tick et du Exit) | 1 en fin de Enter, 0 à la sortie |
| `10d6` | garde de réentrance du Tick | |
| `72c4` | **occupé** (animation de refus en cours) : interdit de saisir un Zoombini | 1 au refus, 0 en fin d'animation |
| `72d4` | refus en attente (réplique de la grenouille en cours, puis animation) | |
| `72d6` | éclaboussure à lancer (variantes 7 à 9) | |
| `72d2` | **réplique en attente** : id d'un `SCRB` de la planche 1800 | `0` = rien |
| `7318` | identifiant de l'attente de fin de la réplique en cours (table `1520:06da`) | `11a8:1f5c` |
| `72b8` | seuil d'inactivité avant une réplique spontanée (ticks) | tirage `[5400, 10800]` (92 à 184 s) |
| `72f8` | variante du refus en cours (0 à 9) | §5.3 |
| `72fa` / `72fc` | Zoombini refusé (id d'objet) : en attente / en cours d'animation | |
| `72f2` | numéro du tabouret visé (au dépôt) puis id d'objet de ce tabouret | |
| `72f4` | id d'objet du tabouret qui joue son animation d'éjection | |
| `72c0` (dword) | position de retour choisie sur le ponton (x, y) | |
| `72c6` (dword), `72ca` (ptr), `72ce` (dword) | positions utilisées par les animations de retour | |
| `731c` | `SCRB` de l'action du père mathieu en cours | |
| `72fe` | **départ demandé** (« go ») | |
| `72d8` | attente de fin d'animation du départ | `1f5c` |
| `730e`, `7312`, `7316` | dépôts acceptés consécutifs, seuil d'encouragement (départ 1), « première réplique d'encouragement dite » | §5.1 |
| `7310` | refus consécutifs | |
| `730a`, `730c` | masque des traits communs, Zoombini à signaler (entraînement) | |
| `72e2` | jingle d'entrée terminé | |
| `72e4` | objet invisible `SCRB` 1601 (gabarit d'action du père mathieu ; mis à 0 au départ) | |
| `72e6` | objet du père mathieu (`SCRB` 1800–1803 puis répliques) | |
| `72e8`, `72ea` | ambiances `SCRB` 1602, 1603 (si `S+0x20 == 0`) | |
| `72ec`, `72ee`, `72f0` | effets d'eau `SCRB` 1704, 1705, 1706 | |
| `72f6` | dernier objet de décor créé (ordre de profondeur des tabourets) | |
| `7300` (ptr) | table des voisins (`0xa0` octets, `11c8:5af4`) | |
| `10d2`, `10d4` | états de dessin du bouton « go » | |
| `1520:0000` | nombre de tabourets `N` | |
| `1520:0002 + 2i` | id d'objet du tabouret `i` (aussi lu comme `DS:0076 + 2 × (i + 1)`) | |
| `1520:00fc + 4i` | point d'ancrage `(x + 22, y − 7)` du tabouret `i` | |
| `1520:02f0 + 2i` | **occupant** du tabouret `i` (id d'objet, 0 = libre) | |
| `1520:03ea`, `1520:03ec + 4k` | places du ponton : nombre (20), coordonnées | |
| `1520:05e0 + 2k` | occupation des places du ponton à l'entrée | |
| `DS:9714 + 2k` | occupant calculé de la place `k` du ponton | `1b71` |

Les champs de l'objet Zoombini (`+0x127` = « assis / vivant », `+0x128` = « refusé », `+0x122` = « à l'eau ») sont ceux de `bridge.md` §4.1 ; **`+0x127 ≠ 0` = assis sur un tabouret** pour cette épreuve (0 : sur le ponton ou en main).

### 4.2 Zones cliquables, souris, boutons

`1038:0000(0xc000, 1, 0x105e)` déclare les régions ; rectangles de 0x24 octets (`DS:0fbe + 0x24 × code`) lus par `10d8:046d` :

| Code | Rectangle | Rôle |
|---:|---|---|
| 1 | `(600, 403)–(639, 440)` | **retour à la carte** |
| 2 | `(600, 441)–(639, 478)` | **go** (départ du radeau) |
| 3 | zone implicite : tout clic hors bouton | saisie d'un Zoombini (glisser-déposer) |

Boutons (planche `tBMP` 1400, 38 × 36) : image 5 = retour normal, 6 = retour enfoncé, 1 = go grisé, 2 = go normal, 3 = go enfoncé. Le « go » est grisé tant que `72e0 == 0` (Tick des boutons `10d8:0538`). Le clic joue le son 999 (`11a0:0ee7(0, 999)`), dessine le bouton enfoncé, attend 2 ticks (`1090:00c1(1, 0, 2, 0, 0)`), le relâche. Sons communs : `\0SND` de `ZOOMBINI.MHK` 999 (clic), 997 (entrée).

Gestionnaire `10d8:0984(code)` (sûr) :

1. **Si `DS:8556 ≠ 0` ou `72fe ≠ 0`** (une sortie est déjà en cours) : tout clic sur une région **court-circuite l'attente** : si `72fe ≠ 0` la suite est l'écran 11 (`8556 = 11`), puis `8554 = 8556`, `8556 = 0`, `11b8:0011(0, 0)`, Exit immédiat.
2. **Code 1** : son 999, bouton enfoncé, `8556 = 1` (carte), `11a0:16da()` (ouvre la confirmation « ce groupe sera perdu » en aventure ; le Tick attend la réponse `a2de`, §4.3).
3. **Code 2** : seulement si `72e0 ≠ 0` (au moins un Zoombini assis) : son 999, `72c4 = 1` si un refus est en cours (`72d4 ≠ 0`), bouton enfoncé, `72fe = 1` (départ demandé). Le départ réel est lancé par le Tick (§4.3) quand plus rien n'est en cours.
4. **Code 3** (saisie) : ignoré si `9702 > 0` (des Zoombinis arrivent encore sur le ponton), si `72c4 ≠ 0` (refus en cours), si `72d8 ≠ 0` ou `72fe ≠ 0` (départ). Sinon `11a8:0d61(1, 1, 0, souris)` cherche le Zoombini sous le curseur ; s'il y en a un :
   - **ancien état** `s = +0x127`, puis `+0x127 = 0` (il ne compte plus comme assis pendant qu'il est en main) ; `72c0 = +0xd6` (sa position) ; `1168:1742(0, 0, 0, souris, objet)` : **glisser-déposer générique** : le Zoombini suit la souris (limites : rectangle `DS:6092`), l'objet est repris de son tabouret s'il y était (le tabouret redevient libre, `1520:02f0`), et le tabouret libre dont le **point d'ancrage** est à moins de **15 pixels** (tolérance `DS:9706`, valeur par défaut `1168:0034`, jamais changée par cette épreuve ; accrochage actif `DS:9708 = 1`) de la position du Zoombini est mis en évidence (son script de tabouret rejoue ses 4 images) ; au relâchement, ce tabouret devient la destination (`DS:99d8` / `99da`) et le Zoombini marche jusqu'à son ancre. Le premier tabouret libre dans l'ordre des numéros qui satisfait le test d'ancrage gagne.
   - **Dépôt sur un tabouret** (`72f2 ≠ 0`) : test d'acceptation (§2.1). Accepté : `+0x127 = 1` ; `730e += 1` si `s = 0` (venu du ponton, pas d'un autre tabouret) ; si `02cc() + 1 == 7314` (c'est le dernier) ou `730e == 7312` : `7312 += rand(3, 5)` et réplique d'encouragement (§5.1) ; `7310 = 0`. En entraînement (`DS:96f2 ≠ 0`) et si le masque `730a ≠ 0`, `730c = id du Zoombini` : le Tick écrit alors `730a` en `+0x125` du Zoombini (signalement des traits communs, **probable** : consommé par le code générique des Zoombinis `1168:*`). Refusé : voir §4.3.
   - **Dépôt hors tabouret** (`+0x124 == 4` : le Zoombini va vers sa position de repos) : si sa position de repos `+0x116` égale sa position `+0xd6`, il n'a pas bougé : `+0x127 = 0` ; sinon, si le point déposé est dans le **rectangle du ponton `DS:10e0 = (0, 130)–(469, 240)`**, il y reste (`+0x116` = point déposé) ; sinon `+0x116` = une place libre du ponton choisie par `10d8:1b71` et `+0x127 = 0`. Si de plus aucune réplique n'est en attente et que le point lâché est à portée de **15 pixels** de l'ancre d'un tabouret (`1168:41bd`) sans l'avoir pris, la grenouille dit une des 3 répliques `SCRB` 1820–1822 (§5.1). `DS:72e0 = 1168:02cc()` en sortie de tout dépôt.
5. `DS:72e0` est toujours recalculé en sortie.
- Un Zoombini repris sur un tabouret puis lâché dans le rectangle du ponton **garde** son `+0x127` ancien (= 1) : il n'est plus sur un tabouret mais continue d'être compté comme assis (**probable : défaut de l'original** ; voir Points ouverts 1).

**Placement initial** (sûr) : `11a8:0ed9(1, DS:1082, 20)` pose le Zoombini n° `i` du groupe sur la **place n° `i` du ponton** (20 couples `(x, y)` à `DS:1082`, état `+0x124 = 0`) :

```
 0 (370,160)   1 (395,196)   2 (332,156)   3 (348,196)   4 (294,168)
 5 (316,196)   6 (253,166)   7 (276,196)   8 (214,157)   9 (237,196)
10 (175,160)  11 (196,190)  12 (135,152)  13 (150,191)  14 ( 94,145)
15 (110,186)  16 ( 57,146)  17 ( 71,182)  18 ( 25,145)  19 ( 27,183)
```

Les places paires sont l'arrière du ponton, les impaires l'avant. Si le réglage « plus d'action » est actif (`S+0x20 == 0`) et hors reprise (`DS:970a == 0`), `1168:2505(0)` fait **entrer les derniers Zoombinis** : les `N − ⌊3N/4⌋` derniers (4 pour N = 16) sont placés à `x = −50` (hors écran, à gauche, même `y`) et marchent vers leur place (`1168:4231(0, 7, …)`) ; `1168:274e(30, 45)` règle leurs départs : le premier part 30 ticks après l'entrée, puis un toutes les 45 ticks ; `DS:9702` compte les Zoombinis encore en marche (la saisie est interdite tant qu'il est > 0). Sans l'option, ils sont tous déjà en place. **Probable** pour l'ordre des départs.

### 4.3 Tick `10d8:0615`

Gardé par `DS:10d6 == 0` et `72de ≠ 0`. Ordre :

1. **Départ** (`72fe ≠ 0` et `72d4 == 0` et `72c4 == 0`) : `72fe = 0` ; les objets `72e4`, `72e8`, `72ea` sont supprimés (`11a8:20e8`) ; le père mathieu (`72e6`) joue `SCRB` **1608 ou 1609** (tirage 50 %) avec le rappel `10d8:17af` ; `72d8` = attente de fin ; **`8556 = 11`** (suite = Lilly).
2. `11a8:04b9()` : avance toutes les animations.
3. **Sortie demandée** (`8556 ≠ 0`) : si `a2de` ∈ {0, 3} (pas de confirmation en cours ; 3 = « Tant pis » : `1168:3dd0(0, 0)` hors entraînement, tous les Zoombinis sont alors comptés perdus) et (`a406 ≠ 0` ou la fin de l'animation `72d8` : `1520:06da[72d8] == 0`) : `8554 = 8556`, `8556 = 0`, `11b8:0011(0, 0)`, **Exit** `059b`, retour. `a2de = 2` (« Ah non ») annule la sortie (`a2de = 0`, `8556 = 0`). Contrairement à Bridge, l'épreuve **n'attend pas le jingle 996** : elle attend la fin de l'animation du père mathieu (la durée de l'animation de départ est de 49 images, §5.2).
4. **Réplique en attente** (`72d2 ≠ 0`) : `72d2 = 0` ; si `72e4 ≠ 0` : `1b89(0, 0, 0, id, 72e6)` assigne le script `id` au père mathieu, `3533` précharge ses sons, `7318 = 1f5c(…)` (attente de fin). Fin du Tick (saute les autres étapes).
5. **Sinon éclaboussure** (`72d6 ≠ 0`, variantes 7 à 9) : `72d6 = 0` ; les effets `72ec` et `72ee` reçoivent le rappel `0ff0` et sont lancés ensemble (`1f5c`).
6. **Sinon refus en attente** (`72d4 ≠ 0`) : quand la réplique de la grenouille est finie (`1520:06da[7318] == 0`) : `72d4 = 0` ; choix d'une place libre `local_c = 1b71()` ; tirage de la **variante** `72f8` = `1098:0098(0, 0, 10, DS:7306)` (entier 0 à 9, tirage sans répétition immédiate) :
   - variante 0 : si `DS:972c ≠ 0` ou `9730 ≠ 0` (places 12 et 14 du ponton occupées), tirer à nouveau ;
   - variantes 7, 8, 9 : parcourir les places impaires 19, 17, …, 11 ; si la place est occupée (`9714[k] ≠ 0`) tirer à nouveau, sinon la prendre si `9712[k]` (place `k − 1`) et `970e[k]` (place `k − 3`) sont libres, sinon passer à la suivante ; aucune → tirer à nouveau ;
   - `72c0 = DS:1082[place]` puis `10d8:1614(variante)` (§5.3).
7. **Sinon réplique d'inactivité** : si `11a8:22ad()` (ticks depuis la dernière activité : toute saisie, touche ou clic remet à zéro par `11a8:2278`) dépasse `72b8` : `11a8:2278()`, `72d2` = une des 5 répliques `SCRB` 1823–1827 (`0x71f…0x723`, tirage sans répétition `DS:0fca`), `72b8` = nouveau tirage dans `[5400, 10800]`.
8. **Signalement d'entraînement** : si `730c ≠ 0`, `snoid(730c).+0x125 = 730a`, puis `730a = 730c = 0`.
9. **Jingle** : si `72e2 == 0`, `9702 == 0` (plus personne en marche) et que le son 997 est terminé (`1028:0d9e(0x4e44, 'SND', 997) == 0`) : `72e2 = 1`, le père mathieu rejoue son script 0 (position de repos, `1b89(0, 0, 0, 0, 72e6)` + `3533`).
10. `1108:035b()` (routine générique de fin de Tick : voix du narrateur `DS:a2c4`, etc., voir `bridge.md`).

### 4.4 Clavier (`10d8:0df6`) et rappel de région

Aucune touche en jeu normal. Seulement quand `DS:a43f ≠ 0` (mode de débogage) ou pour la touche de code `0x16f` : table `CS:0f05` : `A` (`18d6(1)` : affiche le graphe de voisinage), `F` (rejoue le `SCRB` suivant du père mathieu, `DS:731a`, message `Play FrogMan SCRB id:`), `L` (change le niveau d'entraînement via `1198:03cf(72be + 1)`), `0x16f` (`11a0:155e`, rôle non étudié, identique dans `slides.md`). Les raccourcis généraux (`Ctrl+Q`…) sont traités avant (`engine.md` §7.2).

## 5. Animations et sons

Délai entre images : **6 ticks** (102 ms) pour tous les objets animés de l'écran (argument de délai de `11a8:0ad6`, vérifié dans le désassemblage ; les pieux du ponton sont immobiles).

### 5.1 Le père mathieu qui parle (planche 1800, `SCRB` 1800–1832)

Chaque `SCRB` de réplique est une animation de bouche et de corps avec **un son** `\0SND` (même numéro de la liste ci-dessous, durée de 0,5 à 4 s) ; les phrases ne sont pas transcrites (les sons n'ont pas été écoutés). Les rôles sont déduits de leur usage dans le code (**sûr** pour l'usage, **hypothèse** pour le contenu des phrases).

| `SCRB` (son) | Usage | Déclencheur |
|---|---|---|
| 1803 (1831 puis 1832) | **introduction**, première visite du programme (`7304 == 1`) | Enter |
| 1800 (1810), 1801 (1811), 1802 (1807), 1803 (1831 puis 1832) | animation de repos au chargement les visites suivantes (tirage sans répétition `DS:0fc6` parmi ces 4) | Enter |
| 1804 (1800), 1805 (1801), 1806 (1804), 1807 (1803), 1808 (1802), 1809 (1825), 1810 (1826), 1811 (1827), 1812 (1813), 1813 (1814), 1814 (1815) | **remarque après un refus** (11 répliques, tirage sans répétition `DS:0fd2`) | dépôt refusé |
| 1815 (1816) | remarque spéciale : quand le nombre de refus consécutifs `7310` est égal à un tirage `rand(3, 5)` (renouvelé à chaque refus), puis `7310 = 5` | dépôt refusé |
| 1816 (1830) | **première réplique d'encouragement** (`7316` passe à 1) | dépôt accepté : 1er dépôt (car `7312` démarre à 1), puis après 3 à 5 autres dépôts, ou dernier Zoombini assis |
| 1817 (1828), 1818 (1829) | **réplique d'encouragement suivante** (tirage sans répétition `DS:0fce`) | idem |
| 1820 (1822), 1821 (1823), 1822 (1824) | **« c'est à côté »** (3 répliques, tirage `DS:0fda`) | dépôt hors tabouret mais à moins de 15 px d'une ancre |
| 1823 (1809), 1824 (1812), 1825 (1808), 1826 (1805), 1827 (1806) | **réplique d'inactivité** (5, tirage `DS:0fca`) | 92 à 184 s sans action |
| 1828 (1817), 1829 (1818), 1830 (1819), 1831 (1820), 1832 (1821) | **remarque après la baignade** (5, tirage `DS:0fd6`) | événement 7 d'un refus de variante 7 à 9 (§5.3) |
| 1819 (1833) | non référencé par une table : inutilisé (**probable**) | |

Le seuil `DS:7312` est le nombre de dépôts acceptés « neufs » (`730e`) qui déclenche la réplique suivante : valeur initiale 1, puis `+= rand(3, 5)`. Un dépôt refusé remet `730e` à 0 et `7312` à 1. Toutes les répliques passent par `72d2` (une seule à la fois ; le Tick n'en lance une que si l'objet `72e4` existe, c'est-à-dire tant que le père mathieu n'est pas parti).

### 5.2 Le départ du radeau

Le père mathieu joue `SCRB` 1608 ou 1609 (49 images, son 1606 ou 1607 de 8 s à l'image 0). De l'image 8 à 48, chaque image porte un terminateur d'événement de numéro `b` (3, 5, 2, 5, 3, 7, 4, 9, 3, 4, 5, 8, 5, 5, 6, 4 puis 3 ou 4) ; le rappel `10d8:17af(n = b − 1)` fait glisser **vers la droite (x croissant)** de `n` pixels : l'objet radeau tout entier, c'est-à-dire tous les Zoombinis dont `+0x127 ≠ 0` (position `+0xd6` et toutes les parties de l'image courante), tous les tabourets (drapeaux `0x748c2000`) et tous les décors (`0x74980000`). Déplacement total : **113 pixels** ; les Zoombinis restés sur le ponton ne bougent pas. À la fin de l'animation (`1520:06da[72d8] = 0`), l'écran se ferme.

### 5.3 Refus d'un Zoombini : la grenouille éjecte (variantes `72f8` 0 à 9)

Séquence (sûr pour l'enchaînement, **probable** pour l'aspect visuel que je n'ai pas pu voir à l'écran) :

1. Au refus (`10d8:0984`, code 3) : `7310 += 1`, `730e = 0`, `7312 = 1`, `72c4 = 1`, `1168:1647()` libère le tabouret visé (`1520:02f0`), `+0x128 = 1` sur le Zoombini, `72fa` = son id, `72f2 = id d'objet du tabouret` (table `DS:0076`), `72d2` = remarque (§5.1), `72d4 = 1`. Le Zoombini est déjà arrivé à l'ancre du tabouret.
2. Le Tick joue la remarque (`72d2`) puis, la remarque finie, tire la variante et appelle `10d8:1614(variante)` :
   - choix de l'action du père mathieu `731c` et de la position d'arrivée `72c6` :
     - variante **0** : `SCRB` **1605** (55 images, sons 1601, 1602, 1603), position d'arrivée `(122, 164)` (fixe, à la gauche du ponton) ;
     - variantes **1 à 6** : `SCRB` **1604** (14 images, son 1600) ou **1606** (11 images, son 1604), 50/50 (`rand(1, 100) < 51`), position d'arrivée = la place libre `72c0` du ponton ;
     - variantes **7, 8, 9** : `SCRB` **1607** (11 images, son 1605) ; le Zoombini est projeté à l'eau : création des effets `72ee` (`SCRB` 1705) et `72f0` (`SCRB` 1706, à `72c0 − 14` pixels) ; la position intermédiaire est `(236, 474)`, l'arrivée la place libre `72c0` ;
   - `1be6(1, 731c, objet)` remplace le script de l'objet par `731c` avec le rappel `10d8:0ff0` ; les sons sont préchargés ; `1f5c` attend les objets concernés ; `72ca = 0`.
3. **Événements du rappel `0ff0`** (argument `n = b − 1` de l'octet bas du terminateur ; cas 1 à 6) :
   - **1** (images 10 de `1604`/`1605`, 7 de `1606`, 9 de `1607`, terminateur `b = 2`) : le tabouret (`72f2 → 72f4`) joue son animation d'éjection (`SCRB` de la table `CS` `DS:3c`, **1701, 1700, 1700, 1702, 1702, 1703, 1703, 1700, 1702, 1703** indexée par la variante ; sons 1700 à 1703) ; le Zoombini lance son animation d'éjection : `SCRS` **1902, 1900, 1900, 1904, 1904, 1906, 1906, 1900, 1904, 1906** (table `DS:50`, indexée par la variante) ;
   - **2** (fin de l'envol, `b = 3` : `SCRS` 1900 image 24, 1904 image 14, 1906 image 11, ou `SCRB` 1605 image 47) : si le script d'arrivée de la variante (table `DS:64` = `SCRS` **1903, 1901, 1905, 1901, 1905, 1901, 1905, 1907, 1907, 1907**) est 1907 (variantes 7 à 9) : le Zoombini est rattaché à l'effet 1705 (`11a8:2a0a`) et `72d6 = 1` (le Tick lance les effets 1704 et 1705) ; sinon il est replacé à `72c6` avec le script d'arrivée, `72c4 = 0` (occupé levé), `29f6` ;
   - **3** (`SCRB` 1704 image 1 ; `b = 4`) : le Zoombini est placé à `72c6` avec le script d'arrivée de la variante (cas des variantes 7 à 9 : à `(236, 474)`, script 1907) ;
   - **4** (`SCRB` 1705 image 41 ; `b = 5`) : le Zoombini (`+0x122 = 1`) est replacé à `(93, 408)` avec le **script de nage** `SCRS` `998 + 2 × v` (`v` = 4e attribut, 1 à 5 : 1000, 1002, 1004, 1006, 1008 : 10 images, événement 6 à l'image 9) ;
   - **5** (fin de la nage, `b = 6` : image 9 des `SCRS` 1000…1008) : `+0x122 = 0`, le Zoombini rejoint `72ce` (= `72c0`) avec le script `999 + 2 × v` (`SCRS` 1001…1009 : 34 images, événements 7, 2, 3, 4, 5 aux images 28 à 32 : fin de marche générique `1168:4685`) ; le rappel devient `10d8:1209` ; `72fc = 0`, `72c4 = 0` ;
   - **6** (`SCRB` 1705 image 26 ; `b = 7`) : si `72d2 == 0`, remarque d'après baignade (§5.1).
   `10d8:1209(n)` : pour `n = 6` (fin de nage, `SCRS` `b = 7`), l'effet `72f0` (`SCRB` 1706) est arrêté (`1be6(1, 0, …)`) ; pour les autres `n` : rappel générique `1168:4685` des Zoombinis.
4. Fin de cycle : le Zoombini est de nouveau sur le ponton (état de repos), `+0x127 = 0`, `72c4 = 0` : le joueur peut le reprendre.

Les deux familles d'images `SCRS` (1900–1907 « REJECT », 1000–1009 « NORMAL ») sont des animations **de Zoombini** dont le décodage des variantes de partie dépend du moteur de snoids (`engine.md` §3.6, ouvert) ; seuls leurs numéros, durées et événements sont donnés ici.

### 5.4 Autres animations et sons

| Objet | `SCRB` | Rôle |
|---|---|---|
| fond | `tBMP` 1300 | pontons, eau, île |
| pieux du ponton | 1450–1452 (3 objets, positions `(49, 193)`, `(219, 217)`, `(402, 226)`, images 47×18, 45×37, 44×18) | décor statique devant l'eau (drapeaux `0x4000000`, délai 0) |
| tabourets | 1500, 1501, 1502 (4 images chacune : image 0 normale, images suivantes = mise en évidence au survol de l'ancre) | une feature par tabouret (drapeaux `0x748c2000`), `x + 22, y − 7` = ancre |
| décors | 1503–1509 (tonneau, caisse, cordages…) | positions de l'image 1 de la forme du niveau ; seulement si `S+0x20 == 0` |
| ambiances | 1602, 1603 (20 images : bulles) | seulement si `S+0x20 == 0`, chaînées par `2083(72ea, 72e8)` |
| éclaboussures | 1704 (20), 1705 (45, son 1704), 1706 (8, son 1705) | variantes 7 à 9 |

Sons de `ZOOMBINI.MHK` : 997 (jingle d'entrée, `11a0:0ee7(0, 997)`), 999 (clic de bouton). Les voix des Zoombinis (425–499) sont déclenchées par le moteur générique. **Voix du narrateur** à l'entrée (`DS:a2c4`, jouée par `1108:035b`) : `20074` (`0x4e6a`) si `1168:5c57(S+0x32)` renvoie 2 (= niveau 1 et bit `0x1000` de `S+0x32` pas encore posé : première visite à ce niveau), sinon `20073` (`0x4e69`) si le niveau est 0, sinon tirage entre les deux. Le texte de ces voix est dans `STRL` / sons `20000…29999` (non étudié, **hypothèse** : explication de la règle).

Sons de l'épreuve (`FERRY.MHK`, 11 025 Hz, 8 bits, aucun répétable) : 1600–1605 (actions du père mathieu : 0,27 à 0,72 s), 1606–1607 (8,0 s, départ), 1700–1703 (basculement des tabourets, 0,5 à 1,9 s), 1704–1705 (éclaboussures, 0,6 à 1,2 s), 1800–1833 (répliques, 0,5 à 4,1 s), 1900–1903 (sons des `SCRS` de refus : 1900 à l'image 6 du `SCRS` 1900, 1901 à l'image 0 du `SCRS` 1901, 1902 à l'image 0 du 1905, 1903 à l'image 0 du 1907). Les `SCRS` portent aussi des sons dépendant du Zoombini (événements `0xd6`…, `engine.md` §3.7).

## 6. Écriture dans le tampon de partie `S`

À l'**entrée** : `S+0x32` (mot de mémoire de dialogue de l'écran 10, `1168:5c57`) +1 (compteur de visites sur 12 bits, bits `0x1000` / `0x2000` = phrases de premier niveau déjà dites) ; `S+0xCA / CC` par le changement d'écran. Aucune autre variable de `S` n'est écrite par l'épreuve.

À la **sortie** (`Exit` → `11a8:021c` → `1168:36e1(0, 1)`, voir `screens.md` 3.4 et `bridge.md` §6) :

- Fiche de chaque Zoombini : octet 8 (« vivant ») = 1 si `+0x127 ≠ 0` (assis), 0 sinon. Les **perdus** (`+0x127 = 0`) sont rangés dans la réserve du camp 1 (`S−0x5B9E`, `S+0x4A += perdus`) ; les assis forment le groupe arrivé (`S−0x56D2`, nombre = `1168:032c`) avec leur position à la sortie.
- **Marque de réussite** : `S+0x56 + (10 − 7) = S+0x59` reçoit le bit `1 << niveau` (4 bits bas) **quelle que soit l'issue** (même avec un seul Zoombini assis, même si le joueur retourne à la carte) ; si aucun Zoombini n'est perdu, que `S+0x54 ≠ 0` (étape commencée d'une traite) et hors entraînement, le bit `0x10 << niveau` est aussi posé. Ni monument ni montée de niveau ici : ils ne se produisent qu'à la fin de la 3e épreuve de l'étape (`SLIDES`).
- Entraînement (`DS:96f2 ≠ 0`) : seul le groupe est vidé, aucune marque.

## 7. Points ouverts

1. **Zoombini repris sur un tabouret puis lâché sur le ponton** : le code restitue son ancien `+0x127` (= 1) quand il est lâché dans le rectangle du ponton (`10d8:0d3f`), alors qu'il n'est plus sur un tabouret. Il resterait compté comme assis (`72e0`, sortie, glissement du radeau). **Probable** que ce soit un défaut de l'original ; à reproduire dans le jeu avant de décider de le copier ou de le corriger.
2. Les **placements initiaux** des `⌊3N/4⌋` premiers Zoombinis passent par `11a8:0ed9` (place `i`) ; l'effet exact de `1168:2505` sur la marche d'entrée (ordre des départs de `1168:274e`, bloc de repérage des places occupées `1520:05e0`) n'est pas tracé à la case près.
3. **`1b71`** : le calcul d'occupation des places du ponton passe par `1168:527c` / `1168:53c9` (rayon 500, non lus) ; la règle de choix retenue (côté aléatoire, places paires puis impaires) est lue, mais l'effet de l'occupation `DS:9714` pour des Zoombinis en cours de déplacement n'est pas vérifié.
4. **Voix et répliques** : contenu des 34 sons 1800–1833 et des voix 20073 / 20074, non écouté ; affectation des phrases à leur rôle déduite du seul usage. Le son 1833 (`SCRB` 1819) n'est référencé par aucune table.
5. **Rendu des `SCRS`** 1000–1009 et 1900–1907 (traduction des variantes de parties en images de planche, `engine.md` §3.6) et sens exact du signalement `+0x125` en entraînement.
6. Touche `0x16f` (`11a0:155e`) active sans mode de débogage : rôle inconnu (identique dans `slides.md`).
7. **Images de 24 cases** (`SCRB` 1517, 1519, 1524, 1529…) : le décodage des 20 formes donne bien `N` tabourets ; le comportement exact du terminateur absent à la 24e case (point ouvert 3 d'`engine.md`) n'a pas d'incidence ici car les formes se lisent par le nombre de cases non vides, mais n'a pas été vérifié à l'écran.
8. Le rectangle `DS:10d8 = (203, 261)–(639, 408)` (zone du radeau) est copié à chaque clic de `10d8:0984` mais jamais utilisé (**probable** : reste de développement).
9. `DS:72bc` (surcharge de `N`) et `DS:731a` (cheat `F`) n'ont aucun autre écrivain : valeur de débogage.
10. Hit-test du glisser-déposer : le point utilisé est la position `+0xa6 / +0xa8` du Zoombini, clampée au rectangle `DS:6092` : la relation entre ce point et l'image du Zoombini (REGS des `SCRS`) n'est pas établie ; l'ancre `(x + 22, y − 7)` suppose que le point de référence d'un Zoombini est ses pieds **(probable)**.
