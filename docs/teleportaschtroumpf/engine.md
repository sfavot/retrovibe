# SMURF.EXE : cadre global du moteur (rétro-ingénierie)

Tâche 2.1. Ce document décrit le fonctionnement global du jeu (enchaînement des scènes, timing, rendu, entrées, son, état de partie, textes). Il s'appuie sur la décompilation Ghidra (`archives/teleportaschtroumpf/re/`, voir `re-index.md`) et sur le désassemblage `disasm.txt`, qui reste la référence quand la décompilation est douteuse. Les formats de fichiers sont traités ailleurs : `hy8.md` (sprites), `pfn.md` (polices), `mut.md` (mine), `mux.md` (vidéos), `files.md` (inventaire).

Niveaux de confiance : **sûr** (code lu et cohérent), **probable** (déduction solide mais non exécutée), **hypothèse** (à vérifier). Les adresses sont `segment:offset` (celles de `decomp/` et de `functions.tsv`) ; les globales sont données en offset DGROUP : `DS:xxxx` avec DS = `3646` (adresse linéaire Ghidra `0x3xxxx` − `0x36460`).

## 0. Conventions et pièges de lecture

- **Offset fichier** d'une adresse de code : `0x4200 + seg×16 + off − 0x10000` (le segment `1000` est le début du module chargé, en-tête MZ de 16 896 octets). Offset fichier d'une donnée DGROUP : `0x4200 + 0x26460 + off`. La partie initialisée de DGROUP s'arrête à `DS:0x443A` (fin du fichier) ; au-delà, c'est du BSS à zéro au démarrage.
- **Les tables de `switch` sont dans le segment de code** (`CS:[BX+table]`), pas dans DGROUP. Exemple : le plateau lit ses codes dans `28a3:0474` (26 mots) et ses cibles dans `28a3:04a8`.
- Le décompilateur perd les arguments de `sprintf` et de plusieurs appels (`15f9:089f`, `1f33:0181`...). Les valeurs données ici viennent de `disasm.txt`.
- Une partie du handler clavier (`INT 9`, `3134:01d8`) n'est pas désassemblée par Ghidra ; ses octets bruts montrent qu'il appelle `14b3:0314` (voir §4).
- Langue : l'exécutable appelle `16f5:0003(0x66)` (`'f'`) à l'initialisation (`305a:016c`), donc le jeu est figé en français ; `DS:617B` (= `cRam0003c5db`) contient la lettre de langue, utilisée pour `jeu_%c` et pour choisir les textes (`a` anglais, `f` français, `g` allemand, plus d'autres lettres jusqu'à `p` pour les messages d'erreur).

## 1. Enchaînement des scènes

### 1.1 Démarrage : `main` (`305a:016c`)

Pseudo-code, dans l'ordre (sûr) :

1. `argv[1]` éventuel : `atoi` stocké en `DS:8345` (jamais relu), copie de la chaîne en `DS:8340` (jamais relue). Aucune option utile.
2. `305a:010e(argv[0])` : sépare le dossier de l'exécutable et fait un `chdir` (`1000:0412`, `1000:02c2`).
3. EMS : `12ec:0008` détecte le pilote (`EMMXXXX0`, INT 67h/AH=40h) ; sinon erreur fatale « No EMS. ». Il exige ≥ 512 Ko d'EMS libre (`12ec:00bd` ≥ 0x80000) et ≥ 0x537F0 octets de mémoire DOS libre (`35f5:000e(-1)`) ; sinon `1764:000a` avec le message (« mémoire EMS minimum = 512K », « mémoire RAM minimum = 540K »).
4. `16f5:0003(0x66)` : choix de la langue (tables de messages d'erreur et scancodes des touches de l'écran d'erreur, voir §4).
5. `305a:00ff` : `30bb:004c` = test MSCDEX (INT 2Fh, AX=1500h) ; la lettre du lecteur CD (`DS:6500`) = premier lecteur + `'a'`. Sans MSCDEX : `0xFF + 'a'` (0x60, lecteur invalide). Ce lecteur sert à résoudre les chemins (voir §7).
6. `305a:0071` : initialisation matérielle, dans cet ordre : `16dc:0148` (INT 8, clavier, souris, mode vidéo 13h, voir §2 et §3), `14b3:0192` (joystick, désactivé), `15f9:0be9` (carte son), `305a:0008` (charge en mémoire la police `s52d001f.pfn` et trois VOC en EMS : `s52d001b.voc`, `s01a002b.voc`, `s01a001b.voc`), zone de clip 0..319 × 0..199, `1f33:0085` (graine du hasard).
7. Lecture de `c:\smurf.cfg` (4 valeurs, voir §6), fixe `DS:6EA4` (durée), `DS:6EA0`, `DS:6EA2`, `DS:6E9C`.
8. Palette tout à noir (`3311:01b1` sur `DS:54C0`), efface la VRAM, puis **logo de démarrage** : `154c:000f("s52d0")` si `DS:19A4` = 0 (toujours, il n'est jamais modifié). Il charge `s52d00.mcg` (affiché noir, puis fondu), joue `s52d0.mux`, fondu au noir, attend jusqu'à 3 s ou un clic/Échap (`1f33:02c0(3)`), fondu au noir.
9. **Boucle principale** `21ee:0006` (voir §1.2). Elle ne revient qu'au choix « Quitter » confirmé.
10. Libère les trois VOC en EMS, puis `154c:052e` = **générique de fin** (fond `s52d001d.mcg`, polices `s52d3.pfn` et `s52d2.pfn`, texte `s52dsphi.doc` à marqueurs `@2`/`@3`, musique `s52m002m.voc` en boucle depuis l'EMS, défilement par `154c:046e`).
11. Sortie par `1764:000a` avec le message d'au revoir (« Merci d'avoir joué au Téléportaschtroumpf... » en français) : l'erreur fatale sert aussi de sortie normale.

### 1.2 Boucle du menu : `21ee:0006` (sûr)

```
musique = "s52m00%dm.voc" avec N = 1 + rand()*3/0x8000     // DS:6F04, tirée une fois à l'entrée
si DS:19A4 == 0 :  S06 (21ee:12c2) ; S05 (21ee:0191)        // intro vidéo puis titre
répéter
  répéter
     charger s07a001b.voc ; choix = menu S07 (21ee:0e8f) ; libérer
     1f33:036d()                                            // attend relâchement des boutons
     selon choix :
       0 : fondu 0x10 ; S10 (21ee:1246 → 154c:0954("s10a.mux"))
       1 : fondu 0x10 ; S06 (21ee:12c2)
       2 : fondu 0x10 ; 1a3c:002a (mode « Schtroumpf », §1.3)
       3 : si 21ee:1d6b() == 0 alors choix = 10 (verrou parental, §6) ; sinon sort de la boucle interne
       4 : si DS:7083 (touche « droite » tenue > 4 s sur le bouton) : fondu ; S04 (21ee:13a1)
       5 : fondu ; confirmation S49 (1823:000c(10)) ; si 0 alors choix = 0 ; fondu
  jusqu'à choix == 3 ou 5
  si choix == 3 :                                           // « Jouer »
     répéter
        d28c = S09 (21ee:01d2)                              // nombre de joueurs 1..4
        S08 (21ee:0435 puis r = 21ee:0c19)                  // personnages
     tant que r == 1                                        // 1 = « retour » à S09
     si r != 2 : partie 28a3:00ad (§1.4)                    // 2 = retour au menu
jusqu'à choix == 5
```

Les index du menu S07 correspondent, de haut en bas, aux six boutons de `s07a001d.mcg` : **0 Règles, 1 Introduction, 2 Schtroumpf, 3 Jouer, 4 Parents, 5 Quitter**. Les textes des boutons sont dessinés dans le MCG avec les indices de palette 120 à 125 (vérifié sur l'image). Le bouton « Schtroumpf » (2) n'a pas de nom évident ; son code lance le mode « carte libre » (§1.3) : appellation « mode libre » = **probable**.

Le menu S07 (`21ee:0e8f`) est une pile de navigation, pas un menu à zones :

- sélection courante `SI` (0..5), modifiée par les drapeaux de navigation `DS:4BBB` (bit 1 = haut → `SI−1` avec rebouclage 5 ; bit 2 = bas → `SI+1` avec rebouclage 0) ;
- surbrillance : la couleur de texte du bouton `SI` (entrée de palette 120+SI, `DS:5928 + 3×SI`) est remplacée par la couleur de survol, copiée depuis `DS:5925` (initialisée à RGB 8 bits `10 A4 CC`) ; l'ancienne couleur est restaurée pour le bouton quitté ; puis `1523:0235` renvoie la palette (`3311:01b1`). **Sûr.**
- clic gauche (`DS:4BBD` == 1) = valider ; clic droit (`DS:4BBD` == 2) = jouer la voix du bouton (`15f9:0db1("s07v", n)` puis `15f9:0e1c`), avec `n` = 4, 5, 7, 2, 8, 6 pour les index 0..5 (fichiers `s07v00Nt.voc`) ; la voix n'est jamais lancée à la simple sélection.
- touche de scancode `0x1E` dans S07 : `1764:000a("Break")`, sortie immédiate (sortie de debug, sûr).
- accès parents : bouton 4 sélectionné **et** drapeau droite (`DS:4BBB` bit 8) maintenu plus de 4 s (`1f33:019a(1) > 4`) ; sinon valider ce bouton ne fait rien (le retour de `21ee:0e8f` est 4 mais `DS:7083` vaut 0).

### 1.3 Mode « carte libre » : `1a3c:002a` (sûr pour la mécanique)

```
d313 = 0 ; d28c = 1 ; d28a = 0 ; sélection k = 1
répéter
  fondu 0x10 ; 1a3c:0225(k, 1, 1, 2)         // affiche la carte S02, l'utilisateur choisit k (1 = retour, 2..18 = lieu)
  si k >= 2 :
     DS:6EB6 + 0x14×d28a = rand()*3/0x8000    // variante 0..2 (voir §6)
     scène = table_CS_1a3c:0203[k−2]
     28a3:04dc(scène)                          // voix d'introduction « sNNa »
     appelle la fonction d'entrée de la scène (table CS:1a3c:01c7, voir §1.8)
tant que k != 1
```

La carte (`1a3c:0225`) défile verticalement et se navigue au clavier/souris par les drapeaux haut/bas (`DS:4BBB`), voir §4. Les 17 lieux et leurs scènes sont dans le tableau du §1.8.

### 1.4 Partie : `28a3:00ad` ↔ plateau S01 `291e:0401` (sûr pour la structure)

Initialisation : 4 joueurs × 20 octets remis à zéro (écran 1, rangée haute `y=0x38`, `x=0x0B`, direction droite), `d28a = 0` (joueur courant), chrono 0 démarré (`1f33:0181(0)`), `DS:6F36` = 1 (« en partie »), `26ee:003f`.

Boucle (un tour de joueur par itération) :

```
28a3:0007()                       // nouvelle musique aléatoire s52m00%dm.voc
code = 291e:0401()                // tour du joueur courant (S01, voir ci-dessous)
28a3:04dc(code)                   // voix d'accroche « sNNa » éventuelle
cherche code dans CS:28a3:0474 (26 entrées) → appelle la fonction d'entrée correspondante
si code != 0x15 : 26ee:0008()
fin de partie si : (a) tous les ingrédients requis + points suffisants du joueur courant → victoire,
                    (b) le temps global (chrono 0) ≥ d304 → temps écoulé, (c) abandon (S46)
sinon : joueur suivant (d28a+1 ; au dernier, retour à 0 et tour de plateau iRam38C74+1)
```

Codes retournés par `291e:0401` et traités par la table de `28a3:00ad` (extraits de `28a3:0474` et `28a3:04a8`) :

| Code | Action |
|---|---|
| 14 (`0x0E`) | S13 : `2daf:0006(rand()*2/0x8000)` |
| 22 à 36, 38 à 41, 51 | mini-jeu de même numéro (fonctions du §1.8) ; 38 = `1fc6:0008`, 39 = `265b:000d`, 41 = `2143:0009`, 51 = `19a8:0006` |
| 100, 101 | vidéo `s01b.mux` / `s01c.mux` (`154c:0954`) puis `26ee:0008` ; sortie par le bord gauche/droit du plateau (valeurs 100/101 posées par `291e:0401` quand `291e:13f2` renvoie 1 ou 0x13E) |
| 200 | reprise (pause quittée, aucune action) |
| 201 | S46 abandon : `1823:0415` ; un retour non nul termine la partie sans vidéo |
| 202 | S02 : `1a3c:0225(d2c4, 1, 0)` (consultation de la carte depuis la pause) |
| 203 | S45 aide : `1e20:027c` |
| autres | rien (puis `26ee:0008`) |

Les scènes S15 à S21 n'ont pas de code propre dans cette table : ce sont des animations d'événements jouées pendant `291e:0401` par `2a78:00da(écran, mode)` (table `CS:2a78:0145`, 9 entrées : écran 1 → `2a78:0157`, 2 → `015f` (S14), 3 → `0272` (S20, S21), 4 → `0480` (S15, S18, S13), 5 → `06e5` (S15, S20, S21), 6 → `0a59` (S13, S15, S17, S21), 7 → `0d53` (S16, S20), 8 → `0f2f` (S15, S20), 9 → `1244` (S13, S20)), et `2a78:0039` lance le MUX par `154c:07c2` ou `179a:0673`. Le déclencheur exact par case reste à documenter (tâche 2.3) : **probable**.

**Structure du plateau (sûr pour les valeurs, probable pour l'interprétation).** Le plateau est une rue vue de côté en 9 « écrans » (fonds `s01a00Nd.mcg`, N = 1..9, `291e:125c`) sur deux rangées (rangée haute `y == 0x38`, sinon basse). Le pion (`x` 0..0x13F, `DS:7ABD` = `iRam3de4d`) marche à gauche/droite ; la porte devant lui est donnée par `2813:000d(écran)` (appelle `2813:0037` pour la rangée haute, `2813:00a1` pour la basse). Chaque porte renvoie un numéro de scène (0xFFFF = rien). Zones en `x` : gauche 7..0x6A, centre 0x6C..0xD3, droite 0xD5..0x13A (les valeurs 0x6B, 0xD4 et < 7, > 0x13A sont les bords : marche vers l'écran voisin, `2813:0728/076e/07d7/0840`). Tableau décodé (`—` = pas de porte) :

| Écran | Rangée haute G / C / D | Rangée basse G / C / D |
|---|---|---|
| 1 | — | G et C = 23, D = 29 |
| 2 | 35 / 38 / 14 | 40 / 33 / 25 |
| 3 | 26 / 28 / 24 | 39 / 20 / 21 |
| 4 | 38 / 51 / 14 | 34 / 15 / 18 |
| 5 | 27 / 21 / 38 | G et C = 15, D = 20 |
| 6 | 14 / 15 / 30 | 39 / 17 / 21 |
| 7 | 22 / 20 / 38 | 32 / 16 / 31 |
| 8 | 15 (les 3 zones) | 20 / 41 / 38 |
| 9 | G = 14, C et D = 39 | G = 20, C et D = 36 |

(Table lue dans les 18 fonctions `2813:010b..06b4`. Les écrans 1 et 9 n'ont que deux zones.) La fonction `291e:1536(écran, x, y)` en dérive un indice d'action `1..52` (`(écran−1)×6 + zone + (rangée haute ? 0 : 3)`) utilisé avec la table `CS:291e:11f4`.

### 1.5 Pause, abandon, aide, confirmation

- **Pause S48** : `269a:0007`, lancée depuis `291e:0401` quand la touche de pause de la langue est pressée (`DS:18E == DS:C620`, `0x19` = P en français) ; sauvegarde de l'écran (`12ec:0314`), 4 boutons choisis par gauche/droite (drapeaux 4/8), retourne 200 (reprendre) et 201 (abandon → S46), lus dans le code ; 202 (carte S02) et 203 (aide S45) sont déduits de la table du §1.4 (**probable**). Le chrono d'inactivité (slot 1) est gelé par `1f33:01e6(1)` / `1f33:01bf(1)` ; le chrono global (slot 0) ne semble pas gelé : **hypothèse**.
- **Abandon S46** : `1823:0415` (fonds `s46a001d.mcg`, sprites `s46a000s.hy8`). Demande quel joueur abandonne (ou tous), puis la confirmation S49 `1823:000c`. Si un joueur quitte, la structure joueurs est compactée (`memcpy` de blocs de 0x14 octets, `d28c−1`, `d28a` ajusté) ; la fonction retourne 1 (fin de partie) quand plus aucun joueur ne reste ou que l'abandon global est confirmé, 0 sinon. Une valeur non nulle fait sortir de `28a3:00ad` sans vidéo de fin. **Probable** pour les détails des retours.
- **Confirmation S49** : `1823:000c(n)` (n = 0..11) ; fond `s49a001d.mcg`, texte `S49_NNT` lu dans `s49a.dat` (§7), mis en page par largeur de 190 px (`32f4:0192`), boutons Oui/Non par gauche/droite, voix `s49v%dt.voc`. `21ee:0006` l'appelle avec 10 pour « quitter le jeu ». Retourne 1 (oui) ou 0 (non).
- **Aide S45** : `1e20:027c` → `1e20:0007` (écran S03 « Info » : barre de temps de 27 graduations, portrait et ingrédients de chaque joueur, `s03a001d.mcg` + `s03a000s.hy8`), fondu, attente d'un clic gauche ; clic droit = voix `s45a003t.voc`. S03 est donc le contenu dessiné de S45 (probable ; `1fc6:0c20` l'appelle aussi).

### 1.6 Fin de partie

- **Victoire** : `28a3:0080` : `179a:0673("s11a.mux", 0x12C84, ...)` puis `21ee:1c92` (écrit `c:\smurf.cfg`).
- **Temps écoulé** (`d304 ≤ secondes écoulées`) : `291e:000e`, `291e:125c(d4f4, 0)`, vidéo `s42a0%d.mux` avec `N = 0x29 + d302 + 9 × (rand()×4/0x8000)`, soit `s42a041` à `s42a076` (36 fichiers présents : 4 variantes × 9 messages parents) ; puis `21ee:1c92`, fondu.
- Dans les deux cas, retour à la boucle de menu `21ee:0006`.
- **Avertissements de temps** (`28a3:00ad`) : à moins de 180 s de la fin (`d304 − elapsed < 0xB4`) la boucle examine les ingrédients (`bVar2`) ; dans `291e:0401`, une vidéo du Grand Schtroumpf est tirée quand il reste moins de 10 min (`s42a031` à `s42a033`) puis moins de 5 min (`s42a034`, `s42a035`) : `d304 − elapsed < 0x259` et `< 0x12D`. Détail laissé à la tâche 2.3.

### 1.7 Tableau scène → fonction d'entrée → scènes suivantes

Toutes les scènes de `DATA/DESCRIPT.ION` (46). « Appelée par » donne l'origine ; « suivantes » les scènes possibles ensuite.

| Scène | Rôle | Fonction d'entrée | Appelée par | Suivantes |
|---|---|---|---|---|
| S01 | Plateau de jeu | `291e:0401` (tour), `28a3:00ad` (boucle) | S08 (fin), menu S07 choix 3 | mini-jeux, S13..S21, S45, S46, S48, S11, S42 |
| S02 | Carte du pays | `1a3c:0225(k, a, b, mode)` ; tables DS:1470 / DS:15BA | `1a3c:002a` (mode libre), code 202 du plateau | retour à l'appelant |
| S03 | Écran info | `1e20:0007` (dessin) | `1e20:027c` (S45), `1fc6:0c20` | retour |
| S04 | Menu parents | `21ee:13a1` | S07 (choix 4, droite tenue 4 s) | S07 |
| S05 | Titre | `21ee:0191` | `main` après S06 | S07 |
| S06 | Introduction (MUX `s06a.mux`) | `21ee:12c2` | `main` (démarrage) ; S07 choix 1 | S05 (démarrage) ou S07 |
| S07 | Menu principal | `21ee:0e8f` (appelé par `21ee:0006`) | `main` | S10, S06, carte libre, S09, S04, S49 → sortie |
| S08 | Personnages | `21ee:0435` + `21ee:0c19` | S09 | S09 (retour 1), S07 (retour 2), plateau |
| S09 | Nombre de joueurs (1 à 4) | `21ee:01d2` | S07 choix 3 | S08 |
| S10 | Règles (MUX) | `21ee:1246` | S07 choix 0 | S07 |
| S11 | Fin gagnante (MUX) | `28a3:0080` | plateau (victoire) | S07 |
| S12 | absent des données | `21ee:12ff` (code mort : fond `s12a001d.mcg`, puis scène au hasard) | aucun appelant | — |
| S13 | Puits aux vœux | `2daf:0006` (interactif), `2a78:0480/0a59/1244` (MUX `s13a`..`s13g`) | plateau code 14 | plateau |
| S14 | Le puits | `2a78:015f` (`s14a.mux`, `s14b.mux`) | `2a78:00da` écran 2 | plateau |
| S15 | Pièges de Gargamel | `2a78:0480/06e5/0a59/0f2f` | `2a78:00da` | plateau |
| S16 | Pont branlant | `2a78:0d53` + voix `s16a001b.voc` (`291e:0401`) | `2a78:00da` écran 7 | plateau |
| S17 | Fusée du Cosmoschtroumpf | `2a78:0a59` | `2a78:00da` écran 6 | plateau |
| S18 | Lac glacé | `2a78:0480` + voix `s18a001b.voc` | `2a78:00da` écran 4 | plateau |
| S19 | Voix Grand Schtroumpf, ingrédients | `1e52:0324` | `291e:0401` (début de partie) | plateau |
| S20 | Prison de Gargamel | `2a78:0272/06e5/0d53/0f2f/1244` | `2a78:00da` | plateau |
| S21 | Turlusiphon | `2a78:0272/06e5/0a59` | `2a78:00da` | plateau |
| S22 | Le dragon | `1c78:0005` | plateau 22 ; carte libre | plateau / carte |
| S23 | Schtroumpf musicien | `24d0:000c` | idem 23 | idem |
| S24 | Puzzle | `2e6a:0001` | idem 24 | idem |
| S25 | Observation | `260f:000e` | idem 25 | idem |
| S26 | Jeu sonore | `1ed0:000b` | idem 26 | idem |
| S27 | La luge | `1f84:000e` | idem 27 | idem |
| S28 | Schtroumpfs noirs | `2573:000f` | idem 28 | idem |
| S29 | L'anniversaire | `1da0:0009` | idem 29 | idem |
| S30 | Pont de la rivière | `2d6b:0008` | idem 30 | idem |
| S31 | Les tortues | `2f87:0008` | idem 31 | idem |
| S32 | Chez Gargamel | `199e:000a` | idem 32 | idem |
| S33 | Formule magique | `1ceb:000c` | idem 33 | idem |
| S34 | La cigogne | `1b05:000b` | idem 34 | idem |
| S35 | Le coloriage | `1bda:0021` | idem 35 | idem |
| S36 | Mine désaffectée | `23c9:0004` (+ `23c9:0dbd` MUT/PRC) | idem 36 | idem |
| S38 | Schtroumpf à lunettes | `1fc6:0008` | plateau 38 seulement | plateau |
| S39 | L'oiseau | `265b:000d` | plateau 39 seulement | plateau |
| S40 | Le quiz | `2ee8:000d` | plateau 40 ; carte libre | idem |
| S41 | Le magicien | `2143:0009` | plateau 41 seulement | plateau |
| S42 | Grand Schtroumpf (vidéos, voix) | `154c:097b` (vidéo `s42%c.mux` aléatoire), `1e52:00ad` (voix `s42v`), fin de temps `28a3:00ad` | plateau (événements, fin de temps) | S07 |
| S45 | Aide | `1e20:027c` | code 203 (via S48) | plateau |
| S46 | Abandon | `1823:0415` (+ frag `1823:0e21`) | code 201 (via S48) | plateau ou S07 |
| S48 | Pause | `269a:0007` | `291e:0401` (touche P) | plateau (codes 200..203) |
| S49 | Confirmation | `1823:000c(n)` | S07 (quitter), S46 | appelant |
| S51 | Les cadeaux | `19a8:0006` | plateau 51 ; carte libre | idem |
| S52 | Divers (logo, générique, polices, musiques, bips) | `154c:000f("s52d0")` (logo), `154c:052e` (générique), `305a:0008` | `main` | — |

Tous les mini-jeux (22 à 41, 51) sont lancés par les deux mêmes aiguillages : `28a3:00ad` (partie) et `1a3c:002a` (mode libre ; seulement 22 à 36, 40 et 51). Les 38, 39 et 41 ne sont donc jouables que depuis le plateau.

### 1.8 Codes de scène et table de la carte (mode libre)

Dans `1a3c:002a`, la sélection `k` (2 à 18) de la carte donne la scène (table `CS:1a3c:0203`, valeurs lues dans les `case`) et la case de la carte (table `DS:15BA`, mots) :

| k | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Scène | 23 | 29 | 35 | 40 | 33 | 25 | 26 | 28 | 24 | 51 | 34 | 27 | 30 | 22 | 32 | 31 | 36 |
| Case de la carte | 4 | 6 | 7 | 10 | 11 | 12 | 13 | 14 | 15 | 20 | 22 | 25 | 33 | 37 | 40 | 42 | 53 |
| Position (x, y) sur le fond défilant | 129,455 | 182,449 | 279,461 | 271,418 | 179,394 | 73,372 | 104,350 | 196,330 | 247,330 | 222,292 | 105,263 | 203,230 | 317,200 | 143,180 | 113,160 | 153,111 | 273,85 |

La table `DS:1470` contient 54 entrées de 6 octets `(x, y, sprite)` pour les cases 0 à 53 (case 0 = (0,0,0) ; case 53 = (273,85,1) = la mine). Le retour de la carte en mode libre est `k == 1`. Les fonds sont `s02a001d.mcg` (carte normale), `s02a007d.mcg` (si `DS:6EB3` ≠ 0), `s02a002d.mcg` (mode 1) ; les parties défilantes viennent de `s02a004d`/`005d`/`006d.mcg` lues par morceaux (décalages 0xA82, 0x2602, 0x1342) avec `lseek`. **Sûr** pour les tables, **probable** pour le sens de la 3e colonne (orientation du pion).

Autre usage de ces numéros : `28a3:04dc(scène)` (table `CS:28a3:04dc`, 21 codes) tire `rand()*2/0x8000` (0 ou 1) et joue la voix d'introduction `sNNa` + `1` + variante (`15f9:0db1`, préfixes `s22a`..`s36a`, `s40a`, `s51a` ; S51 fixe la variante à 0). Trois codes de la table sautent la voix (`goto` direct) et le code 0 de la table (premier `case`) recopie l'écran dans l'EMS A au lieu de parler. Le détail par code n'a pas été relevé.

## 2. Timing

### 2.1 PIT et horloge de jeu (sûr)

- `3559:0076` (appelé par `16dc:001a`) accroche **INT 8** (via INT 21h/AH=35h puis 25h, ancien vecteur sauvé en `CS:3559:10`) et programme le canal 0 par `3559:0031` : `OUT 43h,0x36` (mode 3) puis le diviseur `DS:3F70` (octet bas puis haut sur le port 40h).
- Diviseur par défaut `DS:3F70 = 0x4DAE = 19886` → **1 193 182 / 19 886 = 60,01 Hz**. Valeur écrite en dur par `336a:03e6` et `179a:0673` (fin de vidéo).
- L'ISR (`3559:00e8`, anti-réentrance par `CS:e8`) incrémente un compteur, puis appelle les **callbacks enregistrés** (6 emplacements `CS:3559:16 + 4k`, `3559:0162`/`0179` enregistrent, `01b4`/`01c9` retirent), puis chaîne vers l'ancien INT 8 (compteur `CS:2e` rechargé à 3 : un appel sur quatre environ ; dérive de l'horloge DOS : **probable**). Rôle des callbacks :

| Callback | Rôle |
|---|---|
| `16dc:0002` | tick de jeu : `DS:6124 += 1` (u32), `DS:6120` décrémenté jusqu'à 0, puis `14b3:0247` (déplacement du curseur par les drapeaux du joystick, inactif) |
| `3134:03bb` | déplacement du curseur par les drapeaux clavier (`±(1 << DS:3FD0)` px/tick, tables `CS:3134:0116/0127`, seulement si `DS:190 == 1` ; `DS:3FD0` vaut 2 au départ dans l'image du programme et passe à 1 quand S24, S25, S26, S35, S41 ou S51 démarrent, rien ne le remet : 4 px puis 2 px) |
| `3134:043c` | souris : `INT 33h` AX=3 (boutons) et AX=0Bh (déplacements) |
| `30d4:04a2` | curseur graphique 16×16 de bibliothèque (désactivé par défaut, voir §3.4) |
| `179a:05d0` | pendant une vidéo MUX : compensation de l'horloge (voir §2.3) |

- **Unité de temps du jeu** : `1764:0300` renvoie `(DS:6124 − DS:1037) × 100 / 60` : des **centièmes de seconde** (le tick est à 60 Hz). Les chronos par slot `1f33:0181(i)` / `1f33:019a(i)` stockent un départ en centièmes dans `DS:6E4C + 4i` et renvoient les **secondes** écoulées (÷100).

Primitives d'attente (toutes sûres) :

| Fonction | Sémantique |
|---|---|
| `1f33:00fc(n)` | attend `n` centièmes de seconde en appelant `1764:018a` (pompe) ; dessine le curseur si `DS:192` |
| `1f33:0154(n)` | idem sans curseur |
| `1f33:0181(i)` / `019a(i)` | démarre le chrono `i` / secondes écoulées |
| `1f33:01e6(i)` / `01bf(i)` | sauve / restaure le chrono (gel pendant une pause) |
| `1f33:0279(n)` / `02c0(n)` | attend `n` s ou un clic gauche (`DS:3FCE == 1`) ; `02c0` accepte aussi Échap (`DS:3FC8 == 1`) |
| `1f33:0348(n)` / `0364` | **cadence** : attend `DS:6124 ≥ DS:6EAF + n` (ticks bruts de 1/60 s) puis `DS:6EAF = DS:6124` ; `0364` réinitialise la référence |
| `1f33:036d` | attend le relâchement des boutons souris (plafond 500 cs = 5 s) |
| `1f33:030e` | attend le relâchement des drapeaux de navigation `DS:4BBB` (plafond 5 s) |
| `1f33:03a7(flag)` | attend la fin du son (`15f9:089f(0, 0x100000)`) ; si `flag` et clic gauche, coupe le son |
| `3311:00e4` | attend le retour vertical VGA (port 3DAh, bit 3) |

### 2.2 Cadence logique des scènes (sûr pour les appels, probable pour la lecture)

Les scènes animées terminent leur image par `13fc:03f9` (recopie à l'écran) puis `1f33:0348(n)` :

| Scène (fonction) | `n` ticks | Cadence |
|---|---:|---|
| Mini-jeux S22, S23, S26, S28, S29, S31, S33, S51 (`1c78`, `24d0`, `1ed0`, `2573`, `1da0`, `2f87`, `1ceb`, `19a8`) | 5 | 12 images/s |
| Plateau S01 (`291e:0401`, marche `2813:0728..0840`) | 4 | 15 images/s |
| Carte S02 (`1a3c:0225`) et S30 (`2d6b:0008`) | 3 | 20 images/s |
| S36 (`23c9:0004`) | variable (`DS:71C6`, double mot) | non décodée |

Les autres scènes (S24, S25, S27, S34, S35, S38, S39, S40, S41...) ont leur propre rythme (vidéos MUX ou attentes `1f33:00fc`) : à relire scène par scène.

### 2.3 Vidéos MUX (cohérence avec `mux.md`)

- Au démarrage d'une vidéo, `336a:01a8` lit l'en-tête (signature `0xAA07`, 32 octets), place **le diviseur de l'en-tête (offset 0x0C) dans `DS:3F70`** et appelle `3559:0031` : la fréquence de l'ISR devient `1 193 182 / diviseur` (132 Hz pour 9039, 60 Hz pour 19886). `336a:03e6` et `179a:0673` remettent `0x4DAE` à la fin.
- Le pas vidéo est asservi au son : le callback de pas par défaut est `3412:0209` (pointeur far par défaut en `DS:3DF4`, quand l'appelant n'en donne pas), qui compare le numéro d'image décodé (`DS:3DED`, payload du chunk 05) avec la position audio (`DS:3F6C >> 1`). L'état du décodeur est avancé par `3412:0005` (une image : traite les chunks jusqu'au chunk 05), `336a:0750` (lecture suivante par blocs de 0x5000 ou 0xF000 octets selon l'indicateur 0x2000). Le débit **11 images/s** de `mux.md` (= PIT / 12) est donc cohérent avec le rapport octets audio / images mesuré ; je n'ai **pas retrouvé la constante 12** dans le code (hypothèse : elle vient de la taille des tampons audio de `a22c = 1` et du débit DMA). **Hypothèse.**
- Pendant une vidéo l'ISR tourne à la cadence de l'en-tête ; `179a:05d0` (callback) incrémente `DS:1037` un tick sur deux pour compenser `DS:6124` : l'horloge de jeu n'est pas exactement du temps réel pendant les vidéos (écart de ~10 % à 132 Hz en première lecture). **Hypothèse** ; sans conséquence pour une réimplémentation.
- Arrêts : le drapeau `0x400` (dword d'options de `179a:0673`) + clic gauche, ou `0x800` + Échap (`DS:18E == 1`), mettent `DS:C797 = 1` ; un chien de garde arrête aussi la lecture si 50 appels de `179a:0421` se suivent sans changement d'image (`DS:749C > 0x32`).
- Options de `179a:0673(nom, options, cb_image, cb_fin)` observées : `0x80` dessine dans le tampon arrière, `0x100` directement en VRAM, `0x400` et `0x800` saut par clic/Échap, `0x1000` palette de 128 couleurs seulement (copie de 0x180 octets) et mode « copie + retour EMS », `0x2000` tampons de 0xF000 au lieu de 0x5000, `0x4000` (dans `154c:07c2`) décalage de palette par `13fc:0002`, `0x8000` lecture en boucle (`lseek(0)` puis relance), `0x10000` callback à chaque image. `154c:07c2` ajoute `0x2108` (écran direct) ou `0x2088` (tampon arrière) selon qu'un callback est fourni. **Probable** pour chaque bit ; la tâche 1.2 / 3.x les précisera.

## 3. Rendu

### 3.1 Mode vidéo et tampons (sûr)

- **Mode 13h** (320×200, 256 couleurs, 1 octet par pixel) : `3311:000a` fait `INT 10h AX=0013h`, mémorise le mode précédent (`INT 10h AH=0Fh`) et prépare en `SS:0000..018F` la table des 200 débuts de ligne (`y×320`) et le rectangle de clip `SS:0192..0198` (haut 0, bas 199, gauche 0, droite 319 ; `317b:01a6` / `01b9` le règlent). Ce n'est **pas** un mode X. La VRAM est `A000:0000` (`DS:3FB6`).
- **Tampon arrière = fenêtre EMS de 64 Ko** : `16dc:001a` alloue trois blocs EMS de 64 Ko (`12ec:0230`, `INT 67h` AH=43h) dont les handles sont `DS:030E` (A), `DS:0310` (B), `DS:0312` (C) (`iRam0003676e`, `…70`, `…72`), prend l'adresse du **cadre de pages EMS** (`12ec:0127`, AH=41h) comme tampon de dessin (`DS:3FB2`) et mappe A sur les 4 pages physiques (`12ec:02d1`). On dessine donc toujours dans le cadre de pages = le contenu de A.
  - A = tampon de travail ; B = **fond propre de la scène** ; C = sauvegarde temporaire.
  - `13fc:0411` = `12ec:037c(B, A)` : **restaure le fond** (copie B → A) puis `15f9:0755` ; c'est la façon d'effacer les sprites avant d'en redessiner.
  - `12ec:0314(src_far, handle)` copie 64 000 octets d'un tampon vers l'EMS ; `12ec:0348(handle, dst_far)` dans l'autre sens ; `12ec:037c(h1, h2)` copie handle → handle.
  - Certaines scènes permutent temporairement `DS:3FB2` vers un tampon de 64 000 octets en mémoire conventionnelle (`1a3c:0225`, `154c:052e`...).
- **Recopie écran** `13fc:03f9` : `30bb:0024(DS:3FB2, DS:3FB6)` copie 16 000 doubles mots (64 000 octets) du tampon arrière vers `A000:0000`, **sans attendre le retour vertical** (le test du retour vertical est fait séparément par `3311:00e4`, utilisé par les fondus et les chargements de palette), puis `15f9:0755` (pompe sonore, voir §5). Le jeu écrit donc l'image entière à chaque affichage (pas de rectangles sales).

### 3.2 Chargement d'un MCG et palette (sûr)

- `13fc:0084(nom, palette_far, pixels_far)` : ouvre le fichier (chemin résolu par `134d:03af`), lit **2 octets** (l'en-tête `0000`/`ff00`/`00ff`) dans la mémoire de la palette, lit ensuite **0x300 octets** au même endroit (la palette écrase donc l'en-tête), puis 64 000 octets de pixels. Réessaie 4 fois ; échec → dialogue d'erreur CD (`134d:0621`, touches A/R/I). **L'en-tête du MCG est donc ignoré** (confirmé : sur les 118 MCG, 107 ont `0000`, 10 `ff00`, 1 `00ff`). `154c:000f` et `134d:0529` font de même.
- **Palette courante** : tampon `DS:57C0` (768 octets, RVB **8 bits**). Chargement dans le DAC par `3311:01b1(buf, début, nombre)` : `OUT 3C8h,début` puis `OUT 3C9h, valeur >> 2` ×3 (donc **8 bits → 6 bits par décalage de 2**). Variantes inutilisées : `3311:013f` (16 entrées 4 bits), `3311:01f9` (12 bits).
- Autres tampons : `DS:4BC0` = copie fantôme du DAC (mise à jour par `1523:025d`), `DS:4EC0` = tampon de travail des fondus, `DS:54C0` = palette noire (BSS à zéro).
- **Couleur 0** : avant chaque envoi de palette complète, `1523:0235` met à zéro les 3 premiers octets du tampon : la couleur 0 est **toujours affichée noire**, quelle que soit la palette du MCG. Dans les MCG, 6 fichiers ont `ff00ff` en couleur 0 (aucun pixel d'indice 0 dans ces 6) et 3 fichiers utilisent l'indice 0 avec une palette 0 noire. Pour les vidéos MUX, `179a:0267` met aussi à zéro l'entrée 0 de la palette reçue. L'indice 0 est la clé de transparence des sprites HY8 (voir `hy8.md`). **Sûr.**
- `13fc:0150(nom, drapeaux)` : affichage standard d'un MCG. Drapeaux : `2` fondu au noir avant (`1523:01fa(0x10)`), `4` ne pas toucher la palette, `1` fondu d'entrée après (`1523:00ee(0x10)`), `0x4000` décale la palette (`13fc:0002` : déplace 0x180 octets et retranche 0x80 aux pixels), `0x200` copie finale de l'écran dans B (`12ec:0314`). Séquence : (fondu avant) → dessin dans le tampon arrière → (palette noire) → recopie écran → (fondu d'entrée) → palette réelle `1523:025d(0x57C0, 0, 0x100)`.

### 3.3 Fondus de palette (sûr)

- **Fondu au noir** `1523:01fa(n)` → boucle sur `1523:0116(n, 1)` (n = 16 par défaut, 32 dans `28a3:04dc`) : le compteur `cur` (`DS:19C`) va de 0 à n ; à chaque pas : `pal[i] = base[i] − (cur × base[i]) / n` (division entière) pour les 768 composantes de `DS:57C0` vers `DS:4EC0`, attente du retour vertical (`3311:00e4`), envoi au DAC (`1523:025d`), `cur += 1` ; à la fin `memset(A000, 0, 64000)` (l'écran est effacé). Soit n+1 pas, un par balayage vertical (environ 17 / 70 Hz ≈ 0,24 s à n = 16).
- **Fondu d'entrée** `1523:00ee(n)` → `1523:000b(n, 1)` : `cur` (`DS:19A`, −1 au départ) part de n et descend à 0 avec la même formule ; la palette de travail est d'abord mise à zéro. Entre deux pas, `1764:018a` (pompe) et le curseur éventuel (`14b3:055e`).
- Défaut de logique : si l'on enchaîne un fondu de 16 pas puis un fondu plus long sans le réinitialiser, `cur` reste à 17 (non réinitialisé car `n ≥ cur`) ; sans conséquence visible hors `28a3:04dc` (n = 32). Fondus utilisés : 0x10 partout sauf 0x20 dans `28a3:04dc` et la boucle de `1343:000c/001f(n) = (n+1)×16`.
- `1343:0037` : « fondu sonore » : réduit le volume maître de `DS:0212` à 0 par pas (`348d:097b(0x40, v)` + `1f33:00fc`).

### 3.4 Sprites et curseur

- **Blit HY8** : `31fe:0481(indice, x, y, hy8_far)` (le point d'entrée utilisé partout ; `31fe:0411`/`0449` basculent les variantes miroir). Le mot d'indice contient le numéro d'image dans les 12 bits bas (`indice & 0xFFF`) ; les bits `0x2000` et `0x8000` de l'indice (masque `0xA0` de l'octet haut), combinés avec l'octet d'attributs de l'image (bit `0x10`), sélectionnent des variantes de tracé (miroir / retournement : `31fe:0411` **modifie les octets du code** du blitter) ; les bits `0x1000` et `0x4000` sont ignorés ; le décalage `x, y` s'ajoute à chaque paire de coordonnées de l'image, qui est composée de plusieurs sous-blocs. L'index 0 est transparent. Le format est décrit dans `hy8.md` ; ne pas confondre avec le format plat de `plan.md`. **Probable** pour les bits d'indice, sûr pour l'interface.
- **Curseur de la bibliothèque (jamais affiché en jeu courant)** :
  - `14b3:055e` dessine un curseur logiciel **9 × 15 pixels** (flèche à 2 teintes), données en `DS:2F92` (135 octets : `00` transparent, `FF` contour affiché `FF+1 = 00` noir, `FE` remplissage affiché `FE+1 = FF` blanc) ; le point chaud est le coin haut-gauche (0,0). Fond sauvegardé dans `DS:2ECA` (`14b3:046e`), restauré par `14b3:04dd`. Il n'est dessiné que si `DS:192 ≠ 0` ; seule `14b3:063b` positionne ce drapeau et **personne ne l'appelle** (code mort : **probable**). Le jeu ne montre donc pas de flèche système.
  - `30d4` : curseur graphique 16 × 16 de bibliothèque (rappel `30d4:04a2`, masque réglé par `30d4:025a`) ; seulement utilisé par les chemins d'erreur (`134d:0621`, `179a:0002`).
  - Dans les scènes à pointeur libre (`DS:190 := 1` : S51 `19a8`, S35 `1bda`, S26 `1ed0`, S41 `2143`, S25 `260f`, S13 `2daf`, S24 `2e6a`), le pointeur est un **sprite HY8 propre à la scène**, dessiné aux coordonnées `DS:4BB9`, `DS:4BB7` (copie de travail de x, y) ; exemple S51 : sprite 22 de `s51a000s.hy8`, position bornée à `x ≥ 0x21` et `y ≤ 0xA5`. Le point chaud est celui de l'animation HY8 (`hy8.md`).

## 4. Entrées

### 4.1 Souris (sûr)

- Détection : `3134:037b` vérifie que le vecteur INT 33h n'est pas nul ni un `IRET` (`0xCF`), puis `INT 33h AX=0` (reset). Sans pilote, la souris est simplement inutilisée.
- Lecture 60 fois par seconde par le callback `3134:043c` : `AX=3` (seuls les 2 bits bas de BX sont gardés : bit 0 gauche, bit 1 droit, bit 2 centre ignoré) puis `AX=0Bh` (compteurs de déplacement en mickeys, **ajoutés tels quels aux pixels** : 1 mickey = 1 pixel, aucune mise à l'échelle). Position `DS:3FD6` (x) et `DS:3FD8` (y) bornée par `3134:0401` à 0..319 × 0..199. Pas de `AX=1`, `4`, `7`, `8`, `0Fh` : aucun réglage de curseur ni de sensibilité.
- Boutons fusionnés dans `DS:3FCE` (bit 0 gauche, bit 1 droit ; le clavier émule les mêmes bits, voir plus bas), puis dans **`DS:4BBD`** (`14b3:01c9`) : valeur 1 = gauche, 2 = droit, 3 = les deux. Les scènes testent `== 1` (valider) et `== 2` (aide vocale).
- **Navigation par les bords (comportement central)** : `14b3:004c` appelle `14b3:01c9` puis compare la position : `x < 2` → drapeau gauche (4) ; `x ≥ 0x13F` → droite (8) ; sinon `y < 2` → haut (1) ; `y ≥ 199` → bas (2) ; un drapeau levé replace le curseur au centre `(0xA0, 100)` (`14b3:0039`) ; sans drapeau, la position est conservée. Résultat dans **`DS:4BBB`** : bits 1, 2, 4, 8 = haut, bas, gauche, droite. Les menus utilisent ces drapeaux (la souris doit « pousser » contre un bord de l'écran) et le clavier lève les mêmes bits directement (`DS:3FC4`). Particularité de `14b3:01c9` : quand le bouton gauche est maintenu (`DS:4BBD & 1`), les drapeaux `DS:4BBB` sont masqués par `0xCD` (le drapeau bas est effacé) ; avec le bouton centre (`& 4`) le masque est `0xC7`.

### 4.2 Clavier

- INT 9 détourné (`3134:034a`, handler `3134:01d8`, vecteur sauvé en `CS:3134:112`) ; il décale un petit historique des derniers scancodes (`DS:367C..367E`), appelle `14b3:0314` (décodage) puis la routine de traduction `3134:021b` (sûr pour les appels ; le corps du handler n'est pas désassemblé par Ghidra).
- `14b3:0314` : suit Ctrl (`0x1D`, `DS:4BB6`), Alt (`0x38`, `DS:4BB5`), Suppr (`0x53`, `DS:4BB4`) et écrit **`DS:018E`** (`iRam000365ee`) = dernière touche : scancode brut si < 0x80, **+ 0x48 pour les touches étendues** (préfixe `E0`) ; 0 au relâchement. Ctrl+Alt+Suppr est absorbé (appel `12d7:0157`).
- Table de traduction `3134:000C + 2×scancode` (mot : type de handler dans les 3 bits hauts, paramètre dans les bits bas) :

| Scancode | Touche (QWERTY) | Effet |
|---|---|---|
| `0x48`, `0x50`, `0x4B`, `0x4D` | flèches haut, bas, gauche, droite | drapeaux haut (1), bas (2), gauche (4), droite (8) |
| `0x10`, `0x1E`, `0x2C`, `0x2D` | Q, A, Z, X | idem (haut, bas, gauche, droite) |
| `0x39` | Espace | bouton gauche (bit 0 de `DS:3FCE`) |
| `0x1C` | Entrée | bouton droit (bit 1 de `DS:3FCE`) |

  Une table `CS:3134:0148` permet d'échanger les touches pour un clavier AZERTY, mais l'indicateur `DS:3FE2` est lu à 0 (octet à +9 de la structure `DS:3F76` que `3601:0008` publie sous le vecteur INT 97h) et n'est jamais modifié : pas d'échange. **Sûr** pour la table, **probable** pour l'absence d'échange.
- Touches reconnues par le code :
  - **Échap** (`DS:018E == 1`) : saute une vidéo si le drapeau `0x800` est donné (`179a:0421`), abandonne l'attente `1f33:02c0` (scancode brut `DS:3FC8 == 1`).
  - **P** (`DS:018E == DS:C620`, `0x19`) : ouvre la pause S48 sur le plateau.
  - **F1** (`;`, scancode `0x3B`) / **F2** (`<`, `0x3C`) : volume − / + (`1764:00f4`, plage 0 à 15 dans `DS:0212`, répétition bloquée 20 ticks via `DS:6120`). **Sûr.**
  - **J** (`'$'`, scancode `0x24`) avec joystick actif : recalibrage (`14b3:008e`). Inutile ici (voir plus bas).
  - **A, R, I** (scancodes de langue `DS:C626`, `C624`, `C622` ; français `0x10`, `0x13`, `0x17`) : abandon / réessayer / ignorer dans la boîte d'erreur CD de `1764:01eb` ; `0x19` = pause.
  - **Touche `0x1E` dans S07** : sortie immédiate « Break ».
  - Pas de F3..F12, pas de saisie de texte.

### 4.3 Joystick (mort)

`14b3:0192` ne s'initialise que si `DS:0191` ≠ 0 ; ce drapeau n'est écrit nulle part (0 dans l'image) : le joystick est désactivé dans cette version. Le code existant (`309e:003a/00bd/0183`, port 201h, deux manettes, calibrage au centre avec seuils à ±50 %, boutons bits 0-1) est inutilisé. **Probable.** À ne pas réimplémenter.

### 4.4 Zones cliquables : il n'y a quasiment pas de table de rectangles

Principales conclusions (sûres) :

- Les menus S07, S08, S09, S04, S49, S46, S48 et la carte S02 **n'ont pas de zones** : la sélection avance avec les drapeaux de navigation `DS:4BBB` (§4.1), le choix se valide avec le clic gauche. Le bouton visé est identifié par sa couleur de palette (S07 : entrées 120 à 125) ou par un sprite HY8 que l'on place à une position fixe.
- Les zones apparaissent seulement dans les scènes à pointeur libre (`DS:190 = 1`). Elles sont calculées à l'exécution : par exemple S51 `19a8:0006` range des enregistrements de 10 mots `(x, y, …, xmin, ymin, xmax, ymax, état)` dans un tableau alloué (`DS:C7C0`) et teste `xmin < x < xmax` et `ymin < y < ymax` à chaque clic. Chaque scène a sa propre structure ; pas de table globale en DGROUP.
- Le plateau S01 utilise le **pion** et non le curseur : voir la table des portes du §1.4 (ce sont les seules zones définies en dur, sous forme de comparaisons dans `2813:*`).

**Exemple décodé pour le menu principal S07** (sûr) : il n'existe pas de rectangle. Les six boutons de `s07a001d.mcg` ont leurs textes aux lignes (indices de palette 120 à 125) :

| Index `SI` | Bouton | Indice de palette | Lignes (y) | Colonnes (x) | Voix `s07v` |
|---|---|---|---|---|---|
| 0 | Règles | 120 | 14 à 25 | 218 à 274 | 4 |
| 1 | Introduction | 121 | 45 à 55 | 196 à 296 | 5 |
| 2 | Schtroumpf | 122 | 75 à 86 | 198 à 293 | 7 |
| 3 | Jouer | 123 | 106 à 117 | 224 à 269 | 2 |
| 4 | Parents | 124 | 136 à 147 | 217 à 275 | 8 |
| 5 | Quitter | 125 | 167 à 178 | 217 à 278 | 6 |

(Lignes et colonnes mesurées sur les pixels de ces indices dans `S07A001D.MCG`.) Pour une réimplémentation avec souris libre, il suffit donc de faire correspondre une position à l'un de ces six boutons ; l'original n'a pas besoin de hit-test.

**Autre exemple de table (carte S02)** : `DS:1470` + `DS:15BA`, voir §1.8.

## 5. Son

### 5.1 Carte son : Sound Blaster (sûr)

- `15f9:0be9` initialise le son : `348d:07eb(5, 0x5DC)` (cinq tampons de 1 500 octets, **probable**). Un code d'erreur 1 à 7 sélectionne le message « (n) sound card problems » et **désactive le son** (`DS:19A3 := 0`, le jeu continue muet). Le son est actif par défaut (`DS:19A3 = 1`).
- Détection par la variable d'environnement **BLASTER** : `348d:03fd` parcourt l'environnement DOS (INT 21h/AH=62h) à la recherche de `BLASTER=` puis analyse les lettres `A` (port de base ; ports de commande à +0xC et +0xE), `I` (IRQ, `0x10` traité comme 10), `D` (DMA).
- La version du DSP est contrôlée : messages `"%s (dsp=%d.0%d <2.00)"` si < 2.00. Le volume maître se règle par `348d:097b(0x40, v)` (plage 0 à 15 dans `DS:0212`, valeur initiale déduite d'une lecture de `348d:097b(0x40, 0xFFFF)` ; la commande `0x80` règle un second volume, `DS:0216`) : probablement le mélangeur Sound Blaster Pro (**hypothèse** sur le détail des commandes de `348d:097b`).
- Le pilote de lecture est un lecteur par **DMA en anneau de 6 tampons de 0x9C4 = 2 500 octets** (`15f9:0367`, `15f9:05b6`). Fréquence = `1 000 000 / (256 − TC)` lu dans le VOC (`348d:097b(8, ...)`). Seul le premier bloc de données du VOC est lu (`15f9:0187` lit 3 octets d'en-tête de bloc puis 2 octets TC/codec à l'offset 0x1B ; longueur − 2) ; la lecture en boucle ré-ouvre le bloc à l'offset 0x1B. Sûr pour les VOC à un seul bloc de type 1 (voir la tâche 1.4 pour les blocs rencontrés).
- **Pas de CD audio** : la seule interruption 2Fh du programme est le test d'installation MSCDEX (AX=1500h, `30bb:004c`) qui sert à retrouver la lettre du lecteur de données. Aucun appel de commande de périphérique CD (INT 2Fh AH=15h sous-fonctions 10h, 08h…). Les pistes CD-DA 2 à 7 de l'image disque ne sont donc **pas utilisées** par la version DOS (**probable**).

### 5.2 Lecture : une seule voie (sûr)

`15f9:089f(nom_ou_tampon_far, options)` ("MyNoise", 42 appelants) ; l'option est un dword :

| Bit | Sens |
|---|---|
| `0x100000` | **interroger** : pompe le flux (`15f9:05b6`) et renvoie 1 tant qu'un flux est ouvert (la pompe le ferme à la fin du fichier) ; renvoie 0 si le son est désactivé ou terminé |
| `0x400000` | **arrêter** le son courant (`15f9:0313`) |
| `0x800000` | **lancer** un son (arrête d'abord le courant) |
| `0x200000` | avec lancer : **boucle** |
| `1`, `2`, `4` | source : `1` mémoire (pointeur), `2` disque (chemin résolu par `134d:03af`), `4` EMS (tampon `DS:5CA1`, premier mot = handle) |

Il n'y a **qu'une voie** : lancer un son coupe le précédent. Les scènes appellent `15f9:089f(0x6F04, 0xA00002)` en boucle dans leur attente : si rien ne joue (`0x100000` renvoie 0), la **musique de fond** `DS:6F04` (`s52m00Nm.voc`) repart au début en boucle. Une voix (`15f9:0e1c(nom)` = `089f(nom, 0x800002)`) interrompt la musique, qui redémarre depuis le début ensuite. **Sûr** pour le mécanisme ; l'absence de reprise de position est **probable**.

### 5.2 bis. Le canal de bruitage mélangé `348d:0b42` (sûr)

La voie unique ci-dessus est celle de `15f9:089f` (voix, musique, bips d'EMS). Le pilote Sound Blaster (`348d`) a **en plus un emplacement de bruitage mélangé**. RE de `348d:0b42`, `348d:015d` et `348d:021a` (`disasm.txt`) :

- **Signature** : `348d:0b42(mode, ptr)`, appel far, `mode` à `[BP+6]` (le dernier argument empilé, `PUSH ptr` puis `PUSH mode`), `ptr` far à `[BP+8]`. `mode` est un **masque de bits**, sans autre sens : `mode & 2` **enregistre** un son (le `2` de `0b42(2, ptr)`) ; `mode & 1` **interroge** (le `1` de `0b42(1, 0)`). Les deux peuvent se cumuler. Le pilote ne joue rien dans `0b42`.
- **Enregistrer** (`mode & 2`, `348d:0b53..0b85`) : `ptr` est un VOC déjà en mémoire (en-tête de 0x1A octets, bloc de données à `ptr + 0x1A`). Le pilote pose le pointeur de lecture `CS:E5/E7` à `ptr + 0x1B + 3` (soit `ptr + 0x1E`) et le **nombre d'octets restants** `CS:E1` (dword) à `longueur 24 bits du bloc − 4`. Il ne lit pas la fréquence du VOC : l'échantillonnage n'est pas converti (voir plus bas).
- **Interroger** (`mode & 1`, `0b87..0b99`) : rend `CS:E1` dans `DX:AX` (nombre d'octets restants ; `0 = rien ne sonne`). C'est le `OR AX,DX` des appelants, utilisé comme « un bruitage sonne-t-il encore ? » (`if (0b42(1, 0) == 0) 0b42(2, ptr)`) ou comme attente de la fin du son (`while (0b42(1, 0)) 1764:018a`). Sans bit 1 ni bit 2, la fonction rend 0.
- **Un seul emplacement** : il n'y a ni file ni liste (un pointeur, un compteur). Un nouvel `0b42(2, ptr)` **remplace** le bruitage en cours, de force, sans toucher à la voie, à la musique ni à la vidéo. Plusieurs appels à la suite ne gardent que le dernier (S33 enchaîne trois sons, un par emplacement, à chaque proposition).
- **Mélange** (`348d:015d`, interruption de fin de tampon DMA, appelle `348d:030d` qui remplit la moitié de tampon avec la voie, puis `348d:021a` qui y **additionne** le bruitage) : `021a` lit `min(taille de demi-tampon CS:0C, octets restants)` octets du bruitage, les ajoute **octet à octet** à ceux de la voie déjà écrits (échantillons 8 bits non signés, centrés sur `0x80`, somme saturée à −128..127), décrémente `CS:E1` et avance `CS:E5/E7`. Sans reste (`CS:E1 == 0`), elle ne fait rien.
- **Fin d'un bruitage** : quand `CS:E1` tombe à 0, `021a` ne fait plus rien : **rien n'est arrêté ni signalé**, la voie et la musique continuent. La fin se constate seulement par `0b42(1, 0)`.
- **Volume général** : `021a` n'applique **aucun** facteur (ni `DS:0212` ni autre) ; le volume 0 à 15 de F1 / F2 passe par `348d:097b(0x40, v)` (probablement le mélangeur matériel du Sound Blaster, **hypothèse**) donc agit en aval du mélange DMA : il s'applique au bruitage **comme à la voie**. Le TS le reproduit en passant les deux sources par le même `GainNode`.
- **Cadence** : le mélange n'a lieu qu'à chaque remplissage de demi-tampon, donc tant que le flux DMA tourne (voix, musique ou vidéo). Si `030d` n'a plus rien à lire, `015d` appelle `348d:07ae` (arrêt du DSP). **Non reproduit** (hypothèse, à vérifier au son) : le TS joue le bruitage même quand aucune voie ne sonne ; dans l'original, un bruitage lancé sans flux ouvert n'est entendu que si un flux démarre ensuite.
- **Fréquence** : les octets du bruitage sont additionnés tels quels à ceux de la voie : un VOC dont la fréquence diffère de celle du flux est joué à la fréquence du flux (hauteur décalée). **Non reproduit** : le TS joue chaque bruitage à sa propre fréquence.

**Recensement des appels** (`grep` de `-> 348d:0b42` dans `disasm.txt` : 90 appels `CALLF`, aucun appel proche ni saut ; les rappels vidéo que Ghidra n'a pas vus, comme `1f84:02ce`, sont lus dans l'exécutable). Un appel `0b42(1, 0)` est une interrogation, un appel `0b42(2, ptr)` un lancement ; `s07a001b` est le bip de navigation (`DS:7084` ou une copie chargée par la fonction elle-même).

| Fonction | Scène | Appels | Son(s) lancé(s) par `0b42(2, ·)` | Condition |
|---|---|---|---|---|
| `1c78:0005` | S22 | 9 | `s22a001b` (rugissement), `s22a002b` (brûlure), `s22a003c` / `s22a004c` (poses) | rugissement si rien ne sonne ; attente de la fin avant la sortie |
| `2e6a:0001` | S24 | 3 | `s24a001b` (juste), `s24a002b` (faux) | juste si rien ne sonne ; faux toujours |
| `260f:000e` | S25 | 3 | `s25a001b` (clic) | toujours ; attente de la fin avant le fondu sonore |
| `1f84:02ce` (rappel, hors `disasm.txt`) | S27 | 4 | `s27a002b` (pas de la luge) | si rien ne sonne et pas ramené à une borne |
| `2573:06e3` | S28 | 2 | `s28a002b` (touché), `s28a003b` (raté) | toujours |
| `1da0:0009` | S29 | 3 | `s29a001b` (souffle), `s29a002b` (à vide), `s29a003b` (rallumage) | toujours |
| `2f87:0656` | S31 | 8 | `s31a002b` (saut), `s31a003b` (plouf) | si rien ne sonne |
| `1ceb:000c` | S33 | 7 | `s33a001b` (déplacement), `s33a003b` / `s33a004b` (bien placé / autre) | toujours |
| `1b05:0929`, `1b05:0b96` | S34 | 5 | `s34a001b` (battement, contact sol / plafond), `s34a004b` (choc) | battement si rien ne sonne ; choc toujours, au contact |
| `1bda:0021` | S35 | 4 | `s35a001b` (peint), `s35a002b` (faux) | si rien ne sonne |
| `2143:01cd`, `070c`, `08a1` | S41 | 9 | `s07a001b` (question, zone, confirmation) | si rien ne sonne |
| `19a8:0006` | S51 | 4 | `s51a001b` (ouverture), `s29a002b` (fin) | si rien ne sonne |
| `2daf:0006` | S13 | 3 | `s07a001b` | si rien ne sonne |
| `1a3c:0225` | S02 (carte) | 3 | `s07a001b` | si rien ne sonne |
| `21ee:0e8f` | S07 | 3 | `s07a001b` | toujours |
| `21ee:0435`, `21ee:0c19` | S08 | 11 | `s07a001b` | bouton : toujours ; personnage : si rien ne sonne |
| `21ee:13a1` | S04 | 1 | `s07a001b` | toujours |
| `269a:0007` | S48 (pause) | 3 | `s07a001b` | si rien ne sonne |
| `1823:000c` | S49 (confirmation) | 3 | `s07a001b` | si rien ne sonne |
| `1823:0415` (+ copie `1823:0e21`) | S46 (abandon) | 3 (+ 3) | `s07a001b` | si rien ne sonne |

**Aucun** appel dans S23 (`24d0`), S26 (`1ed0`), S30 (`2d6b`), S36 (`23c9`), S38, S39, S40 (`2ee8`), S09 ni S01 : leurs sons passent par `15f9:089f` (une voie) ; le « clic » de S40 (`s07a001b`) aussi (`15f9:089f(·, 1, 0x80)`). La crête de S27 (`s27a003b`, chute) reste sur la voie.

**Moteur TS** : `AudioBackend.playEffect / stopEffect / effectPlaying` et `VoiceChannel.playEffect / stopEffect / effectPlaying` (`engine-ts.md`, section Son). Les scènes ci-dessus lancent leurs bruitages par `ctx.voice.playEffect` et testent « rien ne sonne » par `ctx.voice.effectPlaying` (et non par `voicePlaying`).

- Pompe : `15f9:0755` (qui appelle `15f9:05b6` et `15f9:0313`) est exécutée à **chaque recopie d'écran** (`13fc:03f9`, `13fc:0411`), à chaque `1764:018a` (pompe générale) et dans les copies EMS (`12ec:0314/0348/037c`) pour lire la suite du fichier dans les tampons ; sans ces appels le flux manquerait de données. **Sûr.**
- Sons courts en EMS : trois VOC préchargés par `305a:0008` (`s52d001b.voc` en `DS:8349`, `s01a002b.voc`, `s01a001b.voc`) et joués par `15f9:089f(&handle, 0x800004)` ; par exemple le « tic » de points de `1e52:00ad`.

### 5.3 Musique : table scène → musique

| Scène | Musique |
|---|---|
| S07, S08, S09, S04, S46, S48, S49, S45, S02, S10... (menus) | `s52m00Nm.voc`, N tiré à l'entrée de `21ee:0006` (1 à 3) ; reprise en boucle tant que rien ne joue |
| Plateau S01 | `28a3:0007` retire N (1 à 3) à chaque tour ; boucle comme ci-dessus |
| Générique (S52) | `s52m002m.voc` chargé en EMS, boucle (`0xA00004`) |
| Mini-jeux | pas de musique de fond système repérée ; sons propres (`sNNa00Nb.voc`, `…c.voc`, `…d.voc`, `…e.voc`) |
| Vidéos MUX | pistes son 8 bits intégrées (voir `mux.md`) |

Les fichiers `S52M001M.VOC` (1,4 Mo), `S52M002M.VOC`, `S52M003M.VOC` sont les trois musiques. **Sûr** pour S07 et le plateau ; **probable** pour l'absence de musique dans les mini-jeux (aucune référence à `DS:6F04` n'a été cherchée dans chacun).

### 5.4 Textes sonores
Voir §7 pour les voix `sNNv%dt.voc`.

## 6. État de partie

### 6.1 Globales principales (offsets DGROUP)

| Adresse | Type | Rôle |
|---|---|---|
| `DS:6E2C` | int | **nombre de joueurs** `d28c` (1 à 4), fixé par S09 |
| `DS:6E2A` | int | **joueur courant** `d28a` (0 à `d28c−1`) |
| `DS:6EB4 + 0x14×i` | struct 20 o | joueur i (4 emplacements jusqu'à `DS:6F03`) |
| `DS:6EA4` | int | durée de la partie en **secondes** (`(index+1)×1800`) |
| `DS:6EA0` | int | index « pause obligatoire » (0 à 4) |
| `DS:6EA2` | int | index du message de fin de temps (0 à 8) |
| `DS:6E9C` | u32 | horodatage (minutes) de la fin de la dernière partie |
| `DS:6F36` | octet | 1 pendant une partie |
| `DS:6EB3` | octet | variante du fond de carte (`s02a007d.mcg`) |
| `DS:6F04` / `DS:6F22` | chaînes | nom de la musique / de la voix courante |
| `DS:6E4C + 4i` | u32 | chronos (slots 0 à n) |
| `DS:19A2/19A3/19A4` | octets | débogage son / son actif (1) / saut du logo (0) |
| `DS:199E` | octet | mode 1 joueur de debug (0, jamais modifié) |
| `DS:0212` | int | volume maître (0 à 15) |

**Joueur (20 octets), probable** : `+0` (`6EB4`) personnage (0..5, la correspondance depuis les 6 icônes de S08 est `4→4, 5→0, 6→5, 7→2, 8→1, 9→3`) ; `+2` (`6EB6`) teinte 0..2 choisie dans S08 (écrasée par un tirage 0..2 dans la carte libre) ; `+4` (`6EB8`) x (`0x0B` au départ) ; `+6` (`6EBA`) y (`0x38`) ; `+8` (`6EBC`) écran 1..9 (1 au départ) ; `+A` (`6EBE`) masque des ingrédients (8 bits) ; `+E` (`6EC2`) points (plafonnés à 60, `1e52:00ad`) ; `+10` (`6EC4`) état (0 à 6) ; `+12` (`6EC6`) direction (1 = droite) ; `+13` (`6EC7`) direction (1 = gauche). Le partage de la victoire : (ingrédients requis `DS:7E18` tous présents dans `+A`) et (`+E` ≥ `DS:7E19`) où `DS:7E19` vient d'un tableau `1e52:0271` indexé par durée et nombre de joueurs. Détail des règles : tâche 2.3.

### 6.2 Menus d'initialisation de partie

- **S09** `21ee:01d2` : choix du **nombre de joueurs** (1 à 4 silhouettes dans `s09a001d.mcg`, gauche/droite, sprite 0 de `s09a000s.hy8` pour colorer les silhouettes choisies) ; clic gauche valide ; retourne 1 à 4. Le nom « Temps et mission » de `DESCRIPT.ION` ne correspond pas à ce qu'on voit : ni temps ni mission (**sûr**). Voix `s09v00Nt.voc`.
- **S08** `21ee:0435` : pour chaque joueur, choisir un des 6 personnages encore libres (gauche/droite = personnage, haut/bas = teinte 0 à 2, sprites 4 à 9 de `s08a000s.hy8`, voix `s08v`), animation d'entrée, voix `s08a001b.voc`. `21ee:0c19` : trois boutons verticaux (sprites `0xE`, `0xF`, `0x10`, x = `0x109`, y = `0x83`, `0x9B`, `0xB3`), retourne **0** (jouer), **1** (retour S09), **2** (retour S07). **Sûr.**
- **Hasard** : générateur congruentiel de la bibliothèque Borland : `seed = seed × 0x015A4E35 + 1`, retour de `(seed >> 16) & 0x7FFF` (`1000:07a7`). `1f33:0085` appelle `srand(time(NULL) & 0xFFFF)` (`1000:0796`, graine 32 bits = valeur basse, haute à 0). Tirage uniforme `[0, N)` : `rand() × N / 0x8000` (division entière). **Sûr.** Aucun tirage n'est « graine fixe ».

### 6.3 Options parents S04 et fichier `c:\smurf.cfg` (sûr)

- **S04** `21ee:13a1` (fond `s04a001d.mcg`, sprites `s04a000s.hy8`) : trois réglages, ligne choisie par haut/bas, valeur par gauche/droite, validation au clic gauche :
  1. **Durée de la partie** : 0..3 ; `d304 = (v+1) × 0x708` secondes (30, 60, 90, 120 minutes) ;
  2. **Pause avant de pouvoir rejouer** : 0..4 ; `d300 × 30` minutes ;
  3. **Message de fin** : 0..8, parmi 9 phrases (« Finir ses devoirs. », « Aller goûter. », « Aller prendre son bain. », « Aller au lit. », « Suffisant pour l'instant. », « Aller jouer à autre chose. », « Aller reposer ses yeux. », « Aller aider son père. », « Aller aider sa mère. »), existantes en français, anglais, allemand ; correspond aux 9 vidéos par série `s42a041..076`.
- **Fichier `c:\smurf.cfg`** (`21ee:13a1`, `21ee:1c92`, `main`), écrit à la validation de S04 et à chaque fin de partie : **10 octets** = `u16 durée_index (0..3)`, `u16 pause_index (0..4)`, `u16 message_index (0..8)`, `u32 horodatage minutes (time(NULL)/60)` (le programme écrit les trois premiers via `35bc:011c` avec 2 octets chacun et le dernier avec 4 octets depuis `DS:6E9C`). À défaut de fichier, tout vaut 0 (durée 30 min, pas de pause, premier message).
- **Verrou parental** `21ee:1d6b` (appelé au choix « Jouer ») : renvoie 0 (verrouillé) si `(time(NULL)/60) − d2fc < d300 × 30` minutes, c'est-à-dire si le délai de pause n'est pas écoulé depuis la dernière partie ; renvoie 1 sinon. Avec `d300 = 0`, jamais verrouillé. Le choix est alors ramené à 10 (le menu reste affiché, sans message repéré).

### 6.4 Sauvegarde

- **Il n'y a pas de sauvegarde de partie.** Les seules écritures de fichiers de tout le programme (`35bc:011c`) sont `c:\smurf.cfg` et `save000.mcg`.
- `save000.mcg` (`134d:0a75` → `134d:09cf`) est une **capture d'écran** : écrit 2 octets, 0x300 octets de palette (`DS:57C0`) et 64 000 octets de la VRAM, en cherchant un nom libre en incrémentant les chiffres de `save000` (`DS:6506..6508`). Aucun appelant direct n'a été repéré (fonction de debug, déclencheur indirect probable) ; sans rapport avec la sauvegarde de partie. Ne pas implémenter.
- `DP_PREFS` n'est pas lu par l'exécutable (formats ignorés par le plan).

## 7. Textes, voix et chemins de fichiers

- **Chemins** (`134d:029b`, `134d:03af`) : un nom `sNNxXXX.ext` est développé en `sNN\sNNx\sNNxXXX.ext` (gabarit `s??\s???\`, `134d:03af`) puis essayé dans l'ordre : le chemin tel quel, `<lecteur CD>:\data\jeu_<langue>\...`, `<lecteur CD>:\data\jeu_f\...`, `d:\projet\smurf\data\jeu_<langue>\...`, `d:\projet\smurf\data\jeu_f\...`. Dans notre arborescence : `DATA/SNN/SNNx/SNNXXX.EXT` (le dossier `jeu_f` est la racine `DATA/`). Si le fichier est introuvable : erreur fatale « %s load error. » ou dialogue CD (A/R/I) selon la fonction. **Sûr.**
- `134d:0822(nom, 0)` charge un fichier entier en mémoire ; `134d:088b` le charge en EMS.
- **Voix** : `15f9:0db1(dest, préfixe, a, b)` calcule `n = a + b` et fabrique `dest = préfixe + "00"|"0"|"" + n + "t.voc"`, soit `%s%dt.voc` avec zéros de remplissage sur 3 chiffres : `("s07v", 4)` → `s07v004t.voc`, `("s09v", 1, rand%3)` → `s09v001t.voc` à `s09v003t.voc`. Les suffixes `t` sont les voix parlées ; `b` (bruitages), `c`, `d`, `e` sont des sons de mini-jeux (`sNNa00Nb.voc`...). Choix du numéro par scène : S07 (`21ee:0e8f`) un numéro fixe par bouton ; S08 `s08v` : 1+n (`1 + teinte + 0xE`), `7 + rand%5` ; S09 `s09v` : 1+rand%3 puis 4 ; S49 `s49v` : `1 + n` ; S46 `s46a` : n ; S45 `s45a003t.voc` ; S19 `s19v` 1, 2+k, 10+k ; S42 `s42v` dans `1e52:00ad` : base selon le personnage (0x8D, 0x9C, 0x95, 0xA0, 0x91, …) + variante aléatoire 0/1 ; introduction de mini-jeu : `sNNa` + `1 + rand%2` (`28a3:04dc`).
- **Textes `.DAT`** : fichiers texte CP437, lignes `"CLÉ"` entre guillemets suivies du texte jusqu'à `\r` ; les lignes commençant par `#` sont des commentaires. `1823:170a` (S49) cherche la clé caractère par caractère puis copie la ligne ; le tri des questions de `s40a.dat` (S40) tire un numéro `0..43` (44 propositions) en évitant les 5 dernières posées (`DS:7C80..7C84`) et un indicateur de catégorie (numéros ≥ 13). Les phrases du menu parents et les messages d'erreur sont **en dur** dans l'EXE (en 7 langues). **Sûr** pour S49, **probable** pour S40 (format des réponses : proposition + bonne réponse + deux fausses, voir la note de l'en-tête de `S40A.DAT`).
- **Polices** : sélection par `32f4:0123(handle, index)` (indices `0x7E`, `0x7F`, `0x86`...), largeur d'une chaîne `32f4:0192`, dessin `32f4:0018(x, y, tampon, chaîne)`. Format dans `pfn.md`.

## 8. Questions ouvertes

1. **Constante « 12 »** du rapport PIT / images de `mux.md` : non retrouvée dans le code ; la synchronisation semble pilotée par la position audio (hypothèse §2.3). À confirmer avec DOSBox ou en suivant `3412:0209`.
2. **Horloge de jeu pendant les vidéos** (`179a:05d0` et diviseur de l'en-tête) : à confirmer.
3. **Déclencheurs des animations S13 à S21** par écran (`2a78:00da`, condition `cRam0003de3b`) : à documenter avec les règles (tâche 2.3).
4. **Chrono global et pause** : le chrono 0 est-il gelé pendant S48 ? Seul le slot 1 est sauvegardé/restauré dans ce qui a été lu.
5. **Musique des mini-jeux** : confirmer par fonction qu'aucun ne change `DS:6F04`.
6. **Flags du MUX** (§2.3) : chaque bit est probable ; une recherche par fichier (qui passe quels flags) manque.
7. **Bouton « Schtroumpf » (S07, index 2)** : nom et intention du mode `1a3c:002a` (mode libre ?) à valider visuellement ; le texte à afficher est dans le MCG.
8. **`30d4` (curseur 16×16)** : confirmer qu'il n'est vraiment affiché que dans les écrans d'erreur.
9. **Retour 10 du verrou parental** : pas de message d'explication repéré (l'utilisateur voit seulement que « Jouer » ne démarre pas).
10. **Structure joueur** (+0xC, +0x10, +0x12/0x13) et `DS:7E18/7E19` : interprétation à confirmer par la tâche 2.3.
11. **`save000.mcg`** : déclencheur non identifié.
12. **Scènes S36 (cadence `DS:71C6`) et celles du §2.2 « autres »** : cadence à relire scène par scène.
13. **Version anglaise/allemande** : seule `jeu_f` est présente ; le code gère `a` et `g` pour les textes en dur.
14. **Canal de bruitage mélangé `348d:0b42`** : **fermée** (§5.2 bis). RE faite, canal ajouté au moteur TS. Restent deux hypothèses sans effet audible vérifié : le mélange n'a lieu que tant qu'un flux DMA tourne, et le bruitage est joué à la fréquence du flux et non à la sienne.

## 9. Conseils pour l'implémentation TypeScript (tâche 2.2)

1. **Horloge** : une boucle à pas fixe de **60 ticks/s** (`1193182/19886`). Fournir `ticks`, `centiseconds = ticks*100/60`, `seconds`. Les primitives d'attente de l'original (`wait(cs)`, `waitSeconds`, `frameLimiter(n)`, chrono par slot, gel/reprise des chronos) se traduisent par des états de scène, pas par des boucles bloquantes : écrire chaque scène comme une machine à états pilotée par `update(dtTicks)`.
2. **Cadences** : chaque scène a un pas de `n` ticks (5 pour la plupart des mini-jeux = 12 i/s, 4 pour le plateau, 3 pour la carte). Réutiliser `n` comme paramètre de scène. Les vidéos suivent l'audio (voir `mux.md`).
3. **Surface** : indexée 320×200 en 8 bits + palette de 256 entrées RVB 8 bits. À l'affichage, convertir en canvas avec la palette courante ; **forcer l'entrée 0 à noir**. Le DAC VGA ne garde que 6 bits par composante (`v >> 2`) : pour reproduire les couleurs d'origine, afficher `(v >> 2) × 255 / 63`.
4. **Tampons** : prévoir le tampon de travail (A), le **fond de scène** (B, restauré à chaque image pour effacer les sprites) et une sauvegarde (C). Fonctions de base : `restoreBackground()` (B → A), `present()` (A → écran). Copier l'image entière à chaque présentation suffit.
5. **Fondus** : implémenter `fadeOut(n=16)` / `fadeIn(n=16)` par `pal[i] − floor(cur × pal[i] / n)` sur 17 pas d'un balayage vertical (≈ 70 Hz, soit 0,24 s) ; `fadeOut` laisse un écran noir. Ne pas reproduire le défaut de `cur` non réinitialisé.
6. **Entrées** : exposer **navigation haut/bas/gauche/droite** + **clic gauche** (valider) + **clic droit** (aide vocale / annuler) comme dans l'original. Pour la souris, l'original ne fait pas de survol : il traduit des mouvements relatifs poussés contre un bord de l'écran en drapeaux haut/bas/gauche/droite. Une réimplémentation peut soit imiter cela (accumuler les déplacements et lever un drapeau au bord), soit faire un survol des boutons dessinés ; les deux donnent le même résultat visible (choix du bouton, puis clic gauche). Clavier : flèches (et Q/A/Z/X), Espace = bouton gauche, Entrée = bouton droit, Échap = saut de vidéo, P = pause, F1/F2 = volume. Pas de curseur système sur les menus ; sprite HY8 dédié dans S51, S35, S26, S41, S25, S13, S24.
7. **Menus par sélection** : modéliser S07/S08/S09/S04/S49/S46/S48/S02 comme des listes de choix avec index courant, pas des zones ; la surbrillance d'un bouton S07 = remplacer sa couleur de palette (index 120+i) par `(0x10, 0xA4, 0xCC)`.
8. **Son** : **une voie voix/musique** (comme l'original) : lancer un son coupe le précédent, plus **un canal de bruitage mélangé** (§5.2 bis : un seul emplacement, additionné à la voie sans la couper), la musique `s52m00Nm.voc` redémarre en boucle quand rien ne joue ; trois bips préchargés pour les petits effets ; volume 0 à 15. Pas de CD audio (les pistes CD ne sont pas extraites). Ne pas oublier le déblocage audio par un premier clic.
9. **Aléatoire** : reproduire `rand` Borland (`seed = seed×0x015A4E35+1`, `(seed>>16)&0x7FFF`) et les tirages `rand()*N/0x8000`, graine `Date.now()/1000 & 0xFFFF` ; ou fixer la graine pour les tests.
10. **Options parents** : stocker en `localStorage` (`durée 0..3`, `pause 0..4`, `message 0..8`, `horodatage`), à la place de `c:\smurf.cfg` ; durée = `(idx+1)×1800 s`, verrou = `d300×30 min`. Pas de sauvegarde de partie.
11. **Chemins** : développer `sNNxXXX.ext` en `DATA/SNN/SNNx/SNNXXX.EXT` ; voix `sNNv` + `%03d` + `t.voc`.
12. **Ordre de démarrage** : logo S52D0 (MUX puis attente jusqu'à 3 s, clic ou Échap pour passer), S06 intro (skippable, `0x400|0x800`), S05 titre (1 s, `1f33:02c0(1)`), puis menu. Le retour d'une partie ne rejoue pas le démarrage.
13. **Priorités d'implémentation** : (1) horloge + scènes + entrées + surface/palette/fondus, (2) lecteur voix/musique, (3) menus S07, S08, S09, S49, (4) MUX, (5) plateau.

## Annexe : comment vérifier

- `grep` de l'adresse dans `archives/teleportaschtroumpf/re/decomp/<seg>_<off>_*.c` ; `disasm.txt` pour le texte brut (`; ===== seg:off` en tête de fonction).
- Lire une table de `switch` : octets à l'offset fichier `0x4200 + seg×16 + off − 0x10000` (mots 16 bits LE).
- Lire une donnée DGROUP : offset fichier `0x4200 + 0x26460 + off` (valable jusqu'à `DS:0x443A`).
