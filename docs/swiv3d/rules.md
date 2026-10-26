# SWIV 3D — règles du jeu : armes, bonus, énergie, score, objectifs, HUD

Rétro-ingénierie de `SWIV_WIN.EXE` (corpus décrit dans `re-index.md`, décompilations dans `archives/swiv3d/re/decomp/`, désassemblage `disasm.txt`) pour l'auteur du moteur de jeu (tâches H1 et H2 du `plan.md`). Les chaînes viennent du bloc 100 de `GLOBAL.BD` (`global-bd.md`), les enregistrements d'objets des niveaux du bloc 105 (`slv.md`). Doc seulement : aucun code ni table du dépôt n'a été modifié.

Légende : **[C]** confirmé (lu dans le code ou sur les données) ; **[P]** probable (déduit du rôle d'appelants, d'appelés ou de valeurs voisines) ; **[H]** hypothèse (non prouvé). Les adresses sont des adresses linéaires de l'exécutable.

Limites de cette passe : le jeu est écrit en C « sans optimisation » (Watcom) ; les comportements d'objets (fonctions appelées à chaque tick, `LAB_xxxxxxxx` dans Ghidra) ne sont pas des fonctions du corpus et ne sont lisibles que dans `disasm.txt`. Les armes de base du joueur et les règles générales sont décodées ; le détail des comportements ennemis (R2) et des armes 10 à 19 ne l'est que partiellement. Voir « Questions ouvertes ».

## 0. Conventions

- **Écran logique : 320 × 400** (mode X, 4 plans). `gm_frame` (`0042f64c`) pose la fenêtre de découpe `x ≤ 0x13e` (319), `y ≤ 399`. Tous les x, y du HUD ci-dessous sont dans ce repère, origine en haut à gauche. [C]
- Positions d'objet en virgule fixe 24.8 : `x, y, z = monde × 256`. Une cellule de terrain = 64 unités monde. Le monde est torique. La grille de collision et de recherche est de 64 × 64 cases de 512 unités (`position >> 17 & 0x3f`). [C]
- Angles : 512 pas pour un tour (tables de sinus `00483186` / `00483986`, valeurs ±256 après `>> 16`). [C]
- **Tick** : une exécution de `FUN_0043c234` (mise à jour du monde), appelée par `gm_poll_events` (`00410bcc`) : l'écart de temps des messages Windows (`msg.time`) est cumulé et un tick part chaque fois que le cumul dépasse **25 ms** (`0x19`) : **40 ticks par seconde**. Le cumul est remis à 0 s'il dépasse 800 ms (pas de rattrapage au-delà). Le chronomètre de fin de niveau est `DAT_005b0404 / 0x28` (40 ticks = 1 s). [C] Le rendu est indépendant (`gm_frame`, une image par tour de boucle).
- Table du joueur : l'objet joueur est un enregistrement de `0x228` octets (pool de 20 à `005a936c`, chaînés par `+0x104`) dont le début est un objet ordinaire. « `+0xNN` » désigne un décalage dans cet enregistrement.

### Champs utiles (objet et joueur)

| Champ | Sens |
|---|---|
| `+0x04` | Drapeaux. Bit `0x40` : mort ou sans collision (ignoré par les collisions et par la recherche du joueur le plus proche) ; bit `0x02` : participe aux collisions ; `& 0x20c == 0x204` : c'est un joueur ; bit `0x10` : véhicule aérien (hélicoptère `0x217`, aéroglisseur `0x217` ; les véhicules roulants `0x207`). [C] Les bits `0x1000`… servent au radar (§ 7.4) |
| `+0x05` | Octet de drapeaux : bit `0x02` d'un joueur = HUD affiché ; bit `0x20` = cible d'objectif enregistrée ; bit `0x10` = cible prioritaire pour le viseur (+4000) ; bit `0x40` = peu prioritaire (−4000) [C] |
| `+0x06` | Octet : bit `0x04` = invulnérable aux dégâts de collision ; `0x80` = vient d'être créé ; bits `0x102` posés par une collision (clignotement de touche, hypothèse [H]) |
| `+0x08` | **Énergie / points de vie** |
| `+0x14`, `+0x18` | Compteurs (durée de vie, ticks depuis le dernier fumigène ou la dernière sélection de cible) |
| `+0x1c / +0x20 / +0x24` | Position x, y (altitude), z |
| `+0x28 / +0x2c / +0x30` | Vitesse |
| `+0x34 / +0x38 / +0x3c` | Cap, tangage, roulis |
| `+0x4c` | Emplacement de modèle (990 : hélicoptère et aéroglisseur, 991 : buggy, skidoo, speeder, 980 : skimmer et roues, 983 : élément du skidoo) |
| `+0x50`, `+0x54` | Paramètres de comportement ; `+0x54` = `1000 + n° de bonus` pour un bonus, `5000 + n° d'objectif` pour une cible d'objectif |
| `+0x58` | Cible courante (viseur, missiles) ou dernier auteur de dégâts |
| `+0x5c` | Propriétaire (un projectile pointe sur le tireur) |
| `+0x64` | Pointeur sur l'enregistrement du bloc 105 d'origine |
| `+0x68` | Fonction appelée à chaque tick (comportement) |
| `+0x90`, `+0x94`, `+0x98` | Joueur : tangage de visée, cap de référence, compteur de tir primaire (incrémenté à chaque tick) |
| `+0x9c` | Joueur : **niveau de puissance du tir primaire** (0 à 19) |
| `+0xa4` | Joueur : véhicule (0 hélicoptère, 1 buggy, 2 skidoo, 3 aéroglisseur, 4 « land speeder », 5 « skimmer » ; 42 et 43 : démo et séquence finale) |
| `+0xa8` | Joueur : fonction de pilotage (`LAB_00439088`, `LAB_0043a174`, … selon le véhicule) |
| `+0xb8…+0xe0` | Joueur : 11 commandes de l'image (avant, arrière, rotation gauche/droite, pas de côté, tir primaire `+0xd0`, tir spécial `+0xd4`, arme suivante `+0xd8`, arme précédente `+0xdc`, modificateur de côté `+0xe0`), recopiées par `FUN_0043ca60`. Axes analogiques `+0xe4…+0xec` [P] |
| `+0x108` | **Score** ; `+0x10c` score affiché (rattrape `+0x108` de 3 par tick) ; `+0x110` score gagné dans ce niveau |
| `+0x118` | Image de la jauge d'énergie (0 à 43) |
| `+0x11c`, `+0x120` | Arme spéciale armée, arme sélectionnée (−1 = aucune) |
| `+0x128` + 4·n | **Munitions** de l'arme n (20 emplacements) |
| `+0x178`, `+0x17c` | État de l'arme spéciale et compteur d'état (§ 3.3) |
| `+0x184` | 1 = vivant |
| `+0x194`, `+0x198` | Compteurs de « secrets » et de bonus ramassés |
| `+0x19c…+0x1a4`, `+0x1a8…+0x1b4` | Objets lanceurs (missiles en attente), roues du buggy |
| `+0x1f8…+0x20c` | 6 emplacements de compagnons ; `+0x210` : bouclier |

## 1. Véhicules et état de départ

- Véhicules, noms de la table 100, ids 200 à 205 : Heli / Hélico, Buggy, Skidoo, Hoovercraft (« Hover Ship »), Land Speeder, Skimmer. Les deux livrés (zone 0, « Temperate Zone ») sont l'hélicoptère et le buggy ; le menu de triche (`gm_menu_pickups` `0041bb40`) propose, selon la zone `DAT_004841b0` : zone 0 hélico + buggy, zone 1 hélico + skidoo, zone 2 buggy, zone 3 buggy + aéroglisseur, zone 4 aéroglisseur, speeder, skimmer. [C]
- `FUN_0043de0c` (changement de véhicule) fixe le modèle (990 pour 0 et 3 ; 991 pour 1, 2 et 4 ; 980 pour 5), la fonction de pilotage et les roues (buggy : 4 objets de modèle 980 ; skidoo : 2 objets 980 et un 983). Vol : véhicules 0 et 3 ; roulants : 1, 2, 4, 5. [C pour la répartition des modèles, P pour « vol / roulant »]
- **Masque de véhicules par arme** (`004843dc[20]`) : toutes les armes sont utilisables par les véhicules 0 à 5 (`0x3f`), sauf **arme 9 « Jump Boost » : véhicules 1, 4, 5 seulement** (`0x32`) et **arme 19 « Thruster » : véhicules 1, 2, 4, 5** (`0x36`) ; les emplacements 0 et 11 (`0x83f`) sont aussi permis au véhicule 43 (bit 11). Le masque est testé à la sélection, à la collecte et à l'affichage. [C]
- **Départ d'un niveau** (`FUN_0043cab4`, appelée par `gm_level_spawn_objects` sur le profil `DAT_004841c0`) : munitions = 20 mots 16 bits du profil (`+0x0c…`), énergie = profil `+0x3c`, niveau de tir primaire = profil `+0x40` ; `gm_level_spawn_objects` pose le véhicule (profil `+0x38`, via `FUN_0043de0c`), le score affiché et réel (profil `+0x34`) et crée le joueur à la position du type 1000 (cap, 80 unités au-dessus du sol). Arme sélectionnée −1. Le profil est modifié par le script des missions (§ 6.1) : au départ de la mission 0, énergie **496**, score 0, véhicule 0 ; missions 1 à 3 : énergie ramenée à au moins **248** (ordre `101 1 248`) ; mission 2 et 3 : véhicule 1 (buggy). [C]
- À la fin d'un niveau réussi (`FUN_0043cd14`, appelée depuis `gm_main_game`), le profil reçoit munitions, énergie, véhicule, score et niveau de tir primaire du joueur : tout est reporté sur la mission suivante. En cas de game over, rien n'est reporté (le niveau se rejoue depuis le profil de départ). [C pour la copie, P pour « rien après game over »]

## 2. Énergie, dégâts, mort

### 2.1 Unités

**496 (`0x1f0`) = 100 %**, **992 (`0x3e0`) = 200 %** (« méga-énergie », barre blanche). Le manuel parle de 100 % / 200 %. L'énergie ne se régénère pas ; seuls les bonus 100, 101, 102 et le bouclier la relèvent. [C pour les bonus, P pour l'absence de régénération : aucune écriture trouvée]

### 2.2 Dégâts de collision

Dans `FUN_0042a084` (appelée à chaque tick, 2 236 octets), deux objets en contact (distance² ≤ `rayon²(modèle +0x0c)` + `FUN_0042a010`, soit 100 si pas de modèle) se font subir **le même dégât** : `min(énergie A, énergie B, 100)`. Chacun perd cette valeur, sauf s'il porte le drapeau « invulnérable » (`+0x06 & 4`). [C]

Conséquences pour le moteur :

- le **dégât d'un projectile = son énergie initiale** (second argument de `FUN_004261a0`) ; un projectile qui conserve de l'énergie après un impact continue sa route (il meurt quand son énergie ≤ 0, ou au contact du sol, ou en fin de durée de vie) ;
- un ennemi de 50 points de vie est tué par une balle de 10 en 5 coups, ou par un missile de 80 (le missile garde 30 et continue) ;
- un choc entre le joueur et un ennemi coûte au joueur `min(énergie ennemi, 100)` ;
- le plafond de 100 par contact fait qu'un ennemi massif ne tue pas en un impact un joueur à 496.

Sont exclus du test : paires où l'un est le propriétaire de l'autre ou le propriétaire du propriétaire (pas de tir ami sur son tireur ni sur ses propres projectiles), objets avec le bit `0x40`, paires où aucun des deux n'a le bit `0x02`. Dégâts si `(A.+4 & 10) + (B.+4 & 10) ≠ 2` (les deux solides, ou un solide et un projectile) ; dans le cas contraire (un seul objet solide, l'autre sans bits `0x02` ni `0x08`) les deux sont seulement repoussés (vitesse ± 4 fois le vecteur de séparation), sans dégâts. Après un dégât les deux sont repoussés plus fort (± 8 fois) et `+0x58` de chacun prend le **propriétaire de l'autre** (crédit du score, § 5). [C]

### 2.3 Sol et eau

- **Hélicoptère** (`FUN_00444af8`, appelée par la fonction de tick du véhicule avec la hauteur de vol `0x50` = 80 unités) : ressort vertical vers `hauteur du sol (max entre la position et 32 unités devant) + 80`, frottements `v −= v/16`. Si l'altitude tombe à moins de 2 000/256 ≈ 7,8 unités du sol, **−10 d'énergie par tick de contact** (plancher 0), rebond dans la direction du terrain le plus bas parmi 16, vitesse verticale 1 000, poussière. [C]
- **Plafond de vol** : `DAT_005b03cc` borne l'altitude du joueur ; valeur `0x7ffffff8` par défaut, remplacée par la hauteur du sol à la coordonnée z de l'objet de type **7900** (`0x1edc`) du niveau. [C]
- **Buggy** : le manuel indique qu'il flotte sur l'eau mais « s'abîme lorsqu'il reste immergé ». Le tick du buggy (`LAB_00445228`) fait `énergie −= 1` par tick sous l'eau [P]. Pas de limite d'altitude (le « turbo » le fait voler : armes 9 et 19).
- Les cratères et l'eau relèvent de R1/R4.

### 2.4 Bouclier (bonus 107)

`FUN_004585c4` crée un objet de modèle 853 (énergie 200, comportement `LAB_00456038`) et relève l'énergie du joueur à au moins 200. À chaque tick, si l'énergie du joueur est descendue sous la valeur mémorisée au tick précédent, **la perte est transférée au bouclier** (le joueur retrouve l'énergie mémorisée, le bouclier perd la différence) ; le bouclier disparaît quand son énergie tombe à 0 (ou si le joueur meurt). Un second bouclier ramassé alors qu'un bouclier existe remet son énergie à 300 et ajoute 496 au joueur (plafond 992). [C]

### 2.5 Mort, game over

- Condition : `énergie < 1` et `+0x184 == 1` et `DAT_005b03e8 == -1` (aucune séquence de fin en cours), testée dans `FUN_0043c234`. [C]
- `FUN_0043b4f4` : le véhicule passe en comportement inerte (`LAB_00438678`), explose (`FUN_00443d3c`), éclate en débris (`FUN_004442ec` : modèles de la table 11004, 3, 5 ou 8 morceaux selon le rayon du modèle) ; pour les véhicules 1 et 2 les roues partent en débris (gros éclats `0044412c`, vitesse aléatoire × 9 : `player.md` §3.6) ; le son de moteur s'arrête ; `+0x184 = 0`. Message « Game over ! » (table 20, id 10). `DAT_005b0414 = 2`, `DAT_005b03e8 = 0`. [C]
- **35 ticks plus tard** (`DAT_005b03e8 == 0x23`) : `DAT_00480a9c = 0x34` (game over) : le niveau s'arrête, la boucle de `gm_main_game` ajoute le temps au profil, affiche l'écran « Game over » (`FUN_00419ed8`, § 6.3) puis **revient au menu** (rejouer la mission, continuer…). [C]
- **Pas de vies, pas de continues, pas de réapparition, pas de temps limite.** Une seule vie par tentative ; aucun test d'invulnérabilité à l'apparition. `DAT_00577670 = 3` du script (variable 3) n'est pas un nombre de vies : ce sont des drapeaux de détail du terrain (bit 0 et bit 1 testés par le tracé du sol et de l'eau, `00425cdd`, `0042695f`). [C]
- Pendant les séquences de fin (`DAT_005b03e8 ≥ 0`) le joueur ne peut plus mourir (condition `== -1`).

## 3. Armes

### 3.1 Tir primaire (canon) [C]

Pas de munitions, pas de surchauffe. Tant que la commande `+0xd0` est tenue, `FUN_0046b6fc` (6 827 octets, appelée par les 7 variantes de fonction de pilotage) tire selon le niveau de puissance `+0x9c`. Le compteur `+0x98` s'incrémente à chaque tick ; **une salve part quand `+0x98 & 0xf == 0`** (soit un tir toutes les 16 ticks = 2,5 par seconde), et, pour certains niveaux, un second groupe quand `+0x98 & 0xf == 3` ou `== 8`. La grille est fixe (ne dépend pas du moment de l'appui). Chaque projectile est créé par `FUN_0046b4b4(type, tireur, vitesse latérale, vitesse verticale, vitesse avant, écart de cap, écart de tangage, énergie)` (arguments reconstitués depuis le désassemblage ; le décompilateur en perd deux) :

| Type de projectile (arg 0) | Objet (`FUN_004261a0`) | Comportement | Durée de vie (ticks) | Particularité |
|---|---|---|---:|---|
| 0 | 10002 (`0x2712`) | `LAB_0044a374` | 28 | [C] `missile_straight` (`004551f0`) : 5 000, tête chercheuse (virage 2) pendant 100 ticks puis vol libre `missile_coast` (sans durée de vie ni plafond d'altitude). Lanceur accroché sous le fuselage (hélicoptère) ou au-dessus (véhicules) pendant l'armement (20 ticks) |
| 1 | 10000 (`0x2710`) | `LAB_0044a374` | 30 | [C] `missile_b` (virage 4), 2 lanceurs à ±4 000, le second part **8 ticks** après le premier (compteur 7). Armement 40 |
| 2 | 10001 (`0x2711`) | `LAB_0044a430` | 40 | [C] 2 nacelles ; après le tir, **8 missiles** (800, 60 pv, `missile_b`) aux ticks 8, 16 … 64, depuis 4 coins `(±500, ±500)` (table `00484468`), nacelles larguées aux ticks 70 et 85, retour à l'état 0 au tick 90. Armement 60 |
| 3 | 10003 (`0x2713`) | `LAB_0044a4f8` | 60 | [C] `gm_upd_cruise_missile` (`00455a98`) : vitesse = `timer` (300, +10 par tick sans cible), spirale 30 ticks (états 10 / 11) puis guidage parmi 7 caps (table `00484564`) ; le second part 8 ticks après. Armement 40 |
| 4 | 800 (`0x320`, modèle de missile) | `LAB_0044a4f8` | 60 | [C] nacelle qui descend ; au tir 5 missiles (800, 60 pv, `missile_b`), un par cap `+0x66` (couronne), chacun cherche sa cible dans son cap (`FUN_0043848c`) ; nacelle larguée |

La vitesse d'écriture est en unités 1/256 par tick : **8 000 = 31,25 unités monde par tick** (1 250 u/s, soit 19,5 cellules par seconde) pour les balles. Une balle meurt à zéro durée de vie, au contact du sol (hauteur du terrain ≥ altitude) ou quand son énergie ≤ 0 ; elle crée alors une petite explosion (type 11000). L'énergie du projectile (dernier argument) est son **dégât** : 10 (balle 0 et 1 en général), 12 (variante), 20 (type 2), 24 (type 4 à puissance 19).

Motifs pour les niveaux de puissance atteignables avec les 4 niveaux livrés (0 à 6, voir § 4.2). Une ligne par phase de tir ; « lat. » est la vitesse latérale (1/256 u par tick, à comparer aux 8 000 de vitesse avant : ±200 ≈ ±1,4°), « vert. » la vitesse verticale, « cap » l'écart de cap en 512ᵉ de tour, « E » l'énergie (dégât) ; type 0 sauf mention :

| `+0x9c` | Phase `& 0xf` | Projectiles |
|---:|---|---|
| 0 | 0 et 3 | 2 balles droit devant, E 10 (à chaque phase : 4 balles par 16 ticks) |
| 1 | 0 | 2 balles, lat. +200 / −200, E 10 |
| 1 | 3 | 1 balle centrale, E 10 |
| 2 | 0 et 3 | 2 balles, lat. +200 / −200, E 10 (à chaque phase) |
| 3 | 0 | 3 balles, lat. +350 / 0 / −350, E 10 |
| 3 | 8 | 2 balles, lat. +200 / −200, E 10 |
| 4 | 0 | éventail de 5 : cap +10 (E 10), +5 (E 12), 0 (**type 1**, E 10), −5, −10 (E 10) |
| 5 | 0 | [C] `gm_upd_super_nova` : 4 500, tangage −3/tick (départ 70) pendant 35 ticks ; puis petite explosion, une balle (10001, 25 pv, classe `0x3b`) par ennemi des 5 × 5 cellules (visée à 32 u/tick si < 282 u) et 10 éclats `10005` (15 pv) |
| 5 | 8 | 3 balles : vert. +300 (E 10) / 0 (E 12) / −300 (E 10) |
| 6 | 0 | [C] `gm_upd_mortar` : fantôme `0x40` lancé à 32 u/tick dans le cap du joueur, vitesse × 30/32, rase le relief à 90 u ; au 40ᵉ tick 35 éclats `10005` (15 pv, ×16) ; super mortier (16) : +20 éclats `10001` (20 pv) |
| 6 | 8 | vert. +400 (E 10), centrale **type 1** (E 12), vert. −400 (E 10) |

Au total le canon tire 2,5 à 5 salves par seconde (grille de 16 ticks, plus des phases intermédiaires). Les niveaux 7 à 19 (jusqu'à 14 projectiles par salve, balles lourdes type 2 d'énergie 20 lancées en cloche, balles à tête chercheuse types 3 et 4 d'énergie 12 à 24, vitesses 4 000 à 8 000) existent dans le code mais ne sont pas atteignables avec les données livrées ; ils s'extraient de `FUN_0046b6fc` (un appel `0046b4b4` par motif dans `disasm.txt`) si une édition complète est visée. [C pour 0 à 6]

**Visée verticale.** `FUN_004599b8` règle `+0x90`, le **tangage de visée** : si la cible `+0x58` est le joueur lui-même, il revient vers 0 par pas de 3 ; sinon il avance du pas (parmi 9 : −15, −8, −3, −1, 0, 1, 3, 8, 15 en 512ᵉ) qui rapproche le plus la direction du tir de la cible. Borné à ±60 (hors bornes : retour à +25 ou −25). Le cap des projectiles est celui du véhicule (`+0x94`, recopie de `+0x34` à chaque tick) plus l'écart du motif : **pas de visée horizontale automatique**, c'est le joueur qui tourne. Le tangage est `+0x90` plus l'écart de tangage du motif ; la vitesse initiale est le vecteur local (latérale, verticale, avant) tourné par le cap et le tangage (`FUN_00456814`) ; les projectiles ne reprennent **pas** la vitesse du véhicule. [C]

### 3.2 Armes spéciales : table des 20 emplacements

Les noms sont ceux de la table 100 (français / anglais). L'icône du HUD est l'image `emplacement + 1` du bloc 501 (image 0 : capsule vide ; image 21 : flèche). Les « munitions » sont celles des bonus (§ 4.1) : **ajout par bonus / plafond** ; les munitions de départ viennent du profil. Chaque tir consomme **1 munition**, quel que soit le nombre de missiles lancés. La colonne « arme » donne les objets créés par `FUN_004261a0(modèle, énergie, …)` dans `FUN_00459f30` (hélicoptère) ; les trois autres fonctions (`0045e128`, `004629e4`, `004672a0`) ont les mêmes lanceurs avec d'autres points de fixation. [C pour modèles, énergies et plafonds ; P pour les comportements]

| N° | Nom FR | Nom EN | Img | Bonus +/max | Véhicules | Projectile (modèle, énergie) | Comportement et effet |
|---:|---|---|---:|---|---|---|---|
| 0 | Missiles | Missiles | 1 | +6 / 100 | tous | 800, 80 | `LAB_004551f0` : vitesse **5 000** (19,5 u/tick), tête chercheuse (virage 2/512 par tick) sur la cible `+0x58` pendant 100 ticks, puis tir balistique (`LAB_00455190`) ; fumigène quand `+0x18 > 4`. Armement 20 ticks |
| 1 | Missiles Autolock | Homing Missiles | 2 | +3 / 60 | tous | 801 ×2, 100 | `LAB_00455278` : vitesse 5 000, virage **4**/512 par tick, 2 missiles (un par côté, le second 7 ticks après). Armement 40 |
| 2 | Multi-tir | MultiFire | 3 | +2 / 30 | tous | nacelle 850 ×2 (100) ; 8 missiles 800 (60) | 2 nacelles larguées, **8 missiles** (un toutes les 8 ticks, depuis les deux nacelles, ordre exact non décodé [H]), chacun comme l'arme 1. Armement 60, salve 90 ticks |
| 3 | Tomawhak | Cruise Missiles | 4 | +3 / 40 | tous | 856 ×2, 100 | `LAB_00455a98` : missile de croisière (paramètre de durée `+0x14 = 300`, vol propre à décoder [H]). Armement 40 |
| 4 | Rocketpak | MultiTarget | 5 | +2 / 20 | tous | nacelle 854 (80) ; 5 missiles 800 (60) | **5 missiles à tête chercheuse en couronne** (5 directions : table `00484238`) |
| 5 | Super Nova | Star Burst | 6 | +2 / 20 | tous | 855, 80 | `LAB_0045754c` : vitesse 4 500, après 35 ticks se désintègre en bombelettes (10001 d'énergie 25, 10005 d'énergie 15) |
| 6 | Bombe Mortier | Mortar Bomb | 7 | +2 / 20 | tous | 811, 30 | `LAB_00457074` : lancée en cloche (gravité double), explose au contact ou après 40 ticks en éclats (10005 énergie 15, 10001 énergie 20) |
| 7 | Bombe | Smart Bomb | 8 | +1 / 10 | tous | 812, 80 | [C] `gm_upd_bomb_fly` : fantôme rasant (40 u), 40 ticks puis onde de 40 ticks : un tick sur deux, tout objet (joueur compris) des 9 × 9 cellules perd `sin(d)·t>>6` avec `d = (dx²+dz²)>>9 + (t−20)·64 ∈ ]0,255[` (rayon réel ≈ 360 à 850 u, pas 2 048) |
| 8 | Napalm | Napalm | 9 | +2 / 20 | tous | 858, 80 | [C] `gm_upd_napalm` : 4 500, pique du 6ᵉ au 11ᵉ tick, goutte (10005, 50 pv, `00457000`) tous les 4 ticks du 18ᵉ au 119ᵉ ; une goutte au sol creuse un cratère (décalque 901) |
| 9 | Super Ressort ! | Jump Boost! | 10 | +1 / 10 | 1, 4, 5 | 981 (`0x3d5`), 80 | [C] (véhicules 1, 2, 4, 5) pilote coupé, `classe &= ~4` ; 30 ticks de cabrage (tangage +4 jusqu'à 90, état 2), poussée 9 000 jusqu'au tick 80 (état 3), fin à l'atterrissage (la physique remet l'état à 0), nacelle larguée |
| 10 | Missiles tri-ogives | Triple Missiles | 11 | +2 / 40 | tous | 800, 70 | version améliorée de 0 |
| 11 | Missiles Faucon | Quad Homing | 12 | +2 / 30 | tous | 801, 100 | [C] 4 lanceurs ; missiles aux ticks 0, 8, 16, 24 de la salve (`missile_b`) |
| 12 | Megacanon | MegaFire | 13 | +2 / 15 | tous | 850 + 857 (80) | version de 2 |
| 13 | Super Tomawhak | Super Cruise | 14 | +3 / 40 | tous | 856, 100 | version de 3 |
| 14 | Missiles Apocalypse | MegaTarget | 15 | +2 / 20 | tous | 854 + 801 (80) | version de 4 |
| 15 | Nucléator | Power Burst | 16 | +1 / 5 | tous | 855, 80 | [C] `gm_upd_nucleator` : 35 ticks puis 3 sous-munitions (10003, 25 pv, vie 30 / 50 / 70, 1 700 u/tick dans 3 caps) qui explosent comme une super nova |
| 16 | Super mortier | Super Mortar | 17 | +2 / 20 | tous | 811, 30 | version de 6 |
| 17 | Méga-bombe | Mega Bomb | 18 | +1 / 10 | tous | 812, 80 | [C] `gm_upd_bomb_shockwave` : onde de 60 ticks, plan x : `d = dx/4 + (t−30)·16 + 128`, perte `sin(d)>>2`, rayon 894 u |
| 18 | Super napalm | Super Napalm | 19 | +2 / 20 | tous | 858, 80 | [C] `gm_upd_super_napalm` : 150 u/tick en semant une goutte tous les 4 ticks du 40ᵉ au 149ᵉ |
| 19 | Accélérateur | Thruster | 20 | **+80 / 500** | 1, 2, 4, 5 | 813 (`0x32d`), 80 | [C] (véhicules 1, 2, 4, 5) tant que le tir spécial est tenu : 1 munition/tick, `vy −= 60`, `v = (2·(sin,cos cap) + v)·14/16` (limite 14 u/tick), fumée ; plus de munition : retrait |

Les armes 10 à 19 ont leurs propres munitions : appuyer sur la touche `n` (0 à 9) sélectionne l'arme `n`, un second appui bascule sur l'arme `n + 10` si elle a des munitions (`FUN_004582dc`). [C]

### 3.3 Machine d'état de l'arme spéciale (`FUN_00459c80`) [C]

`+0x178` (état) et `+0x17c` (compteur) :

| État | Rôle |
|---:|---|
| 0, 1 | crée les objets lanceurs (missiles accrochés au véhicule) puis passe à l'état 2 |
| 2 | armement : le missile sort du véhicule, `+0x17c` monte ; à la valeur d'armement de l'arme (20, 40 ou 60 ticks) → état 10 |
| 10 | **armé**, prêt à tirer (maintenu en pause : `FUN_004580f0` positionne le missile) |
| 0x0b | **tir** : `munitions[arme] −= 1`, son 2000 (« tir »), le missile reçoit son comportement de vol, `+0x58` = cible courante |
| 0x0c, 0x0d | salve en cours (armes à plusieurs missiles) |
| 1 (après tir) | réarmement du missile suivant |
| 0x14 → 0x16 | arme changée ou plus de munition : rétractation, son 3001, puis |
| 0x1e | resélection automatique : première arme possédée (munitions > 0, véhicule autorisé) en partant de l'emplacement 0, ou « aucune » (−1) |

Le tir spécial (`+0xd4`) ne fait que passer de l'état 10 à l'état 0x0b (`FUN_00458590`) : il n'y a donc pas de tir tant que l'arme n'est pas armée. Si la munition est nulle à l'état 0 ou 1, passage à l'état 0x1e. Sélection suivante / précédente (`+0xd8`, `+0xdc`, molette) : `FUN_004582dc` avec −1 / −2, saute les armes sans munitions ou interdites au véhicule ; touches 1 à 9 : sélection directe (§ 3.2).

### 3.4 Cible, verrouillage, tête chercheuse [C]

- `FUN_00438198` choisit la cible `+0x58` parmi les objets des 7 × 7 cases voisines (`FUN_0042af88(3, 0)`) : score = produit scalaire entre la direction du viseur et le vecteur vers l'objet, avec un biais **+4 000** si l'objet a le bit `+0x05 & 0x10` (objectif), **−6 000** s'il a `+0x04 & 8`, **−4 000** s'il a `+0x05 & 0x40`. La cible n'est recalculée que si le compteur `+0x18` dépasse **60** (vitesse² < 30), **35** (< 140) ou **7** (au-delà) puis remis à zéro.
- `FUN_00454ce0(missile, virage, classe)` (tête chercheuse) : à chaque tick, vitesse = `vitesse(classe) × direction (cap, tangage)` — classe 0 : **5 000**, classe 2 : 900, classe 10 : **7 000** (en 1/256 unité par tick), classe 1 : vers le haut (cible fictive à la verticale). Si la cible n'est plus vivante (`+4 == 0`) elle est remplacée par le tireur. Quand la cible n'est ni le tireur ni le missile et que `+0x18 < 6`, le missile compare 5 directions candidates (table `0048442c` : droit devant, ±44/1000 à gauche, à droite, en haut, en bas) et tourne de `virage` pas de 1/512 de tour dans le sens de la meilleure (cap − / + ou tangage + / −) ; direction « devant » : pas de correction. [C]
- Fumigènes : `FUN_00444084(seuil)` crée une bouffée (type 11001) quand `+0x18 > seuil` puis remet `+0x18` à 0.

### 3.5 Compagnons (bonus 105, 106, 108) [C]

Jusqu'à 6 (`+0x1f8…`), classe `0x14` (modèles 851, 852, 810 ; pv 250, 70, 70), placés par `FUN_0043c234` ; ressort vertical à 90 u du relief (raideur 4 en montée, 2 en descente, frottement 29/32), vitesse horizontale du joueur.

| Bonus | Comportement | Tir |
|---:|---|---|
| 105 verrouillage (`004560e4`) | cible = celle du joueur, se tourne de 3 pas | joueur tenant le tir principal : 4 balles `10002` (8 pv, 9 000) en croix, ±150 latéral au tick `&0x1f = 7`, ±150 vertical au tick 0 |
| 106 tir auto (`00456abc`) | cherche une cible tous les 10 ticks (rayon 1, classe `0x45 == 1`) | cap bon : balle `10000` (14 pv) aux ticks `&0xf` = 0 et 3 |
| 108 super (`00456658`) | cap du joueur, tangage 0 | tir tenu : missile `10001` (20 pv, classe 10 : 7 000, virage 2) tous les 32 ticks |

## 4. Bonus

### 4.1 Effets (`FUN_004585c4`, `gm_pickup_apply`) [C]

`n` = identifiant du bonus. La collecte n'est possible que si la valeur est sous son plafond (test `FUN_00458f88`) : « si vous passez sur un bonus et que rien ne se passe, c'est que le maximum est atteint » (manuel).

| N° | Nom (FR / EN) | Effet | Plafond |
|---:|---|---|---|
| 0 à 19 | noms d'armes (§ 3.2) | munitions de l'arme `n` : +6, +3, +2, +3, +2, +2, +2, +1, +2, +1, +2, +2, +2, +3, +2, +1, +2, +1, +2, +80 | 100, 60, 30, 40, 20, 20, 20, 10, 20, 10, 40, 30, 15, 40, 20, 5, 20, 10, 20, 500 |
| 100 | 10 % vie / 10 % Health | énergie **+49** | 496 |
| 101 | 25 % vie / 25 % Health | énergie **+124** | 496 |
| 102 | Méga-vie / Mega Health | énergie **+496** | 992 |
| 105 | Module de verrouillage / Tracking Buddy | compagnon (§ 3.5), s'il reste un emplacement | 6 compagnons |
| 106 | Module de tir auto / Auto Buddy | compagnon | 6 |
| 107 | Bouclier / Shield | bouclier (§ 2.4) | un seul actif (le second le recharge) |
| 108 | Super Module / Super Buddy | compagnon | 6 |
| 109 | (sans nom) | aucun effet | — |
| 110 à 113 | Power Up | **+1 niveau de tir primaire** si `+0x9c` < 4 (110), 9 (111), 14 (112), 19 (113) ; la collecte est permise tant que le niveau est < 19 | 19 |

Après l'effet, si aucune arme n'est sélectionnée (`+0x11c == −1`), que le bonus est une arme (`n < 0x15`) et que le véhicule est autorisé, **l'arme est sélectionnée automatiquement** (état 0). [C]

### 4.2 Bonus dans les niveaux (bloc 105 : champ 7 = `1000 + n`) [C]

Valeurs relevées dans les niveaux livrés : (nombre d'objets de type 7000)

| Niveau | Bonus (n : nombre) |
|---|---|
| TERRAN00 | 0 : 23 ; 1 : 11 ; 101 : 11 ; 107 : 1 ; 110 : 2 |
| TERRAN01 | 0 : 41 ; 1 : 16 ; 7 : 1 ; 10 : 2 ; 101 : 32 ; 105 : 1 ; 107 : 1 ; 110 : 2 |
| TERRAN02 | 0 : 14 ; 1 : 17 ; 3 : 1 ; 5 : 2 ; 6 : 4 ; 7 : 2 ; 9 : 1 ; 11 : 1 ; 101 : 28 ; 105 : 1 ; 107 : 1 ; 110 : 1 |
| TERRAN03 | 0 : 1 ; 1 : 11 ; 2 : 5 ; 3 : 1 ; 5 : 2 ; 7 : 5 ; 8 : 2 ; 10 : 11 ; 11 : 3 ; 18 : 2 ; 100 : 3 ; 101 : 10 ; 102 : 1 ; 110 : 2 ; 111 : 2 |

Les Power Up présents sont 110 (dans les quatre niveaux, 2 + 2 + 1 + 2) et 111 (TERRAN03, 2) ; les caches 7002 de TERRAN03 contiennent en plus les bonus 9 (×4) et 19 (×1). Un bonus 110 n'agit que si le niveau est < 4 ; 111 que si le niveau est < 9. Avec un joueur qui prend tout, le niveau du tir primaire passe de 0 à **4** à la fin de TERRAN01, reste à 4 en TERRAN02, et atteint **6** en TERRAN03 (les deux 111). Les niveaux 7 à 19 du § 3.1 ne sont donc pas atteignables avec les données livrées. [P, d'après les ensembles de bonus ; le plafond par bonus est lu dans le code]

### 4.3 Objets de bonus : types 7000, 7001, 7002 [C]

- **Type 7000** : objet d'ancrage (comportement générique `LAB_00446d24`, énergie 0) + un objet bonus (`LAB_004469fc`, `+0x54 = champ 7`). Compté dans `DAT_005b03d8` (total des bonus du niveau).
- **Type 7001** (`LAB_004468cc`) : bonus **caché**, créé (flags `0x41`, comportement `004469fc`) quand `DAT_005af3a4 == 1` : c'est-à-dire quand le seul objectif restant est l'objectif final (§ 6.2).
- **Type 7002** (`LAB_00446964`) : bonus caché créé quand `DAT_005b03e4 == 9` : l'objectif n° 1 (indice 9) a été détruit.
- Un objet de type 2000 (cible détruisible) dont le champ 7 est dans `[1000, 2000)` est un « secret » : compté dans `DAT_005b03f4` ; il dépose le bonus `champ 7 − 1000` quand on le détruit, et le ramasser incrémente `+0x194` (« secrets trouvés », § 6.3) [P : le dépôt n'est pas lu en détail ; le décompte de `+0x194` l'est, `LAB_00446a3c`].
- **Comportement d'un bonus ramassable** (`FUN_004463c0`, `LAB_004469fc`, trois états `+0x50`) : état 0 : flotte à `sol + 6 000/256 ≈ 23` unités avec une oscillation de ±8 unités (`sin` de `+0x14`), tourne sur lui-même. Toutes les 32 ticks (`+0x18 & 0x1f == 0`) il cherche le joueur le plus proche à moins de 2 449 unités (`FUN_0043c164`, d² < 6 000 000, résultat dans `+0x58`). Il est **collecté** quand la distance horizontale est < **100 unités** (`dx² + dz² < 10 000`) et que `FUN_00458f88` répond oui (valeur sous son plafond) : le nom du bonus est alors affiché (message flottant, § 8) et il passe à l'état 2 (véhicule roulant : `+0x14 = 70`, son 4002) ou 1 (véhicule aérien, `+4 & 0x10` : `+0x14 = 130`, son 4000). Pendant 70 / 130 ticks il est **attiré vers le véhicule** (décompte `+0x14`) en tirant légèrement le véhicule vers lui ; quand `+0x14 < 11`, il disparaît, **l'effet est appliqué** (`FUN_004585c4`) et `FUN_0043ce6c(obj, 0)` est appelée (un bonus peut donc être aussi une cible d'objectif). Les bonus ramassés incrémentent `+0x198` du joueur (« bonus ramassés »). [C]
- **Types 7010 à 7013** (`LAB_004482dc`, `LAB_004495f8`) : plateformes de **changement de véhicule** (« bases où vous pouvez changer de véhicule », manuel) ; elles appellent `FUN_0043de0c`. TERRAN02 a un 7010 et un 7011, TERRAN03 deux 7011 (et cinq 7002). [P]
- **Type 7020** (`LAB_004493e8`) : zone d'extraction : si le joueur (`+4 & 0x20c == 0x204`) passe à moins de **~948 unités** (`d² < 0xdbba0`), `FUN_0043ce6c(obj, 1)` est appelée et le pilotage du joueur passe en automatique (`+0xa8 = 0x438694`) : fin de niveau en 400 ticks. Absent des niveaux livrés. [C pour le code, H pour le type exact]

## 5. Score

`FUN_0042ebc4(objet détruit, points)` (94 octets) est appelée par le comportement de chaque cible à sa mort. Elle remonte `objet.+0x58` (dernier auteur) puis son propriétaire `.+0x5c` puis le propriétaire de celui-ci (le joueur d'un projectile de joueur, ou d'un compagnon) ; si ce propriétaire est un joueur (`+4 & 0x20c == 0x204`), elle ajoute les points à `+0x108` (score) **et** à `+0x110` (score du niveau). Aucun autre mécanisme de points : **pas de bonus de temps, pas de points de bonus, pas de multiplicateur**. [C]

| Points | Comportement (adresse) | Types d'objet (bloc 105) |
|---:|---|---|
| 73 | `00446d24` | 2000, 2001, 2002, 2003 (cibles détruisibles génériques, énergie 50) et 2004 |
| 111 | `0044ac88`, `0044b310` | 3000 (corps), enfant de 3002 |
| 59 | `0044b178`, `0044bca8`, `0044bfb8`, `0044cba0`, `0044cc78`, `0044cf1c`, `0044d218`, `0044ea08`, `0044eff0`, `0044f248`, `0044f4a0`, `0044f858` | 3002, 3100, 5000 à 5005, 5010, 5500, 5501, 4100, 4101 et leurs enfants |
| 500 | `0044d804`, `0044df98`, `0044e0f8`, `0044e2d8` | 6000, 6100, 6101, 6110 |
| 50 | `0044d938`, `0044db38` (sous-comportements de 6000) | tourelles de 6000 |
| 210 | `0044e438`, `0044e758`, `004516f4` | 4001, 4002 (énergie 30) ; `004516f4` : rattachement non établi |
| 1 742 | `0044edc8` | 6200 |
| **10 000** | `0044fef0`, `004505dc`, `00450de8`, `00451100` | 8000, 8001, 8010, 3200, 3201, 8020 (« boss ») |

Le rattachement type → comportement vient de `gm_level_spawn_objects` (`0043e958`) : [C] ; les noms des types (char, navire, tourelle…) sont à reprendre de R2 (`objects.md`). Le type 3001 (`LAB_0044b848` : objet qui tire avec `FUN_0046d1f8`, probablement une tourelle) n'accorde aucun point, ni le type 7000. [C pour l'absence d'appel à `gm_score_add`]

- **Affichage** : `+0x108` est le score réel ; `+0x10c` est la valeur affichée, qui le rattrape de **3 par tick** (1 par tick quand l'écart est de 1 ou 2). [C]
- **Fin de niveau** : « Score » = `+0x108` (total depuis le début de l'aventure, reporté dans le profil) ; « Score du niveau » = `+0x110`. [C]
- **Meilleurs scores** : aucun enregistrement de meilleur score n'a été trouvé sur le chemin de jeu. Le profil conserve le score courant (`+0x34`), la mission la plus haute (`+0x20`), le temps total (`+0x2c`) ; la table de chaînes 10 (« Meilleurs scores », « Meilleurs scores pour [%s] », « Jeu entier », « Un autre super score ! ») existe mais son écran n'a pas été identifié. [C pour l'absence dans le chemin de jeu, H pour le reste]

## 6. Objectifs, fin de niveau, enchaînement

### 6.1 Script des missions (bloc 600, rappel de `global-bd.md`)

Pour chaque mission (200 n), le script pose les variables du profil, joue le briefing Smacker (`BR_TERn`), règle les pistes CD (400) et la couleur d'ambiance (600), puis charge le niveau (300). Variables : 0 véhicule (`+0x38`), 1 énergie (`+0x3c`), 2 score (`+0x34`), 3 drapeaux de détail du terrain, 4 zone, 109 et 119 remises à 0. Valeurs : mission 0 : énergie 496 ; missions 1 à 3 : énergie ≥ 248 ; missions 2 et 3 : véhicule 1. [C]

### 6.2 Objectifs [C]

- Un objet de type 2000 (le seul utilisé dans les niveaux livrés ; le code accepte aussi 2002, 2003 et 2004) dont le champ 7 est dans **5000 à 5009** est une **cible d'objectif** d'indice `champ 7 − 5000` (0 à 9). `FUN_0043cda4` l'inscrit (bit `+0x05 & 0x20`) dans une liste triée par indice **décroissant** : l'objectif courant est la tête de liste (le plus grand indice). Les indices 9, 8, 7… sont affichés « Objectif 1 », « Objectif 2 », « Objectif 3 » (table 20 : id `n` = « Objectif `10 − n` », id 0 = « Accompli », id 10 = « Game over ! »). L'**indice 0 est l'objectif final**.
- Niveaux livrés (cibles par indice) : TERRAN00 : 9 (6), 0 (3) ; TERRAN01 : 9 (12), 8 (9), 7 (9), 0 (6) ; TERRAN02 : 9 (13), 8 (7), 7 (9), 0 (10) ; TERRAN03 : 9 (16), 8 (6), 0 (10).
- À sa mort, une cible appelle `FUN_0043ce6c(objet, 0)` : elle est retirée de la liste (`DAT_005b0400++`) ; s'il ne reste plus aucune cible du même indice, **l'objectif est accompli** : message flottant « Objectif N » (table 20, id = indice), et si l'indice était 9, `DAT_005b03e4 = 9` (déclenche les bonus 7002). Si, après ce retrait, la tête de liste est l'indice 0, `DAT_005af3a4 = 1` (« objectif final » : déclenche les bonus 7001). [C]
- **Objectif final accompli** (indice 0, partie « réelle » : `DAT_00480a9c == 1`) : message « Accompli » (table 20, id 0), `DAT_005b0414 = 1` et `DAT_005b03e8 = 0` : voir § 6.3. [C]
- Il n'y a pas d'objectif « atteindre un point » dans les niveaux livrés, mais le type 7020 en implémente un (§ 4.3). Pas de condition de temps. Détruire tous les objectifs dans l'ordre n'est pas imposé par le moteur : seule la tête de liste est pointée par le radar ; rien n'empêche de détruire un objectif plus bas, seul l'accomplissement et les bonus cachés suivent l'ordre. [C pour le code, P pour l'absence d'obligation]

### 6.3 Séquences de fin (`FUN_0043c234`) [C]

`DAT_005b0414` (état) et `DAT_005b03e8` (compteur de ticks, −1 = inactif) :

- **Victoire** (état 1) : au tick 25, `FUN_0043c07c` donne au véhicule son pilotage de fin (`LAB_00438d08`, `LAB_00438ec8`, `LAB_00438fb8`, `LAB_00438de8` selon le véhicule) et `+0x184 = 0` ; au tick 55, `DAT_00480a9c = 0x2a` (**niveau accompli**) ; le niveau s'arrête.
- **Victoire par zone d'extraction** (état 100, compteur initial 80) : au tick 400, `DAT_00480a9c = 0x2a`, message « Accompli ».
- **Mort** (état 2) : au tick 35, `DAT_00480a9c = 0x34`.
- **Écran de fin de niveau** (`gm_screen_level_complete` `004194b0`, chaînes de la table 7) : « Mission accomplie ! », nom de la mission (table 200), « Score : %d » (score du niveau et score total), « Temps : %dh %02dm %02ds », « Durée totale : … », « Objectifs détruits : %d%% » = `DAT_005b0400 × 100 / DAT_005b03e0` (cibles d'objectif détruites / inscrites), « Bonus ramassés : %d%% » = `+0x198 × 100 / DAT_005b03d8` (affiché s'il est non nul), « Secrets trouvés : %d%% » = `+0x194 × 100 / DAT_005b03f4` (affiché s'il est non nul), « N'importe quelle touche pour continuer » (table 4, id 1). L'écran « Game over » (`FUN_00419ed8`) affiche le titre « Game over » (table 7, id 1), le nom de la mission, les scores et le ratio d'objectifs. [C]
- Dans les deux cas, `piVar1[0xb]` (temps total du profil) augmente de `DAT_005b0404 / 40` secondes.
- **Enchaînement** : après `0x2a`, `FUN_0043cd14` reporte l'état du joueur dans le profil, `gm_cfg_save` écrit le fichier de configuration (sauvegarde de la progression à chaque niveau accompli), puis la boucle du script **passe à l'élément suivant** : mission suivante (nouveau `200`, briefing, niveau) ; après TERRAN03 : `200 999`, `-2` (progression `0xb4c69`), `-1` (fin du script, retour au menu). Après `0x34` ou `2` (abandon, `gm_menu_abort` sur la touche de pause/échap) la boucle sort vers le menu principal. [C]

## 7. HUD (`gm_draw_hud`, `0042ec80`) [C sauf mention]

Le HUD n'est tracé que si `DAT_00480c5c != 0` (mis à 0 pour la séquence cinématique du type 1002) et si le bit `+0x05 & 2` du joueur est posé. Tous les sprites du bloc 501 se tracent avec `FUN_00414c7e` (teinte pleine) ; `FUN_004151c3` en est la variante **à demi-teinte** (la teinte lue est divisée par 2 : icônes non sélectionnées plus pâles).

### 7.1 Arme spéciale (bas à gauche)

| Élément | Position (x, y) | Contenu |
|---|---|---|
| Icône de l'arme sélectionnée | (4, 354) | image `arme + 1` du bloc 501 (24 × 38) ; image 0 (capsule vide) si aucune arme (`+0x120 == −1`) ; teinte pleine |
| Munitions | (30, 354), aligné à gauche | `"x%02d"` (`x` minuscule puis deux chiffres) |
| Nom de l'arme | (30, 372), aligné à gauche | chaîne de la table 100, id = emplacement (« Missiles », « Bombe »…), mise en cache tant que l'arme ne change pas |
| Liste des armes suivantes | (4, 309), puis `y −= 40` | jusqu'à **5 icônes** (y = 309, 269, 229, 189, 149) de `FUN_004151c3` : les armes possédées (munitions > 0 **et** autorisées au véhicule) en partant de l'emplacement suivant l'arme sélectionnée, en cyclant sur 20 ; si une sixième existe, la **flèche** (image 21) à y = 109 |

### 7.2 Score

`"%07d"` du score affiché `+0x10c`, **aligné à droite**, bord droit x = 310 (`0x136`), y = 370 (`0x172`), police 2D du bloc 507 (`gm_draw_text` `004229c8`). En multijoueur (`DAT_00480c50 != 0`) : une ligne `"%s %2d"` (nom, score) par joueur actif, de y = 370 en remontant de 16. [C]

### 7.3 Jauge d'énergie (haut à droite)

Image du bloc 503 d'indice `+0x118` (0 à 43) : sprite 20 × 81, tracé en **x = 292 (`0x124`), y = 10** (occupe x 292-311, y 10-90) par `FUN_00437af0` (chaque octet est une ligne de la table de mélange 800 ; `0xf0` = transparent). [C]

- **Clignotement** : si l'énergie `+0x08` est **< 100** (≈ 20 %), la jauge n'est tracée que si `(DAT_00481154 & 0x1f) < 0x14` : visible 20 ticks sur 32. Sinon tracée en permanence. [C]
- **Indice** : cible = `énergie >> 5`, bornée à 0..31 ; si cible > 15, `+12`. Donc 0 à 511 d'énergie → images 0 à 15 (barre grise : 496 = image 15 = 100 %), 512 et plus → images 28 à 43 (barre blanche : 992 = image 43), les images 16 à 27 sont une animation de transition. `FUN_0043c234` fait avancer `+0x118` d'**un pas tous les 2 ticks** vers la cible ; le **son 4001** est joué en franchissant l'image 16 à la hausse et l'image 26 à la baisse. [C]
- La jauge est tracée **avant** le texte du nom de mission.

### 7.4 Radar et boussole (haut à gauche)

Fonction `gm_draw_overlay_sw` (`004362b8`), appelée par `gm_frame` avec la carte de couleurs 103 du niveau. Tout est dessiné dans l'origine de l'écran (0, 0). [C sauf mention]

1. **Fond** : un morceau de la carte 103 (512 × 512, vue de dessus colorée), échantillonné **tourné autour du joueur** (angle = `cap & 0x1fc`, avec 64 colonnes d'écran et un profil ovale précalculé à `0048121c`), centré autour de (34, 55). [C pour la mise en œuvre, H pour l'échelle exacte : non établie]
2. **Points d'objets** : tous les objets (`FUN_0042af88(4, 0)`, ±4 cases = ±2 048 unités) : décalage `(Δ >> 13)` en coordonnées 24.8 soit **1 pixel = 32 unités monde**, tourné de l'angle du joueur ; vertical étiré par `0x1ab / 256` (≈ 1,67, pixels non carrés) ; visible si `dx² + dy² < 600` (rayon ≈ **24,5 pixels** ≈ 784 unités). Un point (1 pixel large, 2 de haut) est tracé en (34 + dx, 55 − dy). La couleur est `table[(ligne << 8) | 0x7f]` où la table est celle de 8 Ko du bloc 11003 du niveau (`DAT_005bc158`, octets `0x300…` du bloc) :

| Classe d'objet (`+0x04 & 0x787f`) | Ligne | Indice de palette (TERRAN00) | Couleur (RVB 8 bits) |
|---|---:|---:|---|
| `0x001` | `0x14` | 213 | jaune (164, 164, 56) |
| `0x007`, `0x017` | `0x04` | 16 | vert (16, 84, 12) |
| `0x1001`, `0x1003`, `0x1013`, `0x1023`, `0x1033` | `0x10` | 109 | **rouge** (176, 8, 8) : objets hostiles |
| `0x041` (bonus, drapeaux `0x41`) | table `004811c0[(+0x18) & 3]` = {`0x17f`, `0x17f`, `0`, `0`} | 155 ou transparent | **bleu clignotant** (28, 32, 120) |
| autres, si `DAT_00480c80 == 1` (mode touche `DAT_00490108`) | `0x15` | 137 | gris (164, 164, 164) |
| autres | — | — | non tracés |

3. **Cibles d'objectifs** (liste `DAT_005af3a8`) : une petite croix de 4 pixels (x ± 1 autour de x0 = dx + 32, y de y0 = 52 − dy) : ligne `0x17f` (bleu 155) pour les objectifs en attente, ligne `0x107f` (rouge) pour ceux de l'objectif courant (même indice que la tête de liste).
4. **Cadres** : après le fond et les points, trois sprites RLE aux coordonnées (0, 0) : `005bc174` (bloc **512**, 128 images, image `(pointeur − (cap & 0x1fc)) >> 2 & 0x7f`), `005bc178` (bloc **510**, 32 images, image `A & 0x1f`) et `005bc170` (bloc **511**, 128 images, image `A & 0x7f`) avec `A = (−(cap & 0x1fc) >> 2) & 0x7f` : un pas d'image = 4/512 de tour. Le sprite 510 est le cadre ovale, le 511 le repère du Nord, le 512 le **pointeur vers l'objectif**. [C pour les blocs, P pour les rôles]
5. **Pointeur d'objectif** (`param_2[0x19]` de la vue) : angle qui suit la direction de l'objectif courant (tête de liste `DAT_005af3a8`, position relative au joueur) ; à chaque image, parmi 5 essais (`0, −4, +4, −170, +170`) on garde celui qui maximise le produit scalaire avec la direction réelle, donc une rotation de ±4/512 de tour par image au maximum. Sans cible, il tourne de 8 par image. [C]

### 7.5 Viseurs (réticules) [C]

Deux séries de 16 images du bloc 506 (29 × 40, dont 28 colonnes tracées), tracées par `gm_draw_crosshair` (`00437c38`, `EAX` = x, `EDX` = y, `EBX` = image) à la fin de `gm_render_view`, à travers la table 109 (0 = transparent). Les images 0 à 15 sont une **ellipse jaune** (viseur extérieur), les images 16 à 31 un **carré rouge** (vérifié en rendant le bloc avec la palette du niveau). Qui suit quoi est fixé par la boucle des objets de `gm_render_terrain` (`0042718c`, `00427fbf` à `004280b1`), qui pose deux cibles à l'écran :

| Viseur | Série | Suit | Condition |
|---|---|---|---|
| A (`005774dc/e0/e4`) | jaune, image `0..15` | l'objet que `+0x58` du joueur désigne (la cible choisie par `FUN_00438198`, § 3.4) | `+0x58` ≠ joueur |
| B (`005774d0/d4/cc`) | rouge, image `16 + (0..15)` | l'objet de la tête de la liste des objectifs (`DAT_005af3a8`, champ `+4`) | liste non vide **et** `+0x58` ≠ joueur |

Un viseur n'existe donc que si le joueur a une cible (pas de viseur « au point visé » sans cible). Le rouge reste sur l'objectif en tête, que le joueur l'ait ciblé ou non : quand les deux coïncident, la cible est l'objectif (jaune et rouge alignés). Chaque objet est projeté depuis son origine (`+0x1c`, `+0x20`, `+0x24` >> 8) par la vue ; un objet n'a de viseur que si sa profondeur `D` (sans le recul `0x19`) est dans `]-10, 2000[` et si sa position à l'écran est à moins de `largeur + 0x14` en x et `hauteur + 0x1e` en y du centre. L'image demandée est `clamp((D >> 6) - 11, 0, 15)`. `gm_render_view` fait le lissage, un état par viseur (`+0x4c/0x50/0x54` et `+0x58/0x5c/0x60` de la vue) : un viseur absent à une image perd son état ; au premier affichage position et image sont celles demandées ; ensuite l'image avance de 1 vers la demandée et `p += (demandée − p) >> 1` pour x et y à chaque image. Le A est tracé avant le B. Le tracé : 28 colonnes de x − 14 à x + 13, 40 lignes de y − 20, `dst = table109[src << 8 | dst]`. En pause (`gm_screen_pause`), les viseurs restent (ils appartiennent à la vue).

### 7.6 Textes

- **Nom de la mission** : tant que `DAT_00480c68 > 0` (initialisé à `0x50` = 80 par le chargement du niveau, décrémenté à chaque tick par `gm_poll_events` : 2 s), chaîne de la table 200 (id `DAT_00480c4c`, la mission courante : « Fastoche », « Chercher et Détruire », « L'Estuaire Sanglant », « Montagnes Russes ») centrée sur **x = 160 (`DAT_00480bf8`), y = 10**. [C]
- Tous les autres textes de jeu sont des **messages flottants en 3D** (§ 8).

## 8. Messages en jeu (`FUN_00422f8c`) [C]

`gm_message_spawn` (`00422f8c`) prend `EAX` = table, `EDX` = id, `EBX` = teinte, `ECX` = type (le décompilé range ces arguments de travers) et ajoute dans un pool de **50** messages le texte `gm_get_string(table, id)` (`|` = saut de ligne). Le texte est dessiné par `gm_message_draw` (`00424454`, appelée dans `gm_frame` après la file vidée, donc **par-dessus le HUD**) avec la **police vectorielle 3D** du bloc 200 (`gm_text3d_emit_glyph` `00423974`), en faces pleines (`gm_draw_flat_tri` `004359c8`). Aucun empilement : plusieurs messages se superposent au même endroit.

### 8.1 Types et trajectoires

Seuls trois types sont utilisés ; le spawn n'initialise rien pour les autres. Un message a une position `P` (`+8, +0xc, +0x10`), une vitesse `V` (`+0x14..`), des angles `A` (`+0x20..`, 16 par pas de 1/512 de tour), leur vitesse `W` (`+0x2c..`), une vie `L` (`+0x38`) et un décalage vertical `Y` (`+0x40`, pixels). À la création, `P −= V` et `A −= W` sont répétés **N fois** (pré-simulation : le message arrive de loin).

| Type | `P` | `V` | `A` | `W` | `L` | `Y` | N |
|---:|---|---|---|---|---:|---:|---:|
| 0 | (0, −40000, 0) | (6400, −3000, 7000) | (−480, 240, 160) | (32, 63, 44) | 70 | 0 | 60 |
| 10 | (0, 0, 0) | (−6400, −3000, 7000) | (300, 0, 0) | (0, 45, 0) | 1080 | −140 | 80 |
| 11 | (0, 0, 0) | (6400, −5000, 8000) | (300, 0, 0) | (0, 45, 0) | 1031 | −140 | 30 |

`gm_effects_tick` (`004234ec`, un appel par tick de 25 ms de `gm_poll_events` quand le drapeau 4 est posé : en jeu **et** dans les menus) fait, pour chaque message : si `L ≠ 1000`, `L--` ; si `L < 0`, le message est libéré ; sinon si `L > 10`, `A += W` ; si `L ≠ 1000`, `P += V`. Conséquences :

- **Type 0** (ramassage d'arme ou de bonus, objectif de groupe) : il arrive, passe à `(0, −40000, 0)` au tick 60, file ensuite ; libéré quand `L` passe sous 0 : **71 ticks (1,78 s)**, rotation arrêtée aux 10 derniers. `MESSAGE_TICKS` (`engine/game.ts`) vaut 71 : la liste du monde suit cette durée et le HUD joue la trajectoire dans son pool.
- **Types 10 et 11** : `L` descend jusqu'à **1000** puis le message **se fige** (plus de décompte ni de déplacement ; il continue de tourner autour de l'axe y de 45 / 16 pas par tick). Il y reste jusqu'à `gm_title_release` (`004235d8`, appelée à la sortie de chaque menu), qui retire `0x3d4` aux vies ≥ 1000 : il repart alors et disparaît en 21 ticks. Type 10 : « Game over ! » (20, 10, teinte `0x1000`) et « Accompli » (20, 0, teinte `0x1400`) ; type 11 : titres de menu, dont « Pause » (4, 0, teinte `0x400`).

### 8.2 Appels

| Déclencheur | Table, id | Teinte | Type |
|---|---|---|---:|
| Ramassage d'une arme (`FUN_00458f88`, ids 0 à 19) | 100, `n` | `0x1000` | 0 |
| Ramassage de bonus 100 à 102 et 105 à 108 | 100, `n` | `0x400` | 0 |
| Ramassage de bonus 110 à 113 | 100, `n` | `0x100` | 0 |
| Objectif de groupe accompli (`gm_objective_unregister` `0043ce6c`) | 20, indice | `0x1400` | 0 |
| Objectif final accompli (même fonction, indice 0, `param_2 == 0`) ; zone d'extraction (`0043c314`) | 20, 0 (« Accompli ») | `0x1400` | 10 |
| Mort du joueur (`0043c046`, `gm_player_die`) | 20, 10 (« Game over ! ») | `0x1000` | 10 |
| Écran de pause (`gm_screen_pause` `00419058`) | 4, 0 (« Pause ») | `0x400` | 11 |
| Titres de tous les menus (table, id et teinte propres à chaque menu : `screens.md` § 4.1) | … | `0x100` à `0x1500` | 11 |

La teinte est une ligne × 256 de la **table d'attributs du bloc 11003** (`005bc158`, 8 192 octets à `+0x300`, la même que celle des points du radar) : `0x1000` rouge, `0x1400`, `0x400`, `0x100` les autres familles. La couleur d'une face est `table[teinte + lumière]`, lumière de 0 à 127.

### 8.3 Mise en page, projection et lumière (`00424454`, `00423974`)

Une ligne est centrée : avance d'une lettre `(largeur >> 2) + 5` (`largeur` = champ `+0` de l'enregistrement du bloc 200, 45 pour un emplacement vide ; l'espace, `-` et `'` n'ont pas de triangle mais avancent), lettre `i` centrée en `(−S + 2·Σ_{j<i} a_j + a_i) · 4`, `S` = somme des avances de la ligne. La première ligne est à `150 · (nombre de |)` et chaque ligne suivante 300 plus bas. Pour chaque sommet `(x, y, z)` du glyphe (avec `SIN`/`COS` = tables 256 de `render.md` § 4.2, `a1, a2, a3` = `A >> 4 & 0x1ff`) :

```ts
const px = (x + offX) * 4, py = (y + offY) * 4, pz = z * 4;
const y1 = (COS[a1] * py - SIN[a1] * pz) >> 8,  z1 = (COS[a1] * pz + SIN[a1] * py) >> 8;
const x2 = (px * COS[a2] - SIN[a2] * z1) >> 8;
const D  = ((px * SIN[a2] + COS[a2] * z1 - Pz * 4) >> 9) + 0xd61;          // D < 1 : la lettre entière est abandonnée
const sx = trunc((((x2 * COS[a3] - SIN[a3] * y1) >> 2) - Px * 4) / D) + 160;
const sy = 200 - trunc(((((x2 * SIN[a3] + COS[a3] * y1) * 0x1aa) >> 10) - Py * 4) / D) + Y;
```

La caméra n'intervient pas : le texte est dans le repère de l'écran. Lumière par normale `n` (les 23 normales du bloc 200) : `u = ((offX >> 6) + a2) & 0x1ff`, `t = (SIN[a1]·ny + COS[a1]·nz) >> 8`, `l = clamp(((((nx·SIN[u] + COS[u]·t) >> 8) · −256) >> 9), 0, 127)`. Une face (a, b, c) est gardée si `(xc − xa)(yb − ya) < (xb − xa)(yc − ya)` ; sa clé de tri est la somme des trois `D`. Les faces s'insèrent dans la file de `gm_queue_insert` (2 995 entrées ; rejet si les trois sommets sont hors de `[0, 0x13e] × [0, 0x18f]` du même côté) et sont tracées **du plus loin au plus proche** par `gm_draw_flat_tri` (couleur unie, découpe `0 ≤ x ≤ 0x13f`, `0 ≤ y ≤ 399`). Centre de projection (160, 200) : valeurs initiales de `DAT_00480c6c/70` (jamais écrites).

### 8.4 Écran de pause (`gm_screen_pause`, `00419058`)

`gm_menu_run` appelle `gm_frame` avec le drapeau `0x10` absent, donc **sans radar ni HUD** (`gm_frame` ne les trace qu'avec le drapeau 2) : le décor 3D (viseurs compris), les messages 3D (dont le titre « Pause » qui arrive en 31 ticks puis tourne) et le menu (espaceur de 4 px de la ligne `0x76`, le choix `(4, 1)`, espaceur) à `Y = 260`, par-dessus. À la sortie : `gm_clear_keys`, `gm_title_release`.

La table 22 (« Commencer », « Objectif final », « Nord », « Guide des objectifs ») n'est référencée par aucun appel trouvé : usage inconnu (carte des objectifs dans un menu non repéré) [H].

## 9. Fonctions à nommer

Noms proposés (préfixe `gm_`), à fusionner par le coordinateur dans `keyfuncs.def.tsv` (non modifié ici).

| Adresse | Nom | Rôle |
|---|---|---|
| `0042a010` | `gm_object_collide_radius` | rayon² de collision d'un modèle (100 par défaut) |
| `0042a084` | `gm_world_update_collide` | mise à jour du monde par case de 512 unités, appel des comportements, collisions et dégâts mutuels `min(A, B, 100)` |
| `0042a940` | `gm_world_update_collide_net` | variante réseau (`DAT_00480c50 != 0`) |
| `0042ae7c` | `gm_find_objects_near_obj` | liste chaînée des objets (`+0x60`) autour d'un objet, filtrés par `flags & masque == valeur` |
| `0042af88` | `gm_find_objects_near_pos` | idem autour d'un point (viseur : rayon 3, soit 7 × 7 cases ; radar : rayon 4, soit 9 × 9 cases) |
| `0042ebc4` | `gm_score_add` | crédite des points au joueur propriétaire de l'auteur des dégâts (`+0x108`, `+0x110`) |
| `0042ec80` | `gm_draw_hud` (existant) | HUD |
| `00437af0` | `gm_draw_energy_gauge` | jauge d'énergie (bloc 503) |
| `00437c38` | `gm_draw_crosshair` | une moitié du viseur (bloc 506) |
| `004362b8` | `gm_draw_overlay_sw` (existant) | radar et cadres |
| `00422f28` | `gm_message_pool_init` | initialise les 50 messages flottants |
| `00422f8c` | `gm_message_spawn` | message flottant 3D (table, id, teinte, type) |
| `00424454` | `gm_message_draw` | dessin des messages flottants (police vectorielle) |
| `004261a0` | `gm_object_spawn_from` | crée un objet en copiant un gabarit (propriétaire) : `(drapeaux EAX, gabarit EBX, modèle, énergie, comportement)` |
| `00426814` | `gm_object_spawn_at` | crée un objet à une position du monde |
| `00438198` | `gm_player_pick_target` | choisit la cible `+0x58` (produit scalaire + biais objectifs) |
| `0043b4f4` | `gm_player_die` | mort : explosion, débris, message « Game over ! », `DAT_005b0414 = 2` |
| `0043c07c` | `gm_player_victory_mode` | pilotage de fin de niveau, `+0x184 = 0` |
| `0043c164` | `gm_nearest_player` | joueur vivant le plus proche dans un rayon² (écrit `+0x58`) |
| `0043c234` | `gm_game_tick` | tick du jeu : joueurs, jauge, score affiché, fin de niveau, compagnons |
| `0043ca60` | `gm_player_copy_controls` | recopie les 11 commandes dans `+0xb8…` |
| `0043cab4` | `gm_player_load_profile` | état de départ du joueur depuis le profil |
| `0043cd14` | `gm_player_save_profile` | reporte munitions, énergie, véhicule, score, puissance dans le profil |
| `0043cda4` | `gm_objective_register` | inscrit une cible d'objectif (liste triée décroissante) |
| `0043ce6c` | `gm_objective_target_killed` | retire une cible, annonce l'objectif accompli, déclenche la victoire |
| `0043d034` | `gm_objective_head_first` | remet en tête de liste les cibles du même objectif (radar) |
| `0043de0c` | `gm_player_set_vehicle` | change le véhicule du joueur (modèle, pilotage, roues, son) |
| `00443c88`, `00443d3c`, `00443e00`, `00443fe4`, `00443ed0` | `gm_spawn_explosion_*` | explosions et poussières (types 11000 à 11002) |
| `00443938` | `gm_buddy_scan_targets` | cible des compagnons (zone autour de l'objet) |
| `00444084` | `gm_missile_trail_puff` | fumigène (type 11001) |
| `004442ec` | `gm_spawn_debris` | débris d'un modèle (table 11004) |
| `00444af8` | `gm_vehicle_hover_physics` | ressort de vol, plafond, dégâts de sol (−10) |
| `004463c0` | `gm_pickup_behavior` | bonus flottant : attraction, collecte, effet |
| `00454ce0` | `gm_missile_steer` | tête chercheuse (vitesse par classe, virage vers la cible) |
| `00456814` | `gm_set_local_velocity` | vitesse d'un projectile selon cap et tangage |
| `004580f0` | `gm_attach_to_player` | place un lanceur par rapport au joueur |
| `004582dc` | `gm_weapon_select` | sélection arme suivante / précédente / directe |
| `00458590` | `gm_special_fire` | état 10 → 0x0b (tir) |
| `004585c4` | `gm_pickup_apply` | effet d'un bonus (munitions, énergie, compagnons, bouclier, puissance) |
| `00458f88` | `gm_pickup_can_collect` | un bonus est-il collectable (sous le plafond) ; affiche son nom |
| `004599b8` | `gm_player_aim_update` | tangage de visée `+0x90` (auto-aim vertical) |
| `00459c80` | `gm_player_weapon_update` | consommation des munitions, resélection, dispatch par véhicule |
| `00459f30` | `gm_special_weapon_ship0` | armes spéciales de l'hélicoptère (véhicule 0) |
| `0045e128` | `gm_special_weapon_ship1_2` | armes spéciales des véhicules 1 et 2 |
| `004672a0` | `gm_special_weapon_ship3` | armes spéciales du véhicule 3 (et 43) |
| `004629e4` | `gm_special_weapon_ship4_5` | armes spéciales des véhicules 4 et 5 |
| `0046b4b4` | `gm_primary_bullet_spawn` | crée un projectile du canon |
| `0046b6fc` | `gm_primary_fire` | motifs du canon selon `+0x9c` |
| `0046d1f8` | `gm_enemy_fire_pattern` | motifs de tir des ennemis (appelée par `0044167c` et par le comportement `0044b848` du type 3001) [P] |
| `00419ed8` | `gm_screen_game_over` | écran de fin « Game over » |

### Comportements (étiquettes, pas des fonctions du corpus)

| Adresse | Rôle |
|---|---|
| `00455124` | missile accroché au lanceur (copie cap, tangage, roulis du porteur) |
| `004551f0` | vol de l'arme 0 (virage 2) ; `00455190` : vol libre |
| `00455278` | vol des missiles à tête chercheuse (virage 4) |
| `00455300` | vol à vitesse de classe 10 (7 000, virage 2) |
| `00455370`, `004556dc` | bombe : phase de vol puis onde de choc de 40 / 60 ticks |
| `00455a98` | missile de croisière |
| `0045754c`, `00457abc` | Super Nova, Nucléator |
| `00457074` | mortier |
| `00457784`, `00457bcc` | napalm, super napalm |
| `00458064` | nacelle larguée |
| `0044a374`, `0044a430`, `0044a4f8` | balles du canon (droite, lourde, à tête chercheuse) |
| `00456038` | bouclier |
| `004560e4`, `00456abc`, `00456658` | compagnons (verrouillage, tir auto, super) |
| `00446d24` | cible statique détruisible (types 2000 à 2004) |
| `004469fc`, `00446a3c`, `004468cc`, `00446964` | bonus ramassé (`+0x198++`), bonus « secret » (`+0x194++`), bonus cachés 7001 et 7002 |
| `004482dc`, `004495f8`, `004493e8`, `004490cc` | plateformes de véhicule et zone d'extraction (types 7010 à 7030) |
| `00439088`, `00439670`, `0043a174`, `0043a760`, `00439bcc`, `0043ac64`, `0043b0ac` | pilotage des véhicules 0 (deux variantes), 1, 2, 3, 4, 5 |
| `00438d08`, `00438ec8`, `00438fb8`, `00438de8` | pilotage de fin de niveau |
| `00449aa8`, `00445228`, `00445670`, `00449ad0`, `00445a84`, `00445f44` | fonctions de tick des véhicules (physique, collisions sol / eau) |

## 10. Questions ouvertes

- **Cadence** : 40 ticks par seconde (pas de 25 ms dans `gm_poll_events`) est établi ; la mesure du nombre d'images (`DAT_00480c60`, `DAT_00481188`) n'influence pas la logique (R1).
- **Armes spéciales** : portées de l'exe (E3b, `launchers.ts`, `special-weapons.ts`). Restent hypothèses : constantes de la forme 3 (reprend celles de l'hélicoptère), signe latéral des nacelles uniques 5-8 / 15-18, déformations du terrain (`gm_deformers_apply`, non portées : leur réserve de 5 nœuds `00587714`, qui conditionne l'explosion du mortier et de la bombe, est supposée jamais vide), pads 7012+ (`004477b0`…).
- **Classes des projectiles** [C] : projectiles du joueur et des compagnons `0x3f` (bit `0x04` : les ennemis les voient comme le joueur), projectiles ennemis et balles de nova `0x3b` ; compagnons et bouclier : classe `0x14`.
- **Dégâts des ennemis** : l'énergie de leurs projectiles est dans chaque comportement (R2) ; la règle `min(A, B, 100)` est établie.
- **Types 3000 et suivants** : le lien type → comportement vient du code, les noms (char, navire, tourelle…) de R2. Le dépôt de bonus par les cibles 2000 portant un champ 7 de 1000 à 1999 (« secrets ») est probable mais non lu dans le détail.
- **Radar** : échelle exacte de la carte tournée ; sens des classes de drapeaux `+0x04` (hostiles, alliés, bonus) à confirmer avec R2 ; mode `DAT_00480c80` (touche `DAT_00490108`) non identifié.
- **Meilleurs scores** : écran et enregistrement non trouvés (table 10) ; table 22 sans référence.
- **Types 7010 à 7030, 1010, 7800, 7801** : types de plateforme de changement de véhicule, d'extraction, de repères (7800/7801 : `LAB_00446a7c`, indexent `DAT_005a859c[champ 7]`, relais ou téléporteurs [H]) à documenter avec R2.
- **Effet d'invulnérabilité de coup (bits `0x102`)** et clignotement du véhicule touché : non observés.
