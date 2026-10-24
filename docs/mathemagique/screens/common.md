# Écrans communs : titre, Control Room (hub), crédits, Hall of Fame, connexion / roster

Tâche E1 (étude de rétro-ingénierie, `MATH` v1.01 de 1994, Math Workshop MPC). Ce document couvre les écrans qui ne sont pas des activités : **titre** (scène 8, `TITLE.DAT`), **hub / Control Room** (scène 0, `MAINSCRN.DAT`), **crédits** (scène 9, `CREDITS.DAT`), **Hall of Fame** (scène 10, `TROPHY.DAT`), plus le module de **connexion / préférences / roster / Math Trivia** (segment `1080`, dessiné dans le hub), les **séquences secrètes**, la **sortie** du jeu et l'**impression des certificats** (segment `1088`).

Les adresses sont des `sélecteur:offset` Ghidra de `MATH` (voir [../re-index.md](../re-index.md) et [../engine.md](../engine.md)) ; `DS:xxxx` désigne le segment de données `1108`. « **Hypothèse** » marque une déduction non vérifiée. Les noms de fonctions `scene_*` sont ceux du re-index. Les images citées ont été rendues avec les lecteurs TS du dépôt (`data/{mohawk,shap,shpl,palette,scr,wave,strl}.ts`) et regardées une à une ; les fichiers de travail sont hors dépôt.

## 0. Constats préalables et conventions de lecture

1. **Poly est une fille, pas un perroquet.** L'hôtesse du hub est Poly Gonzales (manuel v2, p. 14), une fillette brune en salopette (SHAP `MAINSCRN` 104, `SCR` 2600–8800). L'énoncé de la tâche parle d'un perroquet : confusion probable avec `POLLY.DAT` (même personnage, animations d'aide dans les activités) ou avec Algebird (l'oiseau du manuel). Tout ce qui suit parle de **Poly (la fille)**.
2. **Le hub a deux tables de rectangles différentes** : les *boutons* cliquables (14 + 3 + 9 enregistrements de 20 octets en `DS:0c70`, `0d98`, `0e20`, §2.4) et la table de *survol / aide* de 15 `RECT` en `DS:1050` (§2.4.4). [../engine.md](../engine.md) §1.5 et §8.1 les confond (voir §11).
3. **Les gadgets `10a0`** (boutons graphiques) ont la structure suivante, établie à partir de `10a0:0000`, `10a0:08ca`, `10a0:1dd4`, `10a0:03d4` et des tables du hub, du titre et du trophée :
   - `10a0:0000(groupes, nombre, drapeaux)` installe les groupes de la scène (`DS:3538`, `88b6`, `88b4`) ; un **groupe** = 12 octets : `far ptr tableau de boutons`, `u16 nombre de boutons`, `u16 drapeaux` (bit 0 = groupe inactif, utilisé par le hub quand le moniteur est ouvert), `far ptr rappel(indice)`.
   - un **bouton** = 16 octets : `far ptr vtable` (`DS:3580` = bouton invisible sans image ; `DS:1b4e` = bouton à 3 états de `1038` ; `DS:35da` = flèches de `10a0:1bcc…`), `far ptr enregistrements`, `u16 nombre d'enregistrements` (`+8`), `u16 drapeaux` (`+0xa`, `0x2068` / `0x206c` = action au clic, `0x8040` = boutons image), `far ptr table de sons` (`+0xc`, paires `(son appui, son relâchement)` par enregistrement, `10a0:0563`).
   - un **enregistrement** = 20 octets : `RECT(gauche, haut, droite, bas)` puis 12 octets d'état, drapeaux en `+0x12` (bit 0 = masqué, bit 1 = désactivé, bit 2 = enfoncé / sélectionné). Le rappel du groupe reçoit l'**indice 1 à n de l'enregistrement** (`10a0:08ca` ramène `(groupe, indice, …)`).
   - Rectangles : `x ∈ [gauche, droite[`, `y ∈ [haut, bas[` (`10b0:0711`).
   - Les trois boutons de souris déclenchent la même chose (`1008:05c0` → `10a0:001b`), le numéro du bouton n'est que mémorisé en `DS:4b34`. Clavier : Tab / Maj+Tab (`0x9` / `0x809`) parcourent les enregistrements actifs (`10a0:0aed`), Entrée (`0xd`) active celui qui est survolé ou, à défaut, celui qui a le focus (`10a0:098e`).
4. **Codes de touches** vus par les scènes (`1098:0966`, `1098:036f`) : `WM_CHAR` donne le code ASCII ; flèches (`VK 0x25–0x28`) et F1–F12 donnent `VK + 0x7f` (haut = `0xa5`, bas = `0xa7`) ; Maj ajoute `0x800`, Ctrl `0x400` ; Tab = `9`, Maj+Tab = `0x809`. Globaux (`1008:0859`) : Ctrl+Q (`0x11`) quitte, Ctrl+V (`0x16`) affiche « À propos ». L'ordre de traitement est : gadgets → `Key` de la scène → globaux.
5. **Tick** : 60 Hz nominal (17 ms) ; toutes les durées ci-dessous en « ticks » sont en `DS:8722`. 60 ticks ≈ 1 s.
6. **Fond d'écran** : chaque scène charge `SHPL 100 + k` (576 × 432, palette 10–245) par `1018:0000(k)` ; les calques sont des `SHPL` supplémentaires dessinés avec `10a8:0ce4(shpl, indice, x, y, mode)` (mode 0 = opaque, 8 = indice 0 transparent). Voir [../shap.md](../shap.md).
7. **Textes à l'écran** : presque tous cuits dans les images (l'anglais est dans les formes). Seuls vrais textes dessinés par le code : noms des joueurs et « Rank: » + grade (Hall of Fame), liste des noms et zone de saisie du moniteur, champ du timer.

---

## 1. Écran titre (scène 8)

Descripteur `DS:26a0` : `Enter 1068:0364`, `Leave 1068:0505`, `Tick 1068:05af`, pas d'`Exit`, pas de `Key`, pas de variables sauvegardées. Première scène du programme (`1008:0000` pose `1b20 = 8`).

### 1.1 Flux

| Étape | Code | Effet |
|---|---|---|
| Enter, archive | `1068:0364` | ouvre `title.dat` (`DS:2760`) → handle `DS:7bb2`, archive courante ; remet à 0 `7bc0` (premier tick), `7bbc` (musique lancée), `7bba` (prêt) |
| Enter, **logo** (seulement si `7bbe == 0`, donc au démarrage du programme, pas au retour des crédits) | `1068:0398`–`041c` | remplit le port de travail en couleur d'indice `0x15` (`10d8:3006` : hypothèse « fond noir »), charge `SHPL 200` (SHAP 200, 265 × 119, « Brøderbund PRESENTS ») → dessiné en **(155, 140) mode 8**, présente, **fondu d'entrée** (`1088:1b25`, mode 1, durée 30, couleurs 10–245), arme `DS:871a = 300` (5 s) |
| Enter, fond | `1068:0422`… | `7bbe = 0`, `1018:0000(5)` (charge `SHPL 105` fond plein écran, palette 10–245, le dessine) ; `1018:0097(5)` ; installe le groupe de boutons `DS:2694` (1 groupe, 1 bouton à 2 enregistrements, `0xc000`) |
| Horloge | `1068:0785` | lit l'heure (`1098:0660`), arrondit la minute au pas de 5 (`+1` si `minute % 5 > 2` ou `= 2` et secondes `>= 30`) ; l'heure (24 h) perd 12 si elle dépasse 12 (12 h reste 12), installe l'animation `500` sur le port de travail et l'avance **sans attendre** jusqu'à l'image `heure12 × 12 + pas + 1` (`1090:0432`) : l'heure est dessinée **une fois** dans le décor (cadran de la façade, ~ (287, 230)), pas animée |
| Animations | `1068:044a`–`049b` | `1090:1464` (installe + 1re étape) sur les 9 animations de `DS:26b8…2718`, `1090:1024` (installe seulement) sur celle de `DS:2724` (`SCR 10000`, porte) |
| Son | `1068:04a4` | précharge `\0SND 1000` (musique) |
| Attente du logo | `1068:04b2` | `1088:1091(compteur 0, masque 3, consomme 1)` : attend la fin du compte à rebours **ou** un clic/une touche (le compte à rebours n'a été armé qu'à la 1re entrée : sans logo, rend la main tout de suite) |
| Fondu | `1068:04bc`–`0501` | fondu vers noir, présente le titre, `sndStop(tous les MIDI)`, `7bbc = 1`, fondu d'entrée |

**Tick** (`1068:05af`, garde de réentrance `DS:275e`) : boucle sur 10 indices (`DS:275c`, un tour complet par tick) :

| Indice | Rôle |
|---|---|
| 0 | si le son `1000` est fini (`1088:1818`) et `7bba ≠ 0` → `1068:06d3(1)` : **entrée automatique dans le hub** à la fin de la musique |
| 1 | rien |
| 2–9 | `1068:0746` : avance l'animation de la table `DS:2734 + 4×indice` (`26b8`=2000, `26c4`=2500, `26d0`=1000, `26dc`=1500, `26f4`=3500, `2700`=4000, `270c`=4500, `2718`=5000) d'une étape ; si le script est fini, `1090:138c(rembobine, avance)` : **boucle infinie** de toutes les animations. L'indice 7 (`4000`) pilote aussi `3000` (`26e8`) : quand `4000` change d'image, `3000` est avancée jusqu'à changer d'image (les deux sont synchrones) |
| 1er passage (`7bc0 == 0`) | recale l'échéance de `2000` et `2500` à « maintenant », lance le son `1000` (`1088:1498`), `7bba = 1` (prêt) |

**Clic** (callback de groupe `1068:06d3(indice)` ; indice 1 = porte, 2 = plaque) :

| Indice | Effet |
|---|---|
| 1 (porte, ou fin de musique) | `7bba = 0`, curseur « occupé », **joue `SCR 10000` jusqu'au bout** (`1090:111c`, la porte s'ouvre, son 13032), `1b20 = 0` (hub), `10a8:0000(0)`, fondu vers noir (cible 0), `scene_title_leave` |
| 2 (plaque en bas à gauche) | `1b20 = 9` (**crédits**), `7bbe = 1` (le retour ne remontre pas le logo), `sndStop(\0SND 1000)`, fondu vers noir, `scene_title_leave` |

Après les crédits, `1078:0484` pose `1b20 = 8` : le titre est ré-entré **sans logo** (musique relancée, animations relancées, horloge relue).

Sortie du titre (`1068:0505`) : libère le son 1000, les 11 descripteurs d'animation, `SHPL 105`, la liste du logo.

### 1.2 Layout

- **Fond** : `SHPL 105` (SHAP 105, 576 × 432) : la maison orange sous une coupole, enseigne « MATH WORKSHOP », cadran à (287, 230), perron et porte, « © Copyright 1994 Brøderbund Inc. All rights reserved. » en bas à gauche. Le texte du copyright est cuit dans l'image.
- **Hotspots** (groupe `DS:2694`, bouton `DS:2684`, vtable `3580` nulle dans le fichier : **aucun graphique de survol**, hypothèse, enregistrements `DS:265c` et `DS:2670`) :

| Indice | Rectangle (gauche, haut, droite, bas) | Zone | Action |
|---|---|---|---|
| 1 | (258, 266, 320, 344) | porte de la maison | `06d3(1)` → hub |
| 2 | (117, 329, 150, 353) | plaque sur le mur, en bas à gauche | `06d3(2)` → crédits |

- **Animations** (descripteurs 12 octets `DS:26b8…2724`, drapeaux `0x03` = fond sauvegardé + non interruptible sauf `10000`) :

| `SCR` | Zone d'écrêtage | Images | Durée | Rôle (rendu des strips) | Boucle |
|---|---|---:|---|---|---|
| 500 (horloge, `DS:2730`, drapeaux `0x42`) | (270,214)–(305,248) | 144 | – | aiguilles du cadran, 12 h × 12 pas de 5 min | non (avance rapide, une fois à l'entrée) |
| 1000 | (131,377)–(218,432) | 6 | 77 t | fleurs (roses) en bas à gauche | oui |
| 1500 | (368,377)–(454,432) | 11 | 140 t | fleurs en bas à droite | oui |
| 2000 | (153,161)–(206,236) | 7 | 1022 t | fenêtre de gauche : trois crayons-personnages | oui |
| 2500 | (360,168)–(413,230) | 45 | 1022 t | fenêtre de droite : crayons-personnages | oui |
| 3000 | (208,20)–(369,44) | 14 | 525 t | haut de la coupole (synchrone avec 4000) | oui |
| 3500 | (6,11)–(148,207) | 75 | 525 t | éolienne et château d'eau à gauche, bulles de chiffres | oui |
| 4000 | (76,250)–(502,327) | 14 | 525 t | fenêtres de la façade (pilote de 3000) | oui |
| 4500 | (467,180)–(515,227) | 41 | 525 t | tuyau courbe à droite | oui |
| 5000 | (391,36)–(576,138) | 33 | 231 t | cheminées, engrenage et lampe en haut à droite, chiffres en bulles | oui |
| 10000 (`DS:2724`) | (254,250)–(357,359) | 5 | 42 t | **ouverture de la porte** | non, jouée au clic |

### 1.3 Sons

| Son | Durée | Quand | Usage |
|---|---|---|---|
| `TITLE \0SND 1000` | 17,44 s, WAVE 11025 Hz, déclare **1 boucle** (début 0, fin = dernier échantillon), 6 repères `Cue#` `a`–`f` | lancé au 1er tick, jamais arrêté par la scène sauf clic « crédits » | **musique du titre** ; sa fin déclenche l'entrée dans le hub. Que « 1 boucle » signifie « jouer deux fois » (≈ 35 s) ou « une fois » n'est pas établi |
| `TITLE \0SND 13032` | 0,96 s | `SCR 10000` | bruit de la porte |
| MIDI | – | `1088:16a5(-1, tMID)` à l'entrée : coupe tout MIDI en cours | aucune musique MIDI au titre |

### 1.4 Données

- Tags utilisés : `SHPL` 105, 200, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 10000 ; `SHAP` 105, 200, 500–512, 1000–1003, 1500–1505, 2000–2002, 2500–2511, 3000, 3500–3550, 4000, 4500–4504, 5000–5022, 10000–10005 ; `\0SCR` 500, 1000–5000 (par 500), 10000 ; `SNDL` de mêmes ids ; `\0SND` 1000 et 13032.
- Tables du segment de données : groupe `DS:2694` (+`2684` bouton, `265c`/`2670` enregistrements), descripteurs `DS:26b8…2724`, table de pointeurs `DS:2734` (indices 2–9), nom d'archive `DS:2760`, variables `275c/275e/7bb2/7bb6/7bba/7bbc/7bbe/7bc0`. Les thunks `1068:0000…009e` et `1068:00b2/015a/0203/02a7` sont le dessin des boutons à 3 états (utilisés par crédits, trophée, Rockets via `1038:01af`), pas par le titre.

### 1.5 Entrées

- Souris : seulement les deux hotspots ; aucun feedback visuel. Pas de touche propre à la scène (`Key` nul) : Tab / Entrée des gadgets (`10a0:098e`) activent le hotspot 1 puis 2 ; Ctrl+Q et Ctrl+V globaux. Un clic ou une touche n'interrompt que l'attente du logo.
- Il n'y a **ni bouton « jouer » dessiné ni raccourci pour passer le titre** : le joueur clique la porte ou attend la fin de la musique.

---

## 2. Hub / Control Room (scène 0, `MAINSCRN.DAT`)

Descripteur `DS:0c0e` : `Enter 1020:0000`, `Leave 1020:0584`, `Tick 1020:06f6`, pas d'`Exit`, `Key 1020:11b0`, sauvegarde : 1 variable (`DS:4fa4`, indicateur « Poly a déjà expliqué le jeu à ce joueur », octet 0 de l'enregistrement du joueur). Le hub est le seul écran du jeu v1 : **pas d'étages** (« Level 1 / Level 2 » et la Boiler Room sont du Deluxe).

### 2.1 Vue d'ensemble

La salle : verrière en vitrail (Pattern Windows), escalier en colimaçon, chevalet (Super Sticklers), cadre au papillon (Puzzle Patterns), trou dans le mur avec engrenage et note de musique (Rhythm Shop), étagère de fusées à droite (Rockets), rideau-gueule rouge aux quilles (Bowling for Numbers), téléviseur (Hidden Pictures). En bas à gauche : **Poly** (SHAP 104, 176 × 189 à (51, 241)) derrière son **pupitre** (SHAP 101, 244 × 91 à (28, 341)) qui porte **3 boutons** : Quit, Help, Sign-in (SHPL 200 : SHAP 200–205, 35 × 34, deux états chacun).

Quatre **groupes** de gadgets (`10a0:0000(0ee4, 4, 0xc000)`) :

| Groupe | Bouton / enregistrements | Rappel | Rôle |
|---|---|---|---|
| 0 (`DS:0ee4`) | `DS:0d88` → 14 enregistrements `DS:0c70` | `1020:098a` | objets du décor = activités, Poly, plein écran |
| 1 (`DS:0ef0`) | `DS:0e10` (vtable `1b4e`, `SHPL 200`) → 3 enregistrements `DS:0d98` | `1020:0e7b` | boutons du pupitre |
| 2 (`DS:0efc`) | `DS:2eba` → 17 enregistrements `DS:2d66` | `1080:1192` | moniteur de connexion / préférences / trivia (§3) |
| 3 (`DS:0f08`) | `DS:0ed4` → 9 enregistrements `DS:0e20` | `1020:172e` | « jouets » du décor (fenêtres, leviers, escalier) |

### 2.2 Enter / Leave

**Enter** `1020:0000` (instructions mal décodées dans Ghidra : le `55 8b ec` initial est lu `PUSH BP; IN AL,DX`, lire `disasm.txt` à partir de `1020:0002`) :

1. `DS:4f7c = 108000` (30 min : « inactif », les bavardages sont coupés tant que le joueur n'a pas agi) ; lit Ctrl (`1098:036f`) : **Ctrl seul → `874a = 1`** (mode sans animations), **Ctrl+Maj → `874a = 0`** ; `4f88 = (874a == 0)` autorise les animations de lancement ; remet à zéro les drapeaux d'ambiance ; `0xc82 |= 2` désactive l'enregistrement 1 du groupe 0.
2. `1008:0522` : si `DS:2d64` (« Ambient Sounds ») ≠ 0, **joue le MIDI `65000`** (« transition music » de `MILKYWAY.DAT`, 16,7 Ko).
3. Tire 4 sons d'attente distincts parmi `3065…3088` (`1018:04e1(3065, 3088)`, table `DS:4fce…4fd4`) et un clip d'accueil dans `DS:102e` = `{5000, 5100, 5200, 5300}` (→ `DS:0f5e`, descripteur `0f5a`).
4. Ouvre `mainscrn.dat` (`DS:10d8`), charge `SHPL 100` (5 formes : 100 fond, 101 pupitre, 102 écran de télé noir 52 × 110, 103 main « stop » 25 × 25, 104 Poly) et dessine le fond ; dessine le pupitre en (28, 341) mode 8 ; installe les 4 groupes ; crée les 3 boutons à 3 états (`1038:01af`, `SHPL 200`, 3 boutons) ; précharge les sons `3012 (0xbc4)`, `3013`, `3020`, `3057` et les 4 sons d'attente.
5. Charge `SHPL 1600` (4 formes 60 × 45 = **papillon du cadre**, dessiné à (169, 232), ping-pong `1,2,3,4,3,2` en `DS:0c38`, 6 ticks par image). Si `874a == 0` (animations autorisées) : installe et exécute la 1re étape des boucles d'ambiance `1400`, `1700`, `2000`, `1800`, `1500` et d'un des 5 tableaux du chevalet (`1825/1850/1875/1900/1925`, tirage dans `DS:0c28`) ; dessine la forme 102 (écran de télé noir) en (460, 205) si l'interrupteur de la télé est coupé (`4fb0`).
6. Sauvegarde le rectangle (0, 225)–(272, 432) (`10a8:1023`, handle `DS:0c50`) pour restaurer le fond sous Poly ; dessine Poly (forme 5 de la `SHPL 100`) en (51, 241).
7. **Retour d'une activité** : si `DS:0f1c` (dernière scène) vaut 1 (Bowling) → joue `SCR 1100` (le rideau se referme) ; vaut 2 (Rhythm) → joue `SCR 1300` (descripteur `0f72`, id posé en `0f76`) pendant le fondu d'entrée ; `0f1c = 0`.
8. Fondu d'entrée, puis :
   - **1re entrée du programme** (`DS:0c48 == 0`, « connexion jamais faite ») : si `0c4e == 0`, joue le clip d'accueil `0f5a` (5000–5300, pas exact `8732 = 1`), puis prépare le clip de salutation (`12f8`) et **ouvre le moniteur de connexion** (`1020:10e2(1, 1)`).
   - entrées suivantes (`0c48 == 1`) : arme les minuteries d'ambiance (`1346(0)`, `4fa2 = 1`, `4f7c = 0`).
9. Fin : `4fba = 0`, `4fb2 = 0xf14` ou 0 selon `0c4e`, `4f72 = 1` (ambiance autorisée), `1380(0)` (prochain bavardage dans 180–360 ticks).

**Leave** `1020:0584` : libère le moniteur (`1080:105b`), les `SHPL`, la sauvegarde de fond, toutes les animations (y compris `0f5a`, `0f66`), les 4 sons préchargés, les clips d'ambiance (`1fb4(1)`), les boutons, restaure l'archive précédente. N'écrit rien dans le roster.

### 2.3 Variables d'état importantes

| Adresse | Sens |
|---|---|
| `1e90` (u32) | **joueur courant**, 1 à 40, 0 = personne |
| `1e8e` | nombre de joueurs enregistrés (≤ 40) |
| `2d60` | état du moniteur : 0 absent, 1 ouvert, 2 « fermé, à finaliser au prochain tick » (→ `1020:1e35`) |
| `2d64` | **Ambient Sounds** (musique MIDI + bavardages de Poly) ; sauvé dans l'en-tête du roster |
| `02b8` | **Click & Stick Mouse** (lu par Hidden / Patterns / Sticklers / `1050:0527`) ; sauvé dans l'en-tête |
| `0332` | durée du minuteur du Bowling, **en ticks** (défaut 10800 = 180 s) ; sauvé dans l'en-tête |
| `4f50` | **mode aide** (Poly « sortie » pour expliquer) |
| `4f52`, `4f54` | « le joueur a bougé » / tick du début de l'aide (relance de l'intro après 300 ticks d'inactivité) |
| `4f58` | Poly parle (animation `0fd2` en cours, avancée par le tick) |
| `4f5a…4f64`, `4f66…4f70` | clips d'attente installés / en cours (`6000`, `6100`, `2700`, `2800`, `2900`) |
| `4f72`, `4fa2` | ambiance autorisée / minuterie d'ambiance armée (`4f9e` = échéance) |
| `4f78`, `4f74/4f76` | échéance du prochain bavardage / dernier son d'attente |
| `4f7c`, `4f80` | ticks depuis la dernière action (≥ 108000 : plus de bavardage) / tick de la dernière action |
| `4f84` | échéance de l'invite « choisis ton nom » (`8200`) dans le moniteur |
| `4fa4` | **Poly a déjà expliqué** (sauvé, par joueur) |
| `4fa6` | numéro de trivia (1–19) |
| `4fa8` / `4fac` | échéance du rappel de la confirmation « quitter » / son id (`8300` ou `8400`) |
| `4fae`, `4fb0`, `4fb2`, `4fb4`, `4fb6`, `4fb8`, `4fba` | interrupteurs des boucles d'ambiance (rideau, télé, papillon, chevalet, verrière, étagère, engrenage) |
| `0c48` / `0c4e` | connexion déjà faite / accueil déjà joué ; `0c4a` : joueur à l'ouverture du moniteur |
| `0c5c` | invite « quitter » affichée |
| `874a` | mode sans animations (Ctrl à l'entrée) |

### 2.4 Layout et hotspots

#### 2.4.1 Groupe 0, enregistrements `DS:0c70` (clics du décor, rappel `1020:098a(indice)`)

| Indice | Rectangle | Objet | Action (mode normal) |
|---|---|---|---|
| 1 | (152, 317, 228, 403) | sifflet de fin de journée, sous le pupitre | **actif seulement pendant l'invite « quitter »** (désactivé sinon) : quitte le jeu |
| 2 | (94, 0, 488, 25) | verrière, tranche 1 | scène 3 **Pattern Windows** |
| 3 | (106, 25, 475, 50) | verrière, tranche 2 | idem |
| 4 | (129, 50, 452, 75) | verrière, tranche 3 | idem |
| 5 | (174, 75, 404, 96) | verrière, tranche 4 | idem |
| 6 | (78, 62, 141, 187) | chevalet | scène 6 **Super Sticklers** |
| 7 | (233, 111, 369, 204) | mur de briques / engrenage ♪ | scène 2 **Rhythm Shop** |
| 8 | (371, 80, 490, 192) | étagère à droite | scène 7 **Rockets** |
| 9 | (156, 214, 235, 293) | cadre au papillon | scène 5 **Puzzle Patterns** |
| 10 | (270, 209, 406, 341) | rideau-gueule aux quilles | scène 1 **Bowling for Numbers** |
| 11 | (459, 225, 560, 383) | télévision | scène 4 **Hidden Picture Puzzles** |
| 12 | (73, 245, 131, 321) | **Poly, tête** | **Math Trivia** (moniteur en mode 4, §4.2) |
| 13 | (56, 321, 149, 398) | **Poly, corps** | idem |
| 14 | (0, 0, 576, 432) | tout l'écran | **désactivé** sauf pendant l'invite « quitter » (annule) ; sinon sans effet |

Table de saut `CS:0d86` (indices 2–13) → `DI` = numéro de scène : `3,3,3,3,6,2,7,5,1,4,→10e2(4),→10e2(4)` (`1020:0c27`–`0c4a`).

**Lancement d'une activité** (`1020:098a`, indices 2–11) : coupe la voix de Poly en cours (`1990(1)`), ferme l'invite « quitter » éventuelle (`0dbc(0)`). Si **aucun joueur** (`1e90 == 0`) : joue `SCR 5000` interruptible (`0ffb(5000, 0, 1)`) puis **ouvre le moniteur en mode connexion** (`10e2(1, 1)`) et ne lance rien. Sinon : curseur « occupé », `4fa2 = 0`, `4f72 = 0`, coupe les ambiances (`1fb4(0)`), puis (si `4f88`) joue l'**animation de départ** (descripteur `0f7e`, id posé en `0f82`, lecture `1090:0ff9`, sons de la `SNDL` correspondante) :

| Indice | Scène | Animation de départ (`SCR`) | Zone (écrêtage) |
|---|---|---|---|
| 2–5 (verrière) | 3 | 9200 | (107,0)–(481,92) |
| 6 (chevalet) | 6 | 9300 | (82,77)–(149,156) |
| 7 (engrenage) | 2 | 1200 | (249,136)–(327,206) |
| 8 (étagère) | 7 | 9100 | (425,0)–(475,140) |
| 9 (cadre) | 5 | 9000 | (177,232)–(218,277) |
| 10 (rideau) | 1 | 1000 | (287,244)–(387,331) |
| 11 (télé) | 4 | 8900 | (461,212)–(511,315) |

puis fondu vers noir (`1088:1b25`, cible 0), `10a8:0000(0)`, `scene_hub_leave`, `DS:0f1c = scène`, `1b20 = scène` (changement de scène au tour de boucle suivant). Au retour, `SCR 1100` (rideau) et `SCR 1300` (engrenage) sont les animations inverses (§2.2 point 7) ; les 5 autres scènes n'en ont pas.

#### 2.4.2 Groupe 1, enregistrements `DS:0d98` (pupitre, rappel `1020:0e7b(indice)`)

| Indice | Rectangle | Bouton (SHAP) | Son d'appui | Action |
|---|---|---|---|---|
| 1 | (155, 345, 191, 380) | **Quit** (rouge 200 / vert 201) | 3057 (0,19 s) | invite « quitter » (§7) |
| 2 | (192, 345, 228, 380) | **Help** (sourire 202 / rire 203) | 3012 ou 3013 (tiré à 50 %) | mode aide (§2.6) |
| 3 | (229, 345, 265, 380) | **Sign-in** (crayon 204 / 205) | 3020 (0,19 s) | `1098:036f(0) == 0x400` (**Ctrl seul**) → moniteur **mode 3 (préférences / roster)**, sinon **mode 1 (connexion)** |

#### 2.4.3 Groupe 3, enregistrements `DS:0e20` (« jouets », rappel `1020:172e(indice)`)

| Indice | Rectangle | Objet | Animation | Son |
|---|---|---|---|---|
| 1 | (16, 23, 44, 117) | fenêtre de gauche | 9800 (8,19)–(51,122) | – |
| 2 | (258, 80, 573, 112) | bande à droite (cordon / étagère) | 9900 (522,12)–(576,123) | – |
| 3 | (189, 383, 219, 401) | levier 1 du pupitre | 9700 (descripteur `0fa2`) | 13096 (0,38 s) |
| 4 | (156, 396, 186, 415) | levier 2 | 9600 (`0fae`) | 13097 (0,62 s) |
| 5 | (1, 203, 54, 391) | rampe de l'escalier | 10400 (0,193)–(155,396) : marches colorées | 13098 (1,84 s) |
| 6 | (64, 194, 151, 226) | rampe de l'escalier (haut) | 10400 | idem |
| 7 | (65, 397, 90, 424) | levier 3 | 9400 (`0fba`) | 13095 (0,38 s) |
| 8 | (98, 398, 126, 415) | levier 4 | 9500 (`0fc6`) | 13102 (1,54 s) |
| 9 | (521, 42, 573, 80) | fenêtre de droite | 10000 (521,12)–(576,124) | – |

Après le jeu des animations (`1020:18fc`), les **leviers 1–4 basculent des interrupteurs d'ambiance** (sauf en mode sans animations) : levier 1 → `4fb6` (boucle de la verrière `1800`), levier 2 → `4fb2` (papillon), levier 3 → `4fb4` (tableau du chevalet), levier 4 → `4fb0` (clignotement de la télé `2000` et écran noir 102). Les fenêtres jouent leur animation sans état.

#### 2.4.4 Table de survol / aide `DS:1050` (15 `RECT`, `1020:11e5`)

| Zone | Rectangle | Objet |
|---|---|---|
| 1 | (73, 245, 131, 321) | Poly, tête |
| 2 | (56, 321, 149, 398) | Poly, corps |
| 3 | (160, 345, 195, 379) | bouton Quit |
| 4 | (194, 345, 229, 379) | bouton Help |
| 5 | (229, 345, 264, 379) | bouton Sign-in |
| 6–9 | (94,0,488,25), (106,25,475,50), (129,50,452,75), (174,75,404,96) | verrière (4 tranches) |
| 10 | (78, 62, 141, 187) | chevalet |
| 11 | (233, 111, 369, 204) | engrenage |
| 12 | (371, 80, 490, 192) | étagère |
| 13 | (156, 214, 235, 293) | cadre |
| 14 | (270, 209, 406, 341) | rideau |
| 15 | (459, 225, 560, 383) | télé |

Autres `RECT` : `DS:10c8` (98, 363, 124, 389) = icône « main stop » de l'aide (SHAP 103) ; `DS:10d0` (155, 345, 228, 380) = zone des boutons Quit et Help (un clic dedans coupe d'abord Poly : `1020:20b8`) ; `DS:0c54` = (460, 205, 513, 316) écran de la télé ; `DS:0ff6` = (169, 232, 230, 278) papillon.

### 2.5 Mode normal : machine à états du hub

États (combinaison de `2d60`, `4f50`, `4f58`, `0c5c`) :

| État | Entrée | Comportement |
|---|---|---|
| **Normal** | fin d'Enter | ambiances + bavardages (§2.7), clics §2.4 |
| **Moniteur ouvert** (`2d60 = 1`) | `1020:10e2(1, mode)` : `4fa2 = 0`, `4fae = 1`, `4fb0 = 1`, groupes 0, 1, 3 désactivés (bit 0), curseur normal, `4f7c = 108000`, mode 4 : joue d'abord `5900` | clavier redirigé vers `1080:0581` ; le tick appelle `1080:0581(0, 0xffff)` (clignotement du curseur) ; mode 1 : arme `4f84 = +300` (invite `8200` si le joueur reste inactif) |
| **Moniteur fermé** (`2d60 = 2`) | `1080:08fe` | le tick appelle `1020:1e35` une fois : voir ci-dessous |
| **Aide** (`4f50 = 1`) | bouton Help (`1220(1)`) | enregistrements 2–14 du groupe 0 désactivés puis l'enregistrement 14 (plein écran) réactivé, **groupe 1 (pupitre) désactivé** (`1220` : bit 1 des enregistrements, bit 0 du groupe `0ef0`) : tout clic arrive donc par l'indice 14 et est interprété par la table de survol §2.4.4 (`098a` branche `4f50 ≠ 0`) |
| **Invite « quitter »** (`0c5c = 1`) | bouton Quit | enregistrements 1 et 14 actifs |
| **Poly parle** (`4f58 = 1`) | `1020:1f66` | animation `0fd2` avancée par le tick (`1ac7`), non bloquante ; tout clic dans le hub (`1020:20b8` dans la zone `10d0`, ou début de `098a` / `0e7b` / `172e`) appelle `1020:1990(1)` = coupe la voix |

**`1020:1e35`** (finalisation du moniteur) : `10e2(0)` ; `2d60 = 0` ; si `2d64` a changé : coupe le MIDI ou relance `1008:0522` ; joueur courant valide et différent de celui d'avant (`0c4a`) → `12f8()` prépare un nouveau clip de salutation (`5400…5700`, table `DS:103a`, id tiré, desc `0f66`) ; si `4fa4 == 0` (nouveau joueur) : `4fa4 = 1`, `1050:0302` (sauve), **joue `5800` (introduction longue de 18 s)** ; si `0c4e == 0` : `0c4e = 1`, joue le clip de salutation `0f66` (1,9 à 3,3 s) en pas exact ; `1346(0)`, `4fa2 = 1`.

### 2.6 Poly : aide et clips

**Aide** (bouton Help, `1020:0e7b(2)`) : son d'appui 3012/3013 ; `4f72 = 0`, `4f54 = 0` ; `1220(1)` (entre en mode aide) ; si `4fa4 == 0` : `4fa4 = 1`, sauve, joue `5800` ; sinon joue `4800`, et `4900` **si `4800` a été interrompu** (voir « chaîne » ci-dessous) ; puis dessine la main « stop » (`170e` : SHAP 103 en (98, 363)). Si le joueur ne fait rien pendant 300 ticks (`4f54 + 300 < maintenant`, `4f52 = 0`) : rejoue `5800` (l'introduction).

**En mode aide**, un clic sur la table §2.4.4 joue le clip de l'objet (`1020:0ffb(id, 0, 1)`, **bloquant et interruptible** par un clic, `8732 = 1`) :

| Zone | Clips (chaîne) | Sens |
|---|---|---|
| 1, 2 (Poly) | `5300` si aucun joueur, `5400` sinon, puis **sort du mode aide** (`1220(0)`) | « Poly, tu peux partir » |
| 3 (Quit) | `8800` | explication du bouton |
| 4 (Help) | `4800`, puis `4900` | explication du bouton |
| 5 (Sign-in) | `8100` | explication du bouton |
| 6–9 (verrière) | `3600`, `3700` | Pattern Windows |
| 10 (chevalet) | `4400`, `4500`, `4600`, `4700` | Super Sticklers |
| 11 (engrenage) | `4100`, `4200`, `4300` | Rhythm Shop |
| 12 (étagère) | `3800`, `3900` | Rockets |
| 13 (cadre) | `3400`, `3500` | Puzzle Patterns |
| 14 (rideau) | `3000`, `3100` | Bowling |
| 15 (télé) | `3200`, `3300` | Hidden Pictures |

**Chaîne** : `0ffb` renvoie 1 si le clip a été joué jusqu'au bout, 0 s'il a été interrompu par un clic ; les appels successifs de la table ne rejouent le clip suivant que **si le précédent a été interrompu** (`CMP …; JNZ` après chaque appel dans `098a`). Autrement dit un clic pendant l'explication passe à la variante suivante (hypothèse sur l'intention : « version courte puis détails »). `4000` n'est référencé par aucun code du hub (clip inutilisé ou variante de Rhythm : hypothèse).

Le contenu parlé n'est pas inférable sans écoute : les voix sont `18000…18073`, `18100…18154`, `18200…18288`, `19655…19658` de `MAINSCRN.DAT` (≈ 1 à 5 s chacune), toutes « voix de Poly » ; `SNDL` d'un clip = même id.

**Catalogue complet des 93 `SCR` du hub** (durées en ticks ; images ; sons) :

| `SCR` | Rôle | Durée | Son |
|---|---|---|---|
| 1000 / 1100 | rideau s'ouvre (départ Bowling) / se referme (retour) | 98 / 70 | – |
| 1200 / 1300 | engrenage-trou s'ouvre (départ Rhythm) / se referme | 35 / 42 | – |
| 1400 | boucle : rideau-gueule (haut), 6 images | 84 | – |
| 1500 | boucle : coin supérieur droit (étagère), 52 images | 378 | – |
| 1700 | boucle : engrenage, 102 images | 2142 | – |
| 1800 | boucle : verrière, 10 images | 203 | – |
| 1825 / 1850 / 1875 / 1900 / 1925 | 5 variantes de la toile du chevalet (une tirée à chaque entrée) | 119 / 385 / 126 / 98 / 182 | – |
| 2000 | boucle : télé qui clignote | 56 | – |
| 2600 | « la liste est pleine » (Poly) | 315 | 19656, 19657, 19658 |
| 2700, 2800, 2900, 6000, 6100 | **clips d'attente** de Poly (5, tirés sans répétition via `DS:104a`) | 196, 217, 21, 119, 126 | 13101, 13101, –, 13102, 13096 |
| 3000–4700 (sauf 4000) | explications par objet | 147–448 | `18028…18055` |
| 4800, 4900 | explication du bouton Help | 231, 189 | 18000–18003 |
| 5000, 5100, 5200, 5300 | **accueil** (tirage à chaque entrée) ; 5000 sert aussi de « connecte-toi d'abord » | 266, 273, 280, 266 | 18004–18011 |
| 5400, 5500, 5600, 5700 | **salutation** après connexion | 112, 196, 154, 147 | 18012–18015 |
| 5800 | **introduction longue** (8 phrases) | 1092 | 18020–18027 |
| 5900 | « hmm » avant une trivia | 119 | 13097 |
| 6200 … 8000 (pas de 100) | **19 histoires** de Math Trivia (11 à 32 s) | 602–1932 | `18100…18154`, `18200…18288` |
| 8100 | explication du bouton Sign-in | 168 | 19655 |
| 8200 | invite après 5 s d'inactivité dans le moniteur | 294 | 18069, 18070 |
| 8300, 8400 | rappel « quitter » après 4 s (50 % chacun) | 147, 413 | 18067 ; 18064–18066 |
| 8500, 8600, 8700 | « ce nom existe déjà » (chaîne, `1020:16d4`) | 196, 196, 336 | 18068, 18071, 18072–18073 |
| 8800 | explication du bouton Quit | 168 | 18063 |
| 8900, 9000, 9100, 9200, 9300 | départ vers une activité (télé, cadre, étagère, verrière, chevalet) | 91, 91, 112, 84, 126 | – |
| 9400, 9500, 9600, 9700 | leviers du pupitre | 56, 112, 56, 35 | 13095, 13102, 13097, 13096 |
| 9800, 9900, 10000 | fenêtres (gauche, droite, droite) | 203, 210, 189 | – |
| 10100 | sifflet : sortie confirmée (joué avant la fermeture) | 203 | 13054 (2,28 s) |
| 10200 | sifflet : rembobinage, joué à l'annulation **et** juste avant la sortie | 63 | 13099 |
| 10300 | sifflet : apparition (bouton Quit) | 98 | 13055, 13056 |
| 10400 | escalier (marches colorées) | 133 | 13098 |

(Sons 13094 et 13100 non référencés par un script ; 13100 absent de l'archive.)

### 2.7 Tick (`1020:06f6`) : ambiance et bavardages

Un tour par tick. Dans l'ordre : mise à jour de `4f7c` ; si le moniteur est fermé : `2d60 == 2` → `1e35`, sinon `1080:0581(0, 0xffff)` ; `4fc0 == 1` → `1020:1ac7` (voir ci-dessous) ; en mode normal :

1. **Clip d'attente** : si aucun clip d'attente ne joue (`4f5e`, `4f66…4f6e` à 0), `4fa2 = 1` et `4f9e ≤ maintenant` (échéance tirée entre **240 et 480 ticks** par `1346(0)`) : tire un indice 1–5 sans répétition (`10a8:13af(masque 104a, 5)`), prépare le clip (`1020:13ba` : 1 = `6000`, 2 = `6100`, 3 = `2700`, 4 = `2800`, 5 = `2900`, chacun avec son descripteur `0f1e…0f4e`), le met en jeu ; à sa fin, `18fc`/`1346`.
2. **Phrase d'attente** : si `2d64 ≠ 0` (Ambient Sounds), `4f72 ≠ 0`, `4f78` échu et le son précédent fini : tire un des 4 sons de `DS:4fce…` (pool `104a/1046`, n = 4), le joue si `4f7c < 108000` (< 30 min d'inactivité), puis `1380(0)` (prochain dans **180–360 ticks**).
3. **Mode aide** : curseur « ? » (`1008:063b(2)`) si le survol (`11e5`) donne une zone ≥ 3, curseur normal sinon ; relance de l'introduction après 300 ticks d'inactivité.
4. `2d60 ≠ 0` (moniteur) : `4f84` échu → `1020:1f66(8200)`.
5. `4fa8` échu et `0c5c ≠ 0` → `1020:1f66(4fac)` (rappel « quitter »).

**`1020:1ac7`** (ambiance, `8732 = 0` pendant l'exécution, `4fc0 = 2`) : sauf mode sans animations, avance chacune des boucles `1400` (si `4fae = 0`), `1500` (si `4fb8 = 0` et `34c9 = 0`), `1700` (`4fba = 0`), `1800` (`4fb6 = 0` et `34c9 = 0`), `1825…` (`4fb4 = 0`), `2000` (`4fb0 = 0`) d'une étape et les rembobine quand elles finissent ; le **papillon** avance d'une image toutes les 6 ticks (`DS:0c36`, `0c44`) ; la voix en cours (`0fd2`) est avancée en pas exact ; enfin les 5 clips d'attente (`4f66…4f6e`) : états 1 (démarre, sauvegarde `0c50` comme fond) → 2 (joue) → fini (`4f70 = k`, `18fc`). `34c9` : drapeau dont l'usage n'est pas établi (hypothèse : son en cours).

### 2.8 Sons et musique du hub

- **MIDI** : `65000` (`MILKYWAY.DAT`, 16 682 octets) joué à l'entrée du hub (et des crédits, du trophée) **si Ambient Sounds est actif** ; coupé / relancé quand le joueur change la préférence (`1e35`). `65001` n'est référencé par aucun code des écrans communs.
- **Voix** : toutes les `\0SND` 18xxx, 19655–19658 (clips de §2.6) ; **phrases d'attente** 3065–3088 (24 sons de 1,0 à 3,4 s ; 4 tirés à chaque entrée) ; **UI** : 3012/3013 (Help), 3020 (Sign-in), 3057 (Quit), 3044–3052 (moniteur, §3.1).
- Pas de synchro labiale par repères (`Cue#` jamais lus) : le son part avec une image du script (`SND_PLAY`).

### 2.9 Clavier et souris du hub

- `Key` (`1020:11b0`) : si `2d60 == 1` → `1080:0581(touche, 0)` (saisie) ; sinon `1018:03fd(touche)` (historique des séquences secrètes, §4.1). Gadgets : Tab / Maj+Tab / Entrée.
- Ctrl+Q : quitte directement (`1008:02da`). Ctrl+V : « About ».
- Souris : les 3 boutons font la même chose ; `1008:05c0` propose le clic à `1020:20b8` (zone des boutons Quit / Help : coupe la voix) avant les gadgets. **Pas de mode « cliquer-glisser »** dans le hub.
- **Ctrl à l'entrée du hub** : mode sans animations (`874a`) persistant jusqu'à un Ctrl+Maj à une entrée suivante (hypothèse sur l'intention : machines lentes).

---

## 3. Connexion / préférences / roster (segment `1080`, dessiné dans le hub)

Ce ne sont **pas des boîtes de dialogue Windows** : le moniteur est un **écran dessiné par le code** (images `SHPL 50000` de `MAINSCRN.DAT` + texte `NCSclB10` dessiné par `10d8:60ae`) qui **monte du bas de l'écran** sur le hub. Les seules vraies boîtes Windows de tout le jeu sont la boîte d'impression `PRINTDLG` et les `MessageBox` fatales. Appelé par `1020:10e2` avec trois arguments (fondu `10, 184`, durée `46`, mode) ; aussi par `1010:0bc5(1)` (connexion depuis le Bowling, même code) et `1060:03d5` (Pattern Windows).

### 3.1 Habillage

`SHPL 50000` (21 formes, palette du hub) :

| SHAP | Taille | Contenu |
|---|---|---|
| 50000 | 247 × 222 | cadre du moniteur (rect `DS:2eca` = (244, 240, 492, 432)) |
| 50001 | 187 × 117 | écran sombre (rect `DS:2d56` = (291, 282, 478, 399)) |
| 50002 / 50003 | 38 × 37 | **OK** (rouge / orange pressé) |
| 50004 / 5 | 20 × 35 | flèche haut (normal / pressé) |
| 50006 / 7 | 20 × 35 | flèche bas |
| 50008 / 9 | 73 × 21 | « New Player » |
| 50010 / 11 | 77 × 21 | « Roster » |
| 50012 / 13 | 70 × 21 | « Preferences » |
| 50014 / 15 | 40 × 21 | « Delete » |
| 50016 / 17 | 28 × 21 | « Add » |
| 50018 | 148 × 65 | panneau préférences : « ON OFF / Ambient Sounds / Click & Stick Mouse / Bowling Timer = [ ] sec. » |
| 50019 / 50020 | 29 × 15 | témoin rond ON / OFF |

**Animation** (`1080:0de4(ouvre)`) : le cadre (SHAP 50000) glisse par pas de 15 px entre `y = 432` et `y = 240` ; ouverture : son 3051 (`0xbeb`, 1,17 s) au début, 3052 (`0xbec`) à la fin ; fermeture : 3050 (`0xbea`, 1,09 s) puis 3049 (`0xbe9`). Les autres sons UI : 3044 (`0xbe4`, clic, 0,10 s), 3045 / 3046 (`0xbe5` / `0xbe6`, OK, 5 % / 95 %), 3047 (`0xbe7`, flèches, 0,04 s), 3048 (`0xbe8`, bascules, 0,10 s). Curseur normal pendant l'ouverture.

### 3.2 Vues (`1080:1f20(mode)` active les enregistrements du groupe 2)

| Mode | Vue | Enregistrements actifs (indices du groupe 2) |
|---|---|---|
| 1 | **Connexion** : liste de 3 noms, flèches, New Player, OK | 1 (OK), 2, 3 (flèches), 4 (New Player), 9, 10, 11 (3 lignes de noms) |
| 2 | **Roster (édition)** : même liste + Delete + Add + Preferences | 1, 2, 3, 6, 9, 10, 11, 12, 13 |
| 3 | **Préférences** : bascules et timer + bouton Roster | 1, 5, 7, 8, 14 |
| 4 | **Math Trivia / séquences secrètes** | 1 (OK), 15, 16, 17 |

Boutons (enregistrements `DS:2d66…2ea6`, 17, rappel `1080:1192`, table `CS:1801`) :

| Indice | Rectangle | Rôle |
|---|---|---|
| 1 | (259, 266, 297, 303) | **OK** (ferme et valide ; en saisie de nom, valide d'abord le nom) |
| 2 / 3 | (309, 294, 331, 329) / (309, 330, 331, 365) | **flèche haut / bas** (fait défiler d'une ligne) |
| 4 | (354, 366, 427, 387) | **New Player** |
| 5 | (346, 368, 424, 390) | **Roster** (vue Préférences → vue édition) |
| 6 | (309, 365, 379, 387) | **Preferences** (vue édition → vue Préférences) |
| 7 | (315, 312, 345, 328) | bascule **Ambient Sounds** (`DS:2d64`) |
| 8 | (315, 329, 345, 345) | bascule **Click & Stick Mouse** (`DS:02b8`) |
| 9–11 | `(334…460, 296 + 22·k, … + 22)` posés dynamiquement (`1080:0dae`) | **lignes de noms** 1 à 3 |
| 12 | (385, 365, 425, 387) | **Delete** (supprime le joueur sélectionné) |
| 13 | (435, 365, 463, 387) | **Add** (comme New Player) |
| 14 | (403, 346, 431, 359) | champ du **timer** (secondes) |
| 15 | (291, 282, 478, 399) | écran du moniteur (Trivia) |
| 16, 17 | (73, 245, 131, 321), (56, 321, 149, 398) | tête / corps de Poly (Trivia) |

Quand le groupe est actif, un enregistrement n'accepte le clic que s'il n'est pas marqué désactivé (bit 1 du mot `+0x12`) ; `1080:1192` ignore tout si `2d60 == 0`.

### 3.3 Ouverture (`1080:0000(mode)`) et fermeture (`1080:08fe`)

Ouverture : `82d6 = "%d"` du timer (`0332 / 60`) ; copie le joueur courant (`82c4`, `82c8`) ; alloue un tampon de 5424 octets (`0x5bac`), **lit l'enregistrement 0 du roster** (`1050:03fa`, convertit l'en-tête `1ebc`), construit l'**ordre alphabétique** `DS:82e2` (40 mots, `1080:1ab8`), précharge les 9 sons UI ; `2d60 = 1`.
- Mode 1 : s'il n'y a qu'un joueur, il est présélectionné ; **si le roster est vide, passe directement en saisie d'un nouveau nom** (`8353 = 1`).
- Mode 3 : vue Préférences, `8357 = 1` (le double-clic ne ferme pas).
- Mode 4 : voir §4.

Fermeture (OK / Entrée / double-clic sur un nom) : valide un éventuel nom en cours (`1c31`) ; lit le champ timer (`atoi`, **accepté si 1 à 999**, `0332 = valeur × 60`) ; **réécrit l'enregistrement 0 en entier** (en-tête + liste, `1050:00fa` puis `1050:03fa`) ; glisse le moniteur vers le bas ; si un joueur est sélectionné (`1e90`), **charge ses variables de scènes** (`1050:0331(1e90, 1)`), recopie son nom et son masque dans `DS:5b88` / `DS:5ba8` (utilisés par le Bowling) ; sinon `1e90 = 0` et `1050:0635` remet les variables à leur valeur par défaut ; `2d60 = 2`, libère les sons.

### 3.4 Saisie du nom (`1080:0581(touche, …)`, mode `8353`)

| Règle | Valeur (adresse) |
|---|---|
| Caractères acceptés | lettres `A–Z a–z`, chiffres `0–9`, espace, point (`1080:05a1`–`05e8`) |
| Premier caractère | lettre ou chiffre seulement (ni espace ni point) |
| Longueur max | **28 caractères** (`SI < 0x1c`) **et** largeur du texte `< 110 px` en police `NCSclB10` (`10d8:6bf0`) : un caractère qui ferait atteindre 110 px est retiré aussitôt ; tampon de 32 octets (`DS:8332`) |
| Retour arrière | `8` supprime le dernier caractère |
| Entrée | `0xd` → bouton OK (`1080:1192(1)`) |
| Chiffres 1 à 3 hors saisie | sélectionnent les lignes 1 à 3 de la liste |
| Flèches haut / bas (`0xa5` / `0xa7`) | défilement |
| Curseur | `|` clignotant, bascule toutes les 15 ticks (`82cc`, `82d0`) |
| Mise en forme à la validation (`1c31`) | 1re lettre en majuscule ; lettre qui suit un espace en majuscule ; **pas de rognage** des espaces |
| Nom vide | ignoré |
| Nom en double | **comparaison `strcmp` exacte** (sensible à la casse, sur le nom mis en forme) ; en cas de doublon : le joueur n'est pas créé, `1e90` revient au joueur précédent ; **dans le hub** : `82ba = 1` puis `1020:16d4` joue `8500`, `8600`, `8700` (chaîne) ; **ailleurs** : son `18677` (`0x48f5`, 2,15 s) |
| Liste pleine (40) | New Player / Add : **dans le hub** `1020:1702` joue `SCR 2600` (voix 19656–19658) ; ailleurs `1080:22e4` joue ces 3 sons à la suite |

**Création** (`1c31`) : cherche le premier emplacement libre (octet « utilisé » = 0) parmi 40, le marque, copie le nom (32 octets), met le masque à 0, `1e8e++`, `1e90 = numéro`, appelle les rappels `+6` de remise à zéro des variables de scènes (`1050:0635`), insère dans l'ordre alphabétique (`1ab8`), sauve les variables (`1050:0302`).

**Suppression** (vue édition, `1080:152f`) : exige un joueur sélectionné (`1e90` dans 1–40) et `1e8e ≥ 1` ; met l'octet « utilisé » à 0, retire l'indice de `82e2`, `1e8e--` (ajuste le défilement), `1e90 = 0` (et le joueur courant s'il s'agit de lui). **Les données de scènes du joueur (5424 octets) ne sont pas effacées** : l'emplacement est simplement réutilisable.

**Sélection dans la liste** (lignes 9–11) : un clic fixe `1e90`, joue 3044, mémorise la ligne (`8359`) ; **un 2e clic sur la même ligne dans les 15 ticks** (`835d = maintenant + 15`) équivaut à OK (sauf si `8357`).

**Préférences** : Ambient Sounds (id 7) et Click & Stick (id 8) basculent leur drapeau, redessinent le témoin (50019 ON / 50020 OFF), son 3048 ; champ timer : chiffres seulement, **3 chiffres max** (`82d6`, « 0 » initial remplacé par le 1er chiffre), retour arrière, `|` clignotant. Les valeurs ne sont écrites sur disque qu'à la fermeture (OK) du moniteur.

### 3.5 Fichier `MWRoster` (222 384 octets, 41 enregistrements de 5 424 octets ; `1050:03fa`, `1050:0079`)

Ouvert en lecture-écriture par chemin = `DS:4a2c` + `"MWRoster"` (`DS:00f8`) ; **créé automatiquement s'il manque** (`1050:0079` : essai d'ouverture, sinon création `10b8:0192`) : l'enregistrement 0 reçoit `{version 0x0020, 0 joueurs, timer 10800, click & stick 1, ambient 1}` et les 40 autres sont écrits à zéro. Erreurs fatales (`1050:0293`) : `Could not Open/Create Roster file.`, `Problem writing user file`, `Seek Error`, `Problem reading user file`, `Load failed - index out of range`, `Saved failed - index out of range`, `Out of Memory - tempUserDataHnd`, `Invalid Data Pointer`, `too many variable lists` (> 20 définitions) ; au démarrage, `Old Roster File must be deleted!` si la version lue (`DS:1e8c`) ≠ 0x20.

**Enregistrement 0** (en-tête, définition `DS:1ebc`, **gros-boutiste**) :

| Offset | Taille | Variable | Contenu |
|---|---|---|---|
| 0 | u16 | `1e8c` | version = `0x0020` |
| 2 | u16 | `1e8e` | **nombre de joueurs** |
| 4 | u32 | `0332` | timer du Bowling en **ticks** (10 800 = 180 s) |
| 8 | u16 | `02b8` | **Click & Stick Mouse** (1 = oui) |
| 10 | u16 | `2d64` | **Ambient Sounds** (1 = oui) |
| 12 + 37·(i − 1) | 37 octets × 40 | – | emplacement `i` (1 à 40) : `u8 utilisé` (+0), `char nom[32]` (+1, NUL), `u32 masque de réussites` (+33, **little-endian natif**, écrit par `1010:3fdf` et `1078`) |

Le reste de l'enregistrement (12 + 1 480 = 1 492 → 5 424) est inutilisé. Le modèle livré (`MWROSTER` / `MATH.INF`, 222 384 octets, d'après `engine.md` §7.1) correspond à ce contenu initial. **Enregistrements 1 à 40** : variables de scènes (octet 0 = `4fa4` du hub, puis Bowling, Rhythm, Pattern Windows, etc., voir [../engine.md](../engine.md) §7.1), gros-boutistes, taille utile 5 422 arrondie à 5 424 (`(somme + 15) & 0x1ff0`, `1050:006c`).

**Quand ça s'écrit** : en-tête à chaque fermeture du moniteur (`1080:08fe`) et à chaque réussite d'un niveau (`1010:3fdf`, masque seul, lecture-modification-écriture de l'en-tête) ; variables d'un joueur : `1050:0302` appelé à la sortie des activités, à la création d'un joueur, à la fin de l'accueil du hub ; `1050:0331(joueur, 1)` les recharge à la connexion. **Aucune écriture du roster n'a été vue sur le chemin de sortie** (Ctrl+Q / sifflet n'appelle pas `1050:0302` ; le crochet de sortie `1008:02f3` est absent de `disasm.txt` et n'a été lu que par `engine.md` §1.1 : les variables non sauvées seraient perdues, à confirmer).

### 3.6 Masque de réussites et grade (`1018:0518`)

Masque `u32` : **bit `5 × opération + niveau`**, opération 0–5 = `+ − × ÷ = ≈` (Addition, Subtraction, Multiplication, Division, Equivalence, Estimation, ordre des colonnes et des certificats), niveau 0–3 = LEVEL 1 à 4, **niveau 4 = BONUS ROUND** (`1010:4026` : `bit = 5 × [4b52] + [4d0c]`).

**Grade** (`1018:0518(masque, handle)`) : `grade = 1 + nombre de bits de niveau 0 à 3 positionnés sur les 6 opérations` (les bits « bonus » ne comptent pas), soit 1 à 25 ; le texte est la chaîne `grade` du `STRL 5000` (25 grades, **identiques** dans `TROPHY.DAT` et `BOWLING.DAT` : de « Rookie Roller » à « Strike Master », liste identique au tableau « BOWLING RANKS » du manuel v2) chargée par `10a8:0430`. Le grade est donc global (toutes opérations).

---

## 4. Séquences secrètes et Math Trivia

### 4.1 Historique des touches (`1018:03fd` / `1018:043a`)

À chaque touche non consommée par une scène : `H = (H << 7) | (code & 0x7f)` (u32, `DS:4f1c`) puis `X ^= H` (u32, `DS:0b73`) ; **le code 1 (Ctrl+A) remet `H` et `X` à zéro**. `1018:043a(X, H)` renvoie 1 si les deux valeurs égalent les cumuls courants. Le hub appelle ce suivi quand le moniteur est fermé (`1020:11b0`) ; Pattern Windows (`1060:1786`) et Rockets (`1070:01c2`, `1070:2045`) l'alimentent aussi avec leurs touches ; le test n'a lieu qu'**à l'ouverture du moniteur en mode 4** (`1080:0277`), c'est-à-dire quand on clique Poly.

### 4.2 Clic sur Poly = Math Trivia (moniteur, mode 4)

`1020:098a` (indices 12–13) → `1020:10e2(1, 4)` : joue `SCR 5900`, ouvre le moniteur en vue 4. Au choix :

1. **L'historique correspond à l'une des 19 séquences** (`1080:0277`–`0474`) → affiche `SHPL 301…320` (SHAP de 187 × 117, palette propre : 15 à 17 couleurs en entrées 216–231, appliquées par `10a8:0dc4(216, 18)`) dans l'écran du moniteur, puis `keyHist(0xffff)` ; **pas de voix de Poly**.
2. **Sinon** : tire une trivia `4fa6 ∈ 1…19` (`10a8:13af`, sans répétition, historique `DS:2ede`) → affiche `SHPL 399 + 4fa6` (= 400–418) et, au retour de `1080:0000`, **Poly raconte l'histoire `SCR 6100 + 100 × 4fa6`** (`1020:1f66`), 11 à 32 s, voix 18100–18288.

Dans la vue 4, un clic dans l'écran ou sur Poly (indices 15–17) : **avec Ctrl** passe à la trivia suivante (cycle 1…19 : image suivante + nouvelle histoire) ; sans Ctrl, **rejoue l'histoire courante**.

**Les 19 images de trivia** (SHPL 400–418, rendues) sont des dessins humoristiques de géométrie / arithmétique : 400 cerceau (cercle), 401 tableau noir, 402 fromage / pizza (triangle), 403 tête carrée, 404 pentagone (football), 405 abeille et alvéoles (hexagone), 406 panneau Stop et tortue (octogone), 407 circuit ovale, 408 parallélogramme, 409 trapèze (iceberg et pingouin), 410 robot (losange), 411 voleur et diamant, 412 Pythagore, 413 π, 414 nombre parfait (6), 415 mini-golf, 416 « multiplie avec soin », 417 négatif / trou, 418 échecs.

### 4.3 Les 19 séquences secrètes (photos de l'équipe)

Les 19 images `SHPL 301…320` (sans 314) sont des **photos d'enfance de l'équipe et dessins** (portraits, tigre, chat, voiture, dauphin ; `310` porte la légende « WOLF LOVES MAYU AND TOMOKA », `320` « I wanna be a computer graphic artist. »). Chaque test compare le couple `(X, H)` ; décodage du dernier tronçon de touches (7 bits chacune) et vérification en simulant la formule (outil de travail, hors dépôt) :

| SHPL | `X` | `H` | Dernières touches | Vérification |
|---|---|---|---|---|
| 303 | `0x0000369f` | `0x000036f2` | `m r` | **exact** : tape Ctrl+A puis `mr` |
| 309 | `0x00003406` | `0x0000346e` | `h n` | exact (`hn`) |
| 310 | `0x00003812` | `0x00003862` | `p b` | exact (`pb`) |
| 311 | `0x00003089` | `0x000030e8` | `a h` | exact (`ah`) |
| 312 | `0x0000368f` | `0x000036e2` | `m b` | exact (`mb`) |
| 313 | `0x0000368e` | `0x000036e3` | `m c` | exact (`mc`) |
| 315 | `0x0000318e` | `0x000031ed` | `c m` | exact (`cm`) |
| 316 | `0x00003983` | `0x000039f0` | `s p` | exact (`sp`) |
| 317 | `0x00003103` | `0x00003161` | `b a` | exact (`ba`) |
| 318 | `0x00003680` | `0x000036ed` | `m m` | exact (`mm`) |
| 319 | `0x00003209` | `0x0000326d` | `d m` | exact (`dm`) |
| 320 | `0x0000350f` | `0x00003565` | `j e` | exact (`je`) |
| 301 | `0x6d60b48c` | `0x0dba75e5` | `mike` | `H` exact ; **`X` n'égale pas celui de la seule saisie `mike`** : des touches précèdent |
| 302 | `0xbd41350b` | `0x0c3bb761` | `anna` | idem |
| 304 | `0xd5f0d14a` | `0x0c5b30e8` | `blah` | idem |
| 305 | `0xbf033683` | `0x0e7d30ee` | `stan` | idem |
| 306 | `0xb17e0cf4` | `0x541cf0ed` | `…e sam` (5e touche : quartet bas 5) | idem |
| 307 | `0xb17fc87d` | `0x541d37ed` | `…e tom` | idem |
| 308 | `0xb17a8c6c` | `0x54187974` | `…e art` | idem |

Les 12 codes de deux lettres sont des **initiales** (hypothèse). Pour les 7 autres, la formule `X` est linéaire sur GF(2) : toutes les touches avant les quatre dernières contribuent par un même terme, donc les touches précédentes ne sont pas identifiables de façon unique ; `X` est cohérent avec « Ctrl+A, un préfixe, puis le prénom ». **Séquence complète non établie** pour ces 7 (question ouverte §12). Ordre d'évaluation du code : `0277` → `045a` dans l'ordre des SHPL `301…313, 315…320`.

`engine.md` §7.4 comptait 18 séquences : il y en a **19**.

---

## 5. Crédits (scène 9, `CREDITS.DAT`)

Descripteur `DS:2b8a` : `Enter 1078:00e4`, `Leave 1078:01eb`, `Tick 1078:024a`, pas d'`Exit`, ni `Key`, ni sauvegarde. Accessible seulement depuis le titre (plaque).

### 5.1 Layout

- **Fond** : `SHPL 106`, plaque de verre biseautée sur fond orange (SHAP 106). Zone de contenu : RECT `DS:2bf2` = (103, 54, 471, 377).
- **4 pages d'images de texte** (`SHPL 1000`, 4 formes dessinées en mode 8 aux positions de `DS:2c08` : (152, 65), (118, 85), (208, 104), (103, 64)) : SHAP 1000 (265 × 296 : titre « MATH WORKSHOP », concept original, design, programmeurs), 1001 (332 × 257 : direction artistique, personnages / animation, art), 1002 (153 × 218 : direction et conception sonores, voix), 1003 (368 × 299 : produit, assurance qualité, remerciements). Texte cuit dans les images (noms propres non reproduits ici).
- **Bouton EXIT** (SHPL 1020 : SHAP 1020 rouge 41 × 32, 1021 vert 39 × 30), `1038:01af` ; enregistrement (62, 92, 103, 124) ; **bouton plein écran** `DS:7e7a` (rect de l'écran de jeu `8bc6…8bcc`).
- **Animation** `SCR 2000` (SHPL 2000, 14 formes 2000–2013) : étincelle sur la plaque (1 seule animation de l'archive).

### 5.2 Flux

Enter : `1008:0522` (MIDI 65000 si Ambient Sounds), ouvre `credits.dat`, fond `106`, dessine la page 0, **sauvegarde** le rectangle de contenu (`10a8:1023`, handle `DS:7e9e`), groupes `DS:2be6` (2 boutons : 1 = EXIT, 2 = plein écran, `0xc000`), fondu d'entrée, `7eac = maintenant`, `7eb0 = 2`.

Tick (machine `DS:7eb0`, page `DS:7eaa`, cycle `7eb2`, boucles d'étincelle `7eb4`) :

| État | Condition | Action |
|---|---|---|
| 2 (page affichée) | `maintenant ≥ 7eac + 1200` (**20 s**) | restaure le rectangle sauvegardé (page effacée), `04ef` amorce un **balayage** (`1018:0162`, 30 ticks, direction `7eb8` = 0–3 qui tourne tous les deux appels) ; état 3 |
| 2 | sinon, si `7eaa == -1`, `7eb2 ≥ 2`, `7eb4 < 5` | avance l'**étincelle** `2000` (jusqu'à 5 boucles) |
| 3 | `1018:01fd()` : balayage terminé | `7eac = maintenant`, état 4 |
| 4 | `maintenant ≥ 7eac + 30` | `7eaa++` ; si `7eaa == 4` : fin de cycle (restaure la plaque vierge, `7eb2++`, `7eb4 = 0`, `7eaa = -1`) puis page 0 ; sinon dessine la page `7eaa` ; amorce le balayage ; état 1 |
| 1 | balayage terminé | `7eac = maintenant`, état 2 |

Les crédits **tournent en boucle** jusqu'à ce que le joueur sorte. Callback de groupe `1078:044b(indice)` : **1 (EXIT)** : curseur occupé, `10a8:0000(0)`, fondu vers noir, `scene_credits_leave`, **`1b20 = 8` (titre)** ; **2 (clic ailleurs)** : si état 2, passe tout de suite à l'effacement (page suivante).

### 5.3 Sons / données

Aucune `\0SND` dans `CREDITS.DAT`. Seul son : MIDI 65000 (hub-like, si Ambient Sounds). Tags : `SHPL` 106, 1000, 1020, 2000 ; `SHAP` 106, 1000–1003, 1010, 1020–1021, 2000–2013 ; `\0SCR` 2000 ; `SNDL` 2000 (vide). Variables `DS:7e76…7eb8`. Fonction `1078:0019` (lecture de `math.cfg` + test du CD) est appelée au démarrage, pas par la scène.

---

## 6. Hall of Fame (scène 10, `TROPHY.DAT`)

Descripteur `DS:2c24` : `Enter 1078:0523`, `Leave 1078:0635`, `Tick 1078:06a8` (vide), `Exit 1078:06d9`, pas de `Key`. Accessible **uniquement depuis le Bowling** (`1010:0bc5(2)` → `1b20 = 10`) ; sortie → **Bowling** (`1b20 = 1`).

### 6.1 Layout

Fond `SHPL 107` (SHAP 107) : en-têtes cuits « Name  +  −  ×  ÷  =  ≈ » et 8 barres orange horizontales. Calques `SHPL 2000` (5 rubans 15 × 26, SHAP 2000–2004 : niveaux 1, 2, 3, 4 et BONUS, couleurs vert, orange, rose, violet, bleu), `SHPL 1000` (flèches 19 × 14 : 1000/1001 haut, 1002/1003 bas ; 1004/1005 : bouton « Print My Certificate » 186 × 29), `SHPL 1500` (EXIT 1500 rouge 36 × 25, 1501 vert 34 × 24).

| Élément | Géométrie |
|---|---|
| Ligne `r` (0–7) | y de départ `75 + 37·r`, hauteur 30 |
| Colonne `c` (0–5, opérations `+ − × ÷ = ≈`) | cellule `(172 + 60·c, 75 + 37·r, +51, +30)` (modèle `DS:2d37`) |
| Nom du joueur | police `NCSclB10`, en (48, `87 + 37·r`) (hypothèse : `10d8:7aba(0x30, y)` fixe la position du texte) |
| « Rank: » + grade | (48, `101 + 37·r`) (`DS:2d26` = `"Rank: "`) |
| Rubans d'une cellule | pour chaque bit `i` (0–4) du quintet de l'opération : ruban `i` en (`gauche + 9·i + 2`, `haut + 2`), mode 8 (`1078:0b48`) |
| Page | 8 joueurs par page ; `DS:82b4` = numéro de page ; nombre de pages = `(joueurs − 1) / 8 + 1` ; ordre = ordre alphabétique `DS:82e2` du moniteur |

Groupes `DS:2d0e` (2 groupes, `0xc000`) :

| Groupe | Enregistrements | Rappel |
|---|---|---|
| groupe 1 : 2 boutons (`DS:2cee` à 3 enregistrements, `DS:2cfe` à 1), rappel `1078:0709(indice)` | 1 = flèche haut (38, 39, 57, 53), 2 = flèche bas (38, 54, 57, 68), 3 = **Print My Certificate** (194, 376, 380, 405), 4 = **EXIT** (501, 377, 537, 402) | 1, 2 → page précédente / suivante (`1078:0a9f(0|1)`, réaffiche) ; 3 → impression ; 4 → `1078:06d9` (sortie) |
| groupe 2 : `DS:2cde` (1 bouton à 48 enregistrements `DS:7ebe`, rappel `1078:0829(indice)`) | une cellule par (ligne, opération), indice `1 + 6·r + c` | sélectionne la cellule (`82b8 = joueur = 82e2[8·page + indice/6] − 1`, `82b6 = indice % 6`) |

États des 48 cellules (`1078:0860`) : masquée si la ligne est vide ; **inactive** si le quintet de l'opération vaut 0 (`masque & 0x1f == 0`) ; sinon active, et la **première** cellule active rencontrée est présélectionnée. Le bouton « Print My Certificate » est actif en permanence mais ne fait rien si `82b8 == −1`.

### 6.2 Flux

Enter : MIDI 65000 (si Ambient Sounds) ; ouvre `trophy.dat`, fond 107 ; sauvegarde 8 rectangles de lignes (`DS:8294…82b4`, `10a8:1023`) ; `SHPL 2000` ; **lit l'enregistrement 0 du roster** dans un tampon (`1078:0a55`) ; `1078:0860` remplit la page ; groupes ; boutons `SHPL 1000` et `SHPL 1500` (`1038:01af`) ; fondu d'entrée. La page n'est jamais remise à 0 (`82b4`) : elle est conservée d'un accès à l'autre dans une même session (hypothèse : variable initialisée à 0 au démarrage).

### 6.3 Certificat (`1078:0709` indice 3 → `1088:0120`)

Conditions : une cellule sélectionnée (`82b8 ≠ −1`), donc au moins un niveau de l'opération réussi. Données : nom du joueur, **grade global** (`1018:0518` sur le masque complet), quintet de l'opération (`masque >> 5 × opération`), numéro d'opération. `88b4 |= 1` désactive les gadgets pendant l'impression ; `1098:048a(0xffff)` vide la file d'entrée ensuite.

Travail d'impression (`1088:0000` pour le vitrail, `1088:0120` pour le certificat ; titre de document `"Certificate"` `DS:2f36`, `"Stained Glass"` `DS:2f28`) : `PRINTDLG` de `COMMDLG` (`10d8:8e7a`) et contexte imprimante (`10d8:378d`) dans `1088:0220` ; puis, par page, `1088:0385` (début de page : hypothèse), rendu `1088:0a9f`, `1088:03ac` (fin de page, la page est relancée tant qu'il renvoie 6 : hypothèse « réessayer »), et `1088:02ea` (fin de document : hypothèse). Les noms StartDoc / StartPage / EndPage / EndDoc sont déduits de l'enchaînement. Le manuel v2 impose « paysage, couleur / niveaux de gris, pas de substitution de police ». Les WMF sont des métafichiers placeables de **16 405 × 12 532 unités à 1 620 / pouce = 10,1 × 7,7 pouces** (paysage), sans texte (polygones et polylignes : `BKG.WMF` 544 crayons, 571 polygones ; `RIB1–4.WMF` et `RIBB.WMF` ≈ 18 polygones chacun).

Ordre de dessin de `1088:0a9f` : (1) les **textes** (`1088:0b49`), (2) `BKG.WMF` (fond décoratif, `1088:09bd(0)` puis `1088:03ed` : `GETDEVICECAPS`, `PLAYMETAFILE`), (3) pour `i = 0…4`, si le bit `i` du quintet est positionné : `RIB1.WMF`, `RIB2.WMF`, `RIB3.WMF`, `RIB4.WMF`, `RIBB.WMF` (chemins : répertoire de l'installation `10a8:08f4` + nom, `DS:2f42…2f6e`). Le test est **bit par bit** : les rubans des niveaux réussis seuls apparaissent, chacun dans le repère du fond.

Textes (polices TrueType installées, `Market` = `MARKET__.TTF`, `NewZurica` = `NEWZURCA.TTF` ; positions en pouces × résolution de l'imprimante, constantes `double` en `DS:2f77…30cf`) :

| Texte | Police | Chaîne (`DS:`) |
|---|---|---|
| Titre | Market | `"Addition Certificate of Merit"` `2f9f` / `"Subtraction …"` `2fbd` / `"Multiplication …"` `2fde` / `"Division …"` `3002` / `"Equivalence …"` `3020` / `"Estimation Certificate of Merit"` `3041` |
| Nom du joueur | Market | nom du roster |
| Légende 1 | NewZurica | `"this certificate is awarded to"` (`30a6`) |
| Légende 2 | NewZurica | `"who has achieved the rank of"` (`30d7`) |
| Grade | Market | chaîne du `STRL 5000` (paramètre `[BP+0xe]` de `1088:0120`) |

(Les rectangles exacts ne sont pas reconstruits ; constantes : 0,4 / 0,35 pouce en y, 1,985 et 8,485 pouces en x pour le titre, 1,513 ; 2,423 / 6,813 / 2,403 pour le nom, 3,215 pour le grade ; 0,2 / 2,066 pour la 1re légende, 2,878 pour la 2e : **hypothèse** sur l'attribution des rectangles.)

---

## 7. Quitter le jeu

| Chemin | Détail |
|---|---|
| **Bouton Quit** (pupitre du hub) | 1er clic : `1020:0e7b(1)` : `SCR 10300` (le sifflet apparaît : sons 13055 / 13056), `0c5c = 1`, enregistrements 1 (sifflet) et 14 (plein écran) activés, `4fac` = `8300` ou `8400` (50 %), rappel de Poly après 240 ticks (`4fa8`) ; **2e clic sur le sifflet** (indice 1) : `0dbc(1)` → `SCR 10100` (sortie confirmée, son 13054, 2,3 s), puis `10200` rembobiné et joué (13099), puis `1008:02da` ; **clic ailleurs** (indice 14) : `0dbc(0)` → seulement `10200` rembobiné et joué (la mécanique se range), invite annulée, ambiance relancée |
| Ctrl+Q (`0x11`) | `1008:02da` direct, sans confirmation |
| Fermeture de la fenêtre (`SC_CLOSE`), Alt+F4 | idem |
| Effet | `DS:00f6 = 1`, `1088:0e72("")` : sortie propre **sans message** ; d'après `engine.md` §1.1 le crochet `1008:02f3` retire le rappel d'inactivité, restaure l'archive, arrête les sons ; aucune sauvegarde du roster vue (§3.5) |

Il n'y a ni boîte « Voulez-vous quitter ? » ni sauvegarde automatique : la confirmation est le jeu du sifflet.

---

## 8. Récapitulatif des tables du segment de données

| `DS:` | Contenu |
|---|---|
| `0c0e` | descripteur de scène hub |
| `0c28…0c35` | 5 ids de tableaux du chevalet (`1825, 1850, 1875, 1900, 1925`) |
| `0c36` / `0c38` | index du papillon / séquence `1,2,3,4,3,2` |
| `0c50…0c5b` | handle de fond sauvegardé, `RECT` télé `(460,205,513,316)` |
| `0c70…0d97` | 14 enregistrements du groupe 0 |
| `0d88`, `0e10`, `0ed4` | boutons des groupes 0, 1, 3 |
| `0d98…0dd3` | 3 enregistrements des boutons du pupitre |
| `0dd4`, `0e04` | rects des images, sons d'appui des boutons (`3057 / 0 / 3012 / 0 / 3020 / 0`) |
| `0e20…0ecf` | 9 enregistrements du groupe 3 |
| `0ee4…0f13` | les 4 groupes de gadgets du hub |
| `0f1e…1046` | descripteurs d'animation (12 octets) : `0f1e`=6000, `0f2a`=6100, `0f36`=2700, `0f42`=2800, `0f4e`=2900, `0f5a` accueil, `0f66` salutation, `0f72` retour, `0f7e` lancement, `0f8a`/`0f96` sifflet, `0fa2/0fae/0fba/0fc6` leviers, `0fd2` voix, `0fde`=1400, `0fea`=1500, `0ffe`=1700, `100a`=1800, `1016`=1825, `1022`=2000 |
| `102e` / `103a` | ids d'accueil `5000…5300` / de salutation `5400…5700` |
| `1050…10c7` | 15 `RECT` de survol |
| `10c8`, `10d0` | `RECT` main « stop », zone Quit / Help |
| `1ebc`, `1e94…1eb4` | définition de l'en-tête du roster |
| `2694…26a0`, `2684`, `265c`, `2670` | groupe, bouton et enregistrements du titre |
| `26b8…2724` | descripteurs d'animation du titre |
| `2b8a`, `2be6`, `2bc6`, `2bd6`, `2bb2` | crédits : descripteur, groupe, boutons, `RECT` |
| `2c08…2c17` | positions des 4 pages de crédits |
| `2c24`, `2c3c…`, `2c7e`, `2cca`, `2d0e`, `2d1a` | Hall of Fame : descripteur, vtable de rappels, enregistrements, groupes |
| `2d4e…2eca` | moniteur : rects, 17 enregistrements `2d66…`, indices d'images `2ef0` |
| `2f28…30f4` | chaînes d'impression + constantes `double` |

---

## 9. Écarts avec le manuel de 1997 (Deluxe v2)

| Sujet | v1 (CD) | Manuel v2 |
|---|---|---|
| Niveaux du hub | **un seul étage** | Level 1 / Level 2 (« Upstairs / Downstairs ») |
| Boiler Room | absente | présente |
| Boutons du pupitre | **3** : Quit, Help (sourire), Sign-in (crayon) | Quit, Help, Sign-in, Math Trivia, Preferences, Tracking, Upstairs / Downstairs, Level Brothers |
| Math Trivia | **clic sur Poly** (tête ou corps), 19 dessins + 19 histoires ; les séquences secrètes remplacent le dessin par des photos | bouton Math Trivia |
| Préférences | **Ctrl + clic sur Sign-in** (non documenté) : Ambient Sounds, Click & Stick, timer du Bowling, Roster | bouton Preferences visible |
| Suivi des progrès | **Hall of Fame** (depuis le Bowling), 6 colonnes d'opérations, rubans par niveau ; pas d'écran « Progress / Export File » | Tracking + Export File (tab-delimited) |
| Temps de jeu du Bowling | 1–999 s (défaut 180 s) | 1–999 s |
| Sortie | sifflet (Quit) | « Quitting Time Whistle » |
| Joueurs | 40 max, tri alphabétique, 3 lignes visibles | 40 max, Player List |
| Certificat | `Market` / `NewZurica`, WMF paysage | idem (v2 documente l'impression paysage) |
| Mode sans animations | Ctrl à l'entrée du hub (non documenté) | – |

---

## 10. Plan d'implémentation TS

### 10.1 Services du moteur dont ces écrans ont besoin (à partager)

| Service | Contenu minimal |
|---|---|
| **SceneManager** | table des scènes avec `enter / leave / tick / exit / key`, demande de changement différée au tour de boucle suivant, archive courante par scène, boucle `yield` avec tick 60 Hz |
| **Lecteur `\0SCR`** (voir [../scr.md](../scr.md)) | lecture **bloquante** « jusqu'au bout » avec drapeaux (interruptible par clic / touche, restauration du fond, attente des sons) et lecture **coopérative** `step()` / `rewind()` / `fastForward(n)` ; plusieurs animations simultanées ; échéance exacte vs recalée (`8732`) ; zone d'écrêtage ; fond sauvegardé (`+8`) ; hooks |
| **Palette / fondu** | palette 256 entrées, `SHPL` partielle (secrets : entrées 216–231), fondu mode 1 vers une cible (noir ou palette courante), durée 30 |
| **Surfaces** | port d'écran, port de travail, rectangle sauvegardé / restauré (`e2SaveRect`), **balayage** à 4 directions (`1018:0162`), `present(rect)` |
| **Formes** | `drawShape(shpl, indice, x, y, mode 0|8)`, rendu d'images indexées ; texte bitmap `NCSclB10` avec **mesure de largeur** (nom < 110 px) et curseur clignotant |
| **Gadgets** | groupes / boutons / enregistrements, états survol / appui / relâché, drapeaux (masqué, désactivé, sélectionné), sons d'appui, Tab / Maj+Tab / Entrée, rappel avec indice, activation / désactivation par groupe, hit-test `[gauche, droite[ × [haut, bas[`, boutons à 3 états `1038` |
| **Curseur** | flèche / sablier / point d'interrogation (`CURS` 1, 2 de `MILKYWAY.DAT`) |
| **Audio** | WAVE (one-shot, boucle, `isPlaying`, arrêt, préchargement / libération par `SNDL`), MIDI (lecture, arrêt de tous les MIDI), commutateur global « Ambient Sounds » ; priorité aux voix |
| **Aléatoire** | tirage sans répétition `pool(masque, n)` (`10a8:13af`), `rand(min, max)` |
| **Minuteries** | tick global, échéances (`4f9e`, `4f78`, `4f84`, `4fa8`), compte à rebours interruptible par entrée (`1088:1091`) |
| **Roster** | en-tête (version, nombre, timer, click & stick, ambient), 40 emplacements `{utilisé, nom[32], masque}`, tri alphabétique, doublons, création / suppression, variables de scènes par joueur (définitions + remise à zéro + conversions), sauvegarde différée aux mêmes moments que l'original |
| **Historique de touches** | `H`, `X`, reset Ctrl+A, 19 couples |
| **Impression** | rendu de certificat paramétré par (nom, grade, opération, quintet) |
| **Sortie** | demande de fin de jeu |

### 10.2 Machines à états proposées

**Titre** : `Logo` (1re entrée seulement, 300 ticks interruptibles) → `Intro` (fondus) → `Titre` (10 animations en boucle + musique ; clic porte / fin de musique) → `PorteOuverte` (SCR 10000, non interruptible) → hub ; ou clic plaque → `Crédits`.

**Hub** : `Entrée` (musique, accueil, retour d'activité) → `Normal` ↔ `Aide` ; `Normal` → `Moniteur{connexion | préférences | roster | trivia}` → `Normal` ; `Normal` → `InviteQuitter` → `Quitter | Normal` ; `Normal` → `Lancement` (anim de départ, fondu) → activité. Parallèlement : sous-machine « voix » (`Libre | Parle`) et sous-machine « ambiances » (5 clips d'attente tirés sans répétition + bavardages + 6 boucles pilotées par interrupteurs).

**Moniteur** : `Ouverture (glissement)` → `Liste` ↔ `Saisie du nom` ↔ `Préférences` ↔ `Roster` ; `Trivia` ; `Fermeture (glissement)` → écriture de l'en-tête, chargement du joueur.

**Crédits** : `Page(n) → Balayage → Attente 20 s → Effacement → Page(n+1)`, boucle, sortie vers le titre.

**Hall of Fame** : `Page(p)` avec `Sélection(cellule)` ↔ `Impression` ; sortie vers le Bowling.

### 10.3 Adaptations web (options, pas des décisions)

| Sujet | Options |
|---|---|
| **Impression des certificats** (et du vitrail) | (a) **vue imprimable HTML/SVG** (`@page` paysage, WMF convertis en SVG à la construction : ≈ 100 Ko de polygones ; polices `MARKET__.TTF` / `NEWZURCA.TTF` fournies sur le CD) puis `window.print()` ; (b) export **PDF / PNG** téléchargeable ; (c) afficher le certificat à l'écran sans impression ; (d) reproduire la boîte « Print… » du navigateur uniquement. Décision à prendre : fidélité vs simplicité |
| **Saisie du nom** | (a) reproduire le tampon de touches avec les règles exactes (28 caractères, 110 px, majuscules automatiques) sur canvas ; (b) un vrai `<input>` HTML superposé (accessibilité, clavier virtuel mobile) avec les mêmes contraintes ; (c) autoriser plus de caractères (les noms français accentués sont refusés par l'original) |
| **Moniteur « Windows »** | rien à convertir : l'original est déjà dessiné ; garder le rendu dessiné et ses boutons |
| **Roster** | `localStorage` / IndexedDB (JSON) à la place de `MWRoster` ; option d'**import / export du fichier d'origine** (222 384 octets, formats §3.5) ; 40 joueurs ou plus ? (l'original est limité à 40 par la taille du fichier) |
| **Ctrl+clic** (préférences) et **Ctrl à l'entrée** (mode sans animations) | clavier seulement : prévoir un équivalent tactile (appui long, comme pour Lost in Time) ou un accès visible aux préférences ; le mode sans animations a-t-il un sens sur le web ? |
| **Quitter** | rien à fermer : retour à la page du jeu / à l'accueil du site ; garder le sifflet comme confirmation (et Ctrl+Q ?) |
| **Séquences secrètes** | conserver tel quel (clavier) ; pour mobile : un geste équivalent ou les ignorer ; compléter les 7 séquences non résolues |
| **Musique** | `Ambient Sounds` = interrupteur déjà présent ; MIDI 65000 à jouer via un synthé web ou à pré-rendre |
| **Polices** | `NCSclB10` (`NCSCLB10.FON`, bitmap Windows 3) : parser le `.FON`, ou police web équivalente en conservant la règle de largeur 110 px |
| **Plein écran / 576 × 432** | zone de jeu centrée, 640 × 480 noirs autour ; mise à l'échelle entière / CSS |
| **Textes d'interface** | aucun nouveau texte requis pour reproduire ces écrans (tout est dans les images) ; seuls les textes des adaptations (impression, import / export) seraient du nouveau contenu **à valider** |

---

## 11. Écarts avec engine.md

1. **§1.5 / §8.1, rectangles du hub** : « 15 `RECT` à `1108:1050` » sont la table de **survol / aide** ; les clics passent par 14 enregistrements de gadgets (`DS:0c70`) dont les rectangles **diffèrent** (dôme découpé en 4 tranches avec ids 2–5, pas 3–5, etc.). Les correspondances indice → scène (`2–5→3, 6→6, 7→2, 8→7, 9→5, 10→1, 11→4`) sont exactes pour les enregistrements `0c70`, pas pour la table `1050`.
2. **§1.5, zones 12–13 « écran secret »** : ce sont **Poly (tête, corps)** et l'écran est **Math Trivia** ; les séquences secrètes ne servent qu'à y afficher des photos. Les zones 1, 14, 15 de la table `1050` sont : 1–2 Poly (sortie de l'aide), 14 le rideau (Bowling), 15 la télé.
3. **§6 audio** : « aucun bouton marche/arrêt du son identifié » est faux : le moniteur de préférences a **Ambient Sounds** (`DS:2d64`) qui commande le MIDI `65000` et les bavardages.
4. **§7.1 en-tête du roster** : octet 2 = **nombre de joueurs** (pas 0) ; octet 4 = timer du Bowling en **ticks** (10 800 = 180 s, pas 3 h) ; octets 8 et 10 = **Click & Stick** et **Ambient Sounds** (écrits en gros-boutiste par la définition `1ebc`, `engine.md` les dit natifs). Le masque `u32` du joueur est bien natif.
5. **§7.4 modes du moniteur** : mode 1 = connexion, **3 = Préférences (Ctrl + clic sur Sign-in)** avec sous-vue Roster, 4 = Math Trivia ; « 18 séquences » → **19**, `SHPL 400–418` = dessins de **Math Trivia** (19) associés aux histoires `SCR 6200–8000`, `SHPL 301–320` (sans 314) = photos de l'équipe. L'analyse 1080:0000 est dans la scène ; elle appelle `1080:0581` (saisie).
6. **§8.1** : l'accueil n'est pas « si `4fa4 == 0` » seulement ; il y a trois couches : accueil (5000–5300, 1re entrée), salutation après connexion (5400–5700), introduction longue `5800` (`4fa4 == 0`).
7. **§8.5 « Pas de bouton Quitter identifié »** : le bouton Quit est le 1er du pupitre ; la sortie est l'invite du sifflet (§7).
8. **§8.2 Poly** : Poly est la fillette du hub ; `POLLY.DAT` contient ses animations d'aide dans les activités.
9. **§8.6 Hall of Fame** : « une case active si au moins un des 5 bits » est exact, mais les cases affichent **les rubans des niveaux réussis** (5 rubans par cellule, dessinés bit par bit) ; le grade est `1 + (bits de niveau 0–3 positionnés)` sur toutes les opérations (hors bonus).
10. **§1.4, titre** : « attend un clic/une touche ou la fin du compte à rebours » ne vaut que pour le **logo** de la 1re entrée ; l'écran titre lui-même n'attend que le clic sur la porte ou la fin de la musique, et n'a aucun bouton de sortie des gadgets au-delà des deux hotspots.
11. **§4.8 impression** : le certificat imprime d'abord les textes puis `BKG.WMF` puis les rubans bit par bit ; la mise en page est paysage 10,1 × 7,7 pouces (extent des WMF).
12. **§5.3** : Ctrl+A (code 1) réinitialise l'historique des séquences secrètes.
13. Le hub a une quatrième structure non listée au §1.6 : groupes de gadgets `0ee4`, `0ef0`, `0efc`, `0f08` et un cinquième enregistrement de boutons « jouets » (`0e20`).

---

## 12. Questions ouvertes

1. **Séquences complètes** des 7 codes `mike`, `anna`, `blah`, `stan`, `…e sam`, `…e tom`, `…e art` (préfixe inconnu) ; initiales des 12 autres (hypothèse). Reconstruire à l'aide de la mémoire de Windows (clavier tapé en vrai) ou des remerciements.
2. **`DS:34c9`** (drapeau lu par les boucles `1500` et `1800`), **`DS:0f1c`** exact (dernière scène lancée), valeurs initiales de `874a`.
3. **Boucle du WAVE `1000`** (`loopCount = 1`) : musique jouée une ou deux fois ? donc délai avant l'entrée automatique dans le hub.
4. **Chemin exact de `MWRoster`** (`DS:4a2c` + `"MWRoster"`) : répertoire de l'exécutable ou répertoire courant ; comportement quand le dossier est en lecture seule.
5. **Contenu parlé** des clips de Poly (non audible ici) ; sens de `4000` (clip non référencé) ; `13094` non référencé.
6. **Constantes de mise en page du certificat** : rectangles exacts des textes en pouces ; police et corps réels (`Market`, `NewZurica` : tailles ?) ; marges ; ordre réel d'empilement avec le fond (`BKG.WMF` peut recouvrir le texte).
7. **Bits des drapeaux de gadgets** (`0x2068`, `0x8040`, `0x206c`, `0xc000` des groupes) : sémantique précise (survol, suivi, double-clic).
8. **Unité de la durée du fondu** (`1088:1b25`, 30) et nature exacte du mode 1 vs 0.
9. **Pages du Hall of Fame** : la variable `82b4` est-elle réinitialisée à la création du processus seulement ? Ne se positionne-t-elle jamais sur le joueur courant ?
10. **`1080:0000` appelé depuis le Bowling (`1010:0bc5(1)`) et Pattern Windows (`1060:03d5`)** : mêmes vues mais fond différent (le moniteur est dessiné sur l'écran courant) ; comportement du fond sauvegardé et des gadgets de ces scènes à documenter par leurs études.
11. **Hover des enregistrements 3 à 5 du hub** en mode normal : aucun retour visuel identifié (les images 200–205 changent à l'appui seulement ?).
12. **Pertinence du mode sans animations** (`874a`) : lien avec le profil de machine ?

---

## Implémentation (moniteur)

Code : `src/games/mathemagique/scenes/monitor/` (`monitor-overlay.ts`, `name-text.ts`, `text-input.ts`, `index.ts`). Tests : `test/mathemagique/monitor.test.ts` (les parties qui lisent `MAINSCRN.DAT` sont ignorées sans `original/mathemagique/`). Le moniteur de §3 et la Math Trivia de §4.2 sont un composant `MonitorOverlay` posé sur la scène courante (accueil, plus tard Bowling et Pattern Windows).

### Brancher le moniteur dans une scène

```ts
const overlay = new MonitorOverlay({ ctx, services, archive /* MAINSCRN.DAT */, font /* loadMonitorFont(host) */, textInput, sceneGroups: () => [mesGroupes], hub: true });
overlay.open("signin" | "roster" | "preferences" | "trivia", (result) => { … }, { secretPhoto?: 301…320 });
```

Dans la scène : `tick()` du moniteur dans `Scene.tick` (après le crochet des services), `key(event)` dans `Scene.key` (vrai = consommée ; Ctrl + touche n'est jamais consommé, Ctrl+Q reste global), `dispose()` dans `Scene.leave`. `isOpen`, `ready`, `typedName` sont lisibles.

- **Modes** : `signin` = §3.2 mode 1 ; `roster` = mode 2 ; `preferences` = mode 3 (Ctrl + clic sur Sign-in, appui long de 500 ms sur tactile : à la charge du hub) ; `trivia` = mode 4. Roster vide en `signin` : saisie d'un nom tout de suite ; un seul joueur : présélectionné. Les vues passent de l'une à l'autre par les boutons Roster / Preferences comme dans l'original.
- **Archive** : le moniteur lit `MAINSCRN.DAT` (formes `SHPL 50000`, dessins 400–418, photos 301–320, sons 3044–3052, `SCR` de Poly 2600, 5900, 6200–8000, 8500–8700) quelle que soit la scène : le Bowling devra la charger (portée `persistent` ou `scene`). La palette à l'écran doit être celle du hub (couleurs 10, 184 et 201 pour le texte, le survol et le fond de l'écran).
- **Groupes de gadgets** : le gestionnaire teste les groupes dans l'ordre d'ajout ; le moniteur s'ajoute donc en dernier et neutralise (`active = false`) les groupes donnés par `sceneGroups()` le temps de l'ouverture, puis rétablit leur état d'avant. `GadgetManager` n'expose pas la liste de ses groupes : un accès public (ou un mode « modal ») évitera à chaque scène de les fournir.
- **Fond** : le rectangle (244, 240)–(492, 432) est sauvegardé à l'ouverture et restauré à chaque tick (avant de tout redessiner) et à la fermeture : la scène ne doit pas animer sous le moniteur. Le glissement fait 15 px tous les 2 ticks (13 pas, 0,44 s : hypothèse, l'original n'est connu que par ses sons de 1,1 s) ; sons 3051 / 3052 à l'ouverture, 3050 / 3049 à la fermeture.
- **Résultat** (`onClose`, appelé quand le moniteur a fini de descendre et que le roster est enregistré) : `{ mode, playerId, previousPlayerId, createdPlayerId, ambientChanged }`. Le joueur courant est tenu à jour en direct dans `ctx.roster.currentPlayerId` (comme `1e90`). C'est à l'accueil de jouer ensuite l'introduction (`5800`) si le joueur créé n'a pas encore vu Poly, la salutation, et de couper ou relancer la musique si `ambientChanged` (`1020:1e35`).
- **`hub: true`** : doublon → Poly joue 8500, 8600, 8700 à la suite ; liste pleine → 2600. Sinon (`false`) : son 18677 ; liste pleine : les voix 19656 à 19658 à la suite (`common.md` §3.4).

### Saisie du nom et accents

Le nom se tape dans le canvas (police `NCSclB10`, curseur `|` clignotant, 15 ticks) ; le champ HTML invisible n'existe que pour ouvrir le clavier virtuel : `TextInputPort` (`text-input.ts`) est une interface pure (`focus()`, `blur()`, `onText(cb)` ; `"\b"` = retour arrière, `"\n"` = Entrée), l'implémentation navigateur est dans `ui/`. Le port ne doit relayer que ce qui n'arrive pas déjà par `Input.keyDown`, sinon un caractère serait saisi deux fois. `focus()` est appelé au clic sur New Player / Add et en entrant dans les préférences (geste du joueur), `blur()` à la fin de la saisie.

- Règles de `roster.ts` étendues par un paramètre **`NameRules`** (`isLetter`) passé à `isNameChar`, `canAppendNameChar`, `formatPlayerName`, `isValidPlayerName`, `Roster.addPlayer` et `renamePlayer` ; défaut `ASCII_NAME_RULES` (comportement d'origine, tests inchangés), `LATIN1_NAME_RULES` = `À`–`ÿ` sauf `×` et `÷`. Le roster garde un octet par caractère (Latin-1 = Windows-1252 sur ces lettres) : rien d'autre ne change dans le format de `MWRoster`. La mise en majuscule (`toUpperCase`) ne sort jamais du Latin-1 (`ÿ`, `ß` restent tels quels).
- **Les polices `.FON` du jeu sont en Mac Roman, pas en Windows-1252** (le glyphe 0x8E est « é », 0xCB « À », 0xE9 « È » ; `÷` en 0xD6 y est le `÷` Mac Roman, ce que `graphics.md` notait comme une particularité). `encodeText` (`graphics/text.ts`) convertit vers Mac Roman (tâche H7) ; le moniteur passe directement ses chaînes à `drawText` / `measureText`. Les règles du moniteur (`MONITOR_NAME_RULES`, déduites de la table de `encodeText`) sont le sous-ensemble du Latin-1 dont la police a le glyphe : sans `Ð ð Þ þ Ý ý`, `×`, `÷`. `NCSCLB10` et `NCSCLB12` ont les glyphes ; `0xCA` (espace insécable) est vide.
- Touches : `canAppendNameChar` (28 caractères, puis largeur < 110 px mesurée par `measureText` sur les codes de glyphe) ; Retour arrière ; Entrée = OK ; hors saisie, 1 à 3 sélectionnent les lignes, flèches haut / bas font défiler. Dans la vue préférences, seuls les chiffres comptent (3 au plus, « 0 » initial remplacé par le 1er chiffre).
- **Entrée = OK**, même si la souris est restée sur New Player ou une bascule : seul un bouton qui a le focus clavier (Tab) est activé par Entrée. Sans cela l'Entrée du gestionnaire de gadgets (qui active le survol) créerait le joueur puis recommencerait une saisie.
- **Doublon** : le joueur n'est pas créé, la saisie reste ouverte avec le nom tapé (le joueur peut corriger ; l'original ne dit pas si le moniteur reste ouvert : hypothèse) ; un nom qui ne diffère que par un accent n'est pas un doublon. Nom vide : la saisie s'arrête sans créer. 40 joueurs : New Player / Add ne démarrent pas de saisie.

### Roster, préférences, trivia

- **Enregistrement** : `ctx.roster.save()` à chaque création, suppression et fermeture (et à `dispose`). Les bascules Ambient Sounds et Click & Stick s'écrivent tout de suite dans l'en-tête du roster, donc agissent en direct (le son relit `roster.ambient` à chaque demande, le pointeur `roster.clickAndStick` à chaque prise ; décocher Ambient appelle `stopAmbient`) ; elles ne sont écrites en stockage qu'à la fermeture. Le timer est lu **à la fermeture** (ou en quittant la vue) : pris s'il vaut 1 à 999 s, sinon l'ancienne valeur reste (comme `1080:08fe`) ; le Bowling le lit dans `roster.bowlingTicks`.
- **Sélection** : un clic sur un nom fixe le joueur courant (son 3044) ; un second clic sur la même ligne dans les 15 ticks vaut OK, sauf si le moniteur a été ouvert sur les préférences (`8357`). Delete sans joueur sélectionné : sans effet.
- **Math Trivia** : `SCR 5900` (non bloquant pour le moniteur : lecteur en mode bloquant avant la montée, interruptible par un clic), puis tirage sans remise parmi 19 (`NoRepeatPool`, mémoire tenue par l'instance du moniteur) : dessin `SHAP 399 + n` dans l'écran, histoire `SCR 6100 + 100 n` en voix. Un clic sur l'écran ou Poly rejoue l'histoire ; avec Ctrl, trivia suivante du cycle 1…19. `secretPhoto` (301 à 320) affiche la photo avec sa palette en 216–233 (rendue à la sortie) et aucune histoire ; l'historique de touches et l'appel sont à la charge de la scène.
- Son d'OK : 3045 avec 5 % de chances, sinon 3046 (lecture de « 5 % / 95 % » du §3.1 : hypothèse).

### Écarts, hypothèses, points ouverts

- Ordre alphabétique : `Roster.players()` compare les points de code en minuscules, donc les noms accentués (`Élodie`) passent après `Z`. Une comparaison par `localeCompare` ou sur la lettre de base serait mieux ; non faite (hors du changement de `roster.ts` demandé).
- Pas de hover visuel dans l'original : les boutons prennent leur forme enfoncée au survol et au focus clavier, une ligne de nom survolée est cernée en bleu clair.
- Mobile : pas d'équivalent tactile du Ctrl + clic fait ici (`open("preferences")` est à appeler par la scène sur l'appui long) ; le champ invisible est à brancher dans `ui/`.
- Aucune copy nouvelle : tout vient des images et des polices de `MAINSCRN.DAT`.

---

## 13. Implémentation (tâche H1 : titre, crédits, hub)

Code : `src/games/mathemagique/scenes/{title,credits,hub,hub-logic,index}.ts` ; tests : `test/mathemagique/scenes-common.test.ts`. `ui/app.ts` enregistre tout par `registerScenes(engine, services, opts)` (le titre est lancé par `engine.start()`).

**Fait**
- **Titre** : logo à la première entrée seulement (300 ticks, un clic ou une touche le passe), fondus de 30 ticks, fond `SHPL 105`, horloge système (`SCR` 500 posé une fois), 9 animations en boucle, musique `\0SND` 1000 ; porte (258, 266, 320, 344) ou fin de la musique → `SCR` 10000 (bloquant) → fondu → hub ; plaque (117, 329, 150, 353) → musique coupée → crédits.
- **Crédits** : 4 pages toutes les 20 s, effacement et révélation par le balayage à 4 directions (30 ticks, pause de 30 ticks), clic = effacement immédiat, étincelle `SCR` 2000, EXIT → titre (sans logo), MIDI 65000 si « Ambient Sounds ».
- **Hub** : 14 objets du décor (`DS:0c70`), pupitre (Quit / Help / Sign-in), 9 jouets (`DS:0e20`, leviers qui gèlent la verrière, le papillon, le chevalet et la télé), 5 boucles d'ambiance + toile du chevalet tirée + papillon, MIDI 65000 (bouclé : repères `setup end` / `loop end`), clips d'attente (240–480 ticks, sans répétition) et phrases d'attente (180–360 ticks, 4 tirées sur 24, « Ambient Sounds »), accueil de Poly à la première entrée puis moniteur de connexion, animation de départ + fondu + `ctx.scenes.request` vers les activités, animations de retour (rideau 1100, engrenage 1300), mode aide (zones `DS:1050`, chaînes de clips où un clic passe au clip suivant, main « stop », curseur « ? » dès la zone 3, introduction rejouée après 300 ticks), invite « quitter » à deux temps (sifflet 10300 → 10100 + 10200 → `host.exit()` ; clic ailleurs : 10200 et annulation ; rappel de Poly après 240 ticks), mode sans animations (Ctrl à l'entrée), séquences secrètes (12 codes, Ctrl+A).
- Sans joueur connecté, un clic sur une activité joue le clip 5000 puis ouvre la connexion au lieu de lancer.

**Branchements restants (à faire par le lead)**
- `opts.openMonitor(mode, detail?)` (`"signin" | "preferences" | "trivia"` ; `detail.secret` = `SHPL` 301–320 de la séquence secrète tapée) : sans lui, Sign-in, Ctrl + clic et Poly ne font rien. Le moniteur doit appeler **`hub.monitorClosed()`** (`HubScene`, `engine.scenes.current`) quand il se ferme : le décor reste inactif tant que ce n'est pas fait ; l'appel fait la finalisation `1020:1e35` (musique selon « Ambient Sounds », introduction 5800 pour un nouveau joueur, salutation 5400–5700).
- **Appui long tactile** = `hub.longPress(x, y)` (préférences si le point est sur Sign-in) ; la détection des 500 ms est à faire côté `ui/`.
- `SCENE_FACTORIES` (`scenes/index.ts`) : une ligne par scène écrite à part ; sans elle, substitut noir qui ramène au hub au premier clic ou touche. Le Hall of Fame (`SceneId.trophy`) ne s'ouvre que depuis le Bowling, pas depuis le hub.

**Écarts et hypothèses**
- `SCR` 500 (horloge) : image `heure × 12 + pas` (l'original compte `+ 1` car le compteur de `1090:0432` part de 1 et s'arrête à la première image qui l'atteint ; `fastForward` part de 0, donc `clockFrame` = `heure × 12 + pas` sans le `+ 1`, vérifié : 144 images de 1 tick) ; **pas de retour à l'heure suivante** : à 55 min et plus (pas 12) et à 12 h, le compteur dépasse 143, le script s'arrête et montre sa dernière image (11 h 55) : comportement de l'original reproduit (hypothèse : défaut d'origine).
- Logo : fond d'indice `0x15` (hypothèse déjà notée §1.1). Fin de la musique : `\0SND` 1000 joué **une fois** ; l'entrée auto exige aussi que sa durée théorique (moins 5 ticks) soit écoulée, pour qu'un audio non débloqué ne saute pas le titre.
- Les animations 3000 et 4000 du titre ne sont pas synchronisées par code : mêmes durées, elles démarrent ensemble.
- Crédits : les 4 pages tournent, l'étincelle n'apparaît que sur la première page à partir du 3e cycle (5 passages au plus) ; la rotation de direction avance toutes les 2 transitions (hypothèse). Phase exacte de `7eaa == -1` non établie.
- Hub : les clips de Poly sont joués en effaçant d'abord la zone sous elle (rectangle `DS:0c50`), Poly au repos est redessinée à leur fin. Un clic passe un clip bloquant (drapeau 8) sans atteindre les gadgets. `0f1c` (retour d'activité) est conservé par partie, comme `874a` (mode sans animations) et `0c48` / `0c4e` (accueil, salutation).
- Le jouet « levier » ne bascule son interrupteur qu'à la fin de son animation, et pas en mode sans animations. La télé coupée montre `SHAP` 102 (écran noir).
- Séquences secrètes : seuls les 12 codes de deux lettres ; l'historique reçoit les touches « caractère » (ASCII, Ctrl + lettre = 1–26, flèches / F1–F12 = VK + 0x7f) quand le moniteur est fermé, et est remis à zéro après l'ouverture de Math Trivia (`keyHist(0xffff)`).
