# SWIV 3D : boucle, cadence, joueur, caméra, commandes (R1)

Rétro-ingénierie de `SWIV_WIN.EXE` (voir `re-index.md` pour les conventions : Watcom, arguments en registres EAX/EDX/EBX/ECX, adresses linéaires). Ce document donne à l'auteur du moteur de quoi réimplémenter fidèlement la boucle, le véhicule du joueur, la caméra et les commandes. Étiquettes : **[confirmé]** lu directement dans le code ou les données ; **[probable]** déduit de plusieurs indices concordants ; **[hypothèse]** à vérifier ; **[calculé]** valeur obtenue en simulant les formules du jeu (script jetable, pas dans le code).

Les fonctions des véhicules (`0043a174`-`0043b0ac`, `00443510`, `00445228`-`00445f44`, `004446a0`) ont une décompilation dans `decomp/` et sont **portées ligne à ligne** (`vehicle.ts`) ; l'hélicoptère (`00439088`, `00444af8`) et la physique de démonstration `00449af8` (hors fonction pour Ghidra : `disasm.txt`) sont portés aussi.

## 1. Boucle et cadence

### Pas fixe, 40 Hz [confirmé]

Le jeu a une **logique à pas fixe de 25 ms (40 Hz)** et un **rendu libre** (une image par tour de boucle, sans limiteur ni attente de synchro verticale).

- Boucle de niveau, `gm_start_level` `00421100` : `tant que état == 1 { si Échap → gm_menu_abort ; gm_frame(7) ; gm_poll_events(5) ; ticksDepuisImage = 0 }`.
- `gm_poll_events` `00410bcc` (EAX = drapeaux de ce qu'il faut faire tourner) : s'envoie à lui-même un message `WM_USER+1` (`PostMessageA(hwnd, 0x401, 0, 0)`), puis vide la file avec `PeekMessage/GetMessage/DispatchMessage`. Pour chaque message, il ajoute l'écart des **horodatages de message** (`msg.time`, ms) à un accumulateur `00480aac` :
  ```
  acc += msg.time - dernierTemps ; dernierTemps = msg.time
  si acc > 800 : acc = 0                 // arrêt > 0,8 s (pause, fenêtre inactive) : on abandonne le rattrapage
  tant que acc > 0x19 (25) : acc -= 25 ; un tick
  ```
  D'où **25 ms par tick, 40 ticks/s**. La mesure confirme : `gm_start_level` ajoute `compteurTicks / 0x28` (40) au temps de jeu du pilote en secondes (`00421523`).
- Un tick (selon les drapeaux de EAX) :
  - bit 0 (1) → `FUN_0043c234` **un tick de logique de jeu** (§2) ;
  - bit 1 (2) → `FUN_004157d0` animation de décompte des scores des menus (hors niveau) ;
  - bit 2 (4) → `FUN_004234ec` file des effets (particules) : `pos += vel`, durée `+0x38` décrémentée, libération quand elle passe sous 0 ;
  - puis toujours `00480bf0++`, `00480c84++` (horloge globale, lue par `gm_frame` : `00480bf4 = 00480c84`), `00480c68--` si > 0 (initialisé à 0x50 = 2 s au chargement du niveau, décompte de début).
  Dans le niveau, EAX = 5 (logique + effets). Pendant les menus de pause et autres, la logique (bit 0) n'est pas appelée : **la pause est un sous-menu bloquant dans `gm_frame`** (touche `0x45`, voir §5), pas un drapeau.
- Précision de l'horloge : celle des horodatages Windows 95 (quelques ms à une dizaine de ms), absorbée par l'accumulateur. Le nombre de ticks par image est donc variable (0, 1 ou plusieurs) ; `004841c4` compte les ticks depuis la dernière image (remis à 0 par `gm_start_level`) et sert à des conditions de parité (`& 1`) dans `FUN_0043c234`.
- Pas de limiteur de rendu : `gm_frame` redessine à chaque tour. `gm_delay_ms` (attente active `GetTickCount`) n'est pas dans la boucle.
- Fenêtre inactive : `gm_poll_events` bloque sur `GetMessage` tant que `00480ab0 == 0` (le jeu est figé, pas de rattrapage grâce au plafond de 800 ms).

### Estimation de la cadence d'image (pour le lissage de la caméra) [confirmé]

`FUN_0042a084` (mise à jour des objets, une fois par tick) : toutes les `0x78 + 1` = 121 ticks (≈ 3 s), `00481190 = max(5, images_comptées / 3)` (images par seconde, entier) où `00481188` compte les appels de `gm_frame` (`00481188++` en fin de rendu) ; `00480c60 = 3000 / images_comptées` (ms par image, en flottant). Valeur initiale de `00481190` : 14. La caméra s'en sert (§4).

### Ordre d'une image `gm_frame` `0042f64c` [confirmé]

Drapeaux de EAX : 1 = touches de debug/système, 2 = HUD, 4 = présentation. Dans le niveau : 7.

1. `gm_sounds_update_3d` pour chaque vue active (4 vues max, 0x1a dwords chacune à `00480e74` ; le jeu solo n'utilise que la vue 0).
2. (palette/brouillard) `FUN_0042fd8c` (rendu logiciel).
3. `gm_render_view` pour chaque vue active (terrain, objets, sprites, §4).
4. `(*DAT_005bc1d4)()` : présentation (changement de page).
5. Superposition radar `gm_draw_overlay_sw` si `00480c5c` et drapeau 2 ; puis `gm_draw_hud` par vue (drapeau 2).
6. Touches caméra/affichage (voir §5.5), pause, menus F1/F11/F12 (drapeau 1, seulement si `005b0414 == 0`).
7. `FUN_00422eac`, `FUN_00424454` (textes/bandeaux), boucle des « sprites » `FUN_004359c8`, puis `FUN_0042ff5c` (palette) si drapeau 4. `00481044++` (compteur d'images).

## 2. Monde, unités, objets

### Unités [confirmé]

- **Monde** : « unité » = 1 unité de monde ; **une cellule de terrain = 64 unités** ; la carte fait 512 × 512 cellules (`SLV 100`), soit **32 768 unités de côté, tore** (positions modulo 32 768).
- **Positions et vitesses d'objet en virgule fixe Q8** (1 unité = 256) : `x`, `y` (hauteur, vers le haut), `z` aux offsets `+0x1c/+0x20/+0x24`, vitesses `+0x28/+0x2c/+0x30` (Q8 par tick). Période du tore en Q8 : `2^23 = 8 388 608`.
- **Angles** : 512 par tour (1 unité d'angle = 0,703125°). Tables de 512 `int16` : `sin` à `00483188`, `cos` à `00483988`, valeurs `round(256·sin(2πi/512))` (Q8, ±256). Le code lit `*(int*)(0x483186 + i·2) >> 16`, c'est-à-dire l'`int16` de `0x483188 + 2i`. Conventions : le cap `yaw` fait avancer en `(sin yaw, cos yaw)` ; `x` à droite, `z` devant pour `yaw = 0` (repère main gauche). `yaw` croissant tourne à droite.
- **Hauteur du terrain** `gm_terrain_height` `004256c0` (EAX = x Q8, EDX = z Q8, retour Q8) : cellule `(x >> 14) & 0x1ff`, fraction `(x >> 6) & 0xff` ; octet de la carte × `0x400` aux 4 coins, interpolation bilinéaire en 8 bits. **Un octet de hauteur = 4 unités de monde** (hauteur max 255 × 4 = 1020). `gm_terrain_height_water` `00425c94` (même sig.) : si le drapeau de mission `00577670 & 2` est posé, utilise en plus la carte `SLV 102` (type de sol, `00577664`) et ajoute une ondulation animée `tableau[...] × 0x100` aux cases dont `(octet 102 & 0xe0) == 0` ; sinon `00577664 = 0xff`.
- **Hachage spatial** : les objets sont rangés dans une grille de 64 × 64 cellules (`0056b2d8`), cellule de hachage = `(x >> 17) & 0x3f`, `(z >> 17) & 0x3f` (512 unités = 8 cellules de terrain). À chaque tick, après `pos += vel` et l'appel de la fonction `+0x68`, la position est **ramenée dans le tore** (`x &= 0x7fffff`, `z &= 0x7fffff`, par masquage des mots hauts `+0x1e`/`+0x26` avec `0x7f`) puis l'objet est reclassé dans sa cellule [confirmé, `0042a084`].
- **Fenêtre de simulation** : par joueur, 11 × 11 cellules de hachage autour de lui (±5 cellules = ±2 560 unités) ; table `00480c90` (disque) : 0 = simulé complètement (`pos += vel`, `+0x68`, collisions), 1 = reclassé seulement, 2 = figé.

### Tick de logique `FUN_0043c234` [confirmé]

Dans l'ordre : `004841c4++`, `005b0404++` (temps de mission en ticks) ; `FUN_0042a084` (solo) ou `FUN_0042a940` (réseau) = mise à jour des objets (ci-dessus) ; `FUN_0042fc70` (`gm_ground_flash_fade` : décrémente de 0x1e les 4 096 cases de la carte d'éclairs au sol `005624c8`, plancher 0, `render.md` §6.1) ; si `005b03e8 >= 0` : `++` (chrono de fin) ; puis **pour chaque joueur** (liste `005af3ac`, suivant en `+0x104`, sauf drapeau `+6 & 0x40`) : fonction pilote `(*(P+0xa8))()` (lit les entrées, §3), `FUN_00459c80` (armes), gestion des fins de mission (`005b0414`, `005b03e8`), `FUN_00438198` (re-visée, §3.8), placement des objets accrochés (`+0x1f8..0x210`, positions relatives au cap : ±`0x40`, ±`0x78`, ±`0x8c`, ±`0xbe` unités de côté), jauge de PV, puis la liste des déformations du terrain `00587704` (durée `+0x0c` décrémentée, nœuds échus rendus à la réserve `00587714`, `render.md` §10).

La jauge de PV (`+0x118`, 0..0x1f) suit `clamp(PV >> 5, 0, 0x1f)` d'un cran tous les deux ticks (si > 0xf : +0xc), avec les sons `0xfa1` aux franchissements 0x10 et 0x1a.

## 3. Le joueur

### 3.1 Structure [confirmé / probable]

Le joueur est un **objet de 0x228 octets** (20 emplacements à `005a936c`, pointeur du joueur local `005af3c4`, liste `005af3ac`) dont les **0x70 premiers octets sont la structure d'objet commune** (`gm_object_init`). Offsets établis :

| Offset | Contenu |
|---|---|
| `+0x04` | drapeaux (u32). Forme 990 : `0x217`, forme 991 : `0x207`, mort : `0x40` |
| `+0x08` | points de vie (`gm_object_init` : EBX ; init par `FUN_0043cab4` depuis `[004841c0]+0x3c`) |
| `+0x14` | compteur décrémenté à chaque tick (temporisation) |
| `+0x18` | compteur de re-visée (§3.8) |
| `+0x1c/+0x20/+0x24` | position x, y (haut), z, Q8 |
| `+0x28/+0x2c/+0x30` | vitesse vx, vy, vz, Q8/tick |
| `+0x34/+0x38/+0x3c` | cap (yaw), tangage (pitch), roulis (roll), unités d'angle (512/tour) |
| `+0x4c` | type : **990** (`0x3de`, hélicoptère) ou **991** (`0x3df`, véhicule) ; `0x3d4` (980) pour la forme 5 ; 0 quand mort |
| `+0x50` | variable d'état de forme : véhicules (1 = frein ; 0, 2, 3 = modes de tangage), minuterie de la séquence de mort |
| `+0x58` | cible verrouillée (pointeur objet, ou lui-même = aucune) |
| `+0x5c` | propriétaire (lui-même) |
| `+0x68` | fonction d'objet (la **physique**), appelée par la boucle d'objets après `pos += vel` |
| `+0x74/+0x78` | poussée (véhicules) / vitesse de roue (décroît de 13/16) |
| `+0x94` | cap du tick précédent |
| `+0x98` | compteur de ticks |
| `+0xa0` | état de la touche de tir principal (maintenue) |
| `+0xa4` | **forme courante** (0..5, `0x2a`, `0x2b`, `0x63`), voir §3.2 |
| `+0xa8` | **fonction pilote** : lit les entrées, appelée par `FUN_0043c234` |
| `+0xb0/+0xb4` | braquage courant / cible des roues (véhicules) |
| `+0xb8 … +0xe0` | **11 codes de touche** (index dans `00490010`) : §5 |
| `+0xe4/+0xe8/+0xec`, `+0xf0/+0xf4/+0xfc` | axes X/Y/Z et liaisons reçus du réseau (joueur distant) |
| `+0x104` | joueur suivant dans la liste |
| `+0x114` | = 500 à la création |
| `+0x118` | jauge de PV affichée |
| `+0x120` | arme courante (−1 = aucune) ; `+0x128..0x174` : possession/munitions des 20 armes ; `+0x178` : déclencheur spécial |
| `+0x190` | valeur recalculée chaque tick à partir de la vitesse (`+0x2710 + vy/2 + v²/2^14`) : **hypothèse** (fréquence du son moteur) |
| `+0x1a8..0x1b4` | objets enfants (roues, type `0x3d4`/`0x3d7`) des formes 1, 2 (§3.6) |
| `+0x1b8` | 1 = joueur piloté par le réseau |
| `+0x214/+0x218/+0x21c` | **accumulateurs d'angle** du pilote hélicoptère : cap Q8, tangage Q8, roulis Q7 |
| `+0x224` | molette (variante réseau) |

### 3.2 Formes (`FUN_0043de0c`, changement de forme) [confirmé / hypothèse]

`+0xa4` = forme. À chaque changement : on arrête la boucle sonore précédente, on pose `+0x4c` (type), `+0x04` (drapeaux), `+0xa8` (fonction pilote), `+0x68` (physique), on crée les enfants et on lance la boucle sonore.

| Forme | Type | Fonction pilote `+0xa8` | Physique `+0x68` | Son en boucle | Rôle |
|---|---|---|---|---|---|
| 0 | 990 | `00439088` (`00439670` si réseau) | `00449aa8` → `FUN_00444af8(obj, 0x50)` | 5000 | **hélicoptère** (forme de départ) |
| 1 | 991 | `0043a174` | `00445228` | 5001 | buggy : 4 roues enfants `0x3d4` (§3.6) ; `+0x190 = 11000` à la création |
| 2 | 991 | `0043a760` | `00445670` | 5001 | motoneige : 2 roues `0x3d4` + ski `0x3d7` ; l'arrière s'enfonce de 2 000 dans l'eau |
| 3 | 990 | `00439bcc` | `00449ad0` → `FUN_00444af8(obj, 0x50)` | 5002 | hélicoptère, même pilotage que la forme 0 (molette lue dans `+0x224`) |
| 4 | 991 | `0043ac64` | `00445a84` | 5001 | véhicule nerveux (poussée 210 par touche, frottement 61/64, gravité 120, pas de roues) |
| 5 | 980 (`0x3d4`) | `0043b0ac` | `00445f44` | 5002 | aéroglisseur : modèle 980 à terre, 982 (`0x3d6`) sur l'eau, ne souffre pas de l'eau |
| `0x2a` | 990 | `00438678` (vide) | `00449af8` | | **pilote de démonstration** (départ de type 1001, `DEMO.SLV`), voir §3.10 |
| `0x2b` | 990 | `00438744` | `00449bc8` | 5002 | séquence de mort / fin (démarrage de type 1002) |
| `0x63` (99) | 0 | `00438678` (vide) | `00441630` | | joueur réseau inactif |

Déclencheurs : la forme initiale vient de `[004841c0]+0x38` (variable de mission) ; les passages 0 → 1/2/4/5 et le retour à 0 sont faits **par des objets bonus/boîtes** (fonctions `004484xx`, `004492xx`, `00449854` → `FUN_0043de0c(joueur, n)`), et par le menu de triche `gm_menu_pickups`. À documenter avec R2/R3.

La forme 990 est dessinée avec le modèle 10990 (hélice : face de type 1, disque de rotor), la forme 991 avec 10991 (voir `models.md`).

### 3.3 Entrées → intentions : l'hélicoptère (formes 0 et 3) [confirmé]

Fonction pilote `00439088`, une fois par tick. Trois variables globales d'intention, remises à 0 au début du tick : `dCap = 004841d4`, `dTangage = 004841d8`, `dRoulis = 004841dc`. `T` = type du contrôleur (`004841a4`, §5) ; les axes `ax(i)` sont `005b0434` (X), `005b0438` (Y), `005b0430` (Z) ; un « axe lié » vaut 0 (aucun), 1 (X), 2 (Y), 3 (Z) :

```
axeTourner = 00484188, axeAvancer = 0048418c, axeLatéral = 00484190   // octets +0x3c/+0x3d/+0x3e du profil
// avancer / reculer
si T > 1 et axeAvancer != 0 :  dTangage += ax(axeAvancer) * 10
sinon : si touche[avancer] dTangage += 0x4b0 ; si touche[reculer] dTangage -= 0x4b0     // 1200
// si « Strafe On » (touche[freinLatéral] ou touche+0xe0) est enfoncée :
si touche[+0xe0] :
    si T > 1 et axeTourner != 0 : dRoulis += ax(axeTourner) * 7
    sinon : si touche[tournerG] dRoulis -= 0x320 ; si touche[tournerD] dRoulis += 0x320    // 800
// sinon : virage
sinon :
    si T > 1 et axeLatéral != 0 : dRoulis += ax(axeLatéral) * 7
    sinon : si touche[latéralG] dRoulis -= 0x320 ; si touche[latéralD] dRoulis += 0x320
    si T > 1 et axeTourner != 0 :
        dCap += ax(axeTourner) << 3 ; dRoulis += ax(axeTourner) * 0x320 >> 8
    sinon :
        si touche[tournerG] { dCap -= 0x258 ; dRoulis -= 0xc8 }      // 600, 200 : le virage penche l'appareil
        si touche[tournerD] { dCap += 0x258 ; dRoulis += 0xc8 }
```

Les boutons : touches `2..11` (`0x490018 + 4i`, chiffres 1 à 0) → `FUN_004582dc(P, i)` (sélection directe de l'arme `i`, la touche est effacée) ; touche « Select Up » (`+0xd8`) → `FUN_004582dc(P, -1)` (suivante), « Select Down » (`+0xdc`) → `(-2)` (précédente), touches effacées après usage ; molette `004841b8` (cumulée par `WM_MOUSEWHEEL`/message « MSWHEEL_ROLLMSG », pas de 120) : `<= -120` → `+= 120` et arme suivante, `>= 120` → `-= 120` et arme précédente ; tir spécial (`+0xd4`) → `FUN_00458590` (passe `+0x178` de 10 à 11) ; tir principal (`+0xd0`) → `FUN_0046b6fc` (6,8 Ko, armes : R3) et `+0xa0 = état de la touche` ; `+0x94 = cap`. **Assistance en altitude** : si la cible `+0x58` n'est pas soi-même et `P.y < cible.y` alors `P.y += 100` (Q8, 0,39 unité par tick).

Intégration (même tick) :

```
acc.cap     += dCap                       // +0x214 : Q8
acc.tangage -= dTangage                   // +0x218 : Q8  (« avancer » rend le tangage négatif)
acc.roulis  += dRoulis                    // +0x21c : Q7
P.cap = acc.cap >> 8 ; P.tangage = acc.tangage >> 8 ; P.roulis = acc.roulis >> 7
acc.tangage = (acc.tangage * 14) >> 4 ; acc.roulis = (acc.roulis * 14) >> 4      // amortissement 14/16 par tick (dCap n'est pas intégré avec amortissement : le cap s'accumule)
si P.y > plafond (005b03cc, 0x7ffffff8 par défaut) : P.y = plafond ; si vy > 0 : vy = 0
P.+0x190 = 0x2710 + (vy >> 1) + ((vx*vx + vz*vz) >> 14)
si cible.y - P.y > 0x3a98 (15 000 Q8 = 58,6 unités) : vy = (vy*14 >> 4) + 40     // aide à la montée
```

La réinitialisation des accumulateurs au changement de forme : `+0x214 = cap << 8`, `+0x218 = tangage << 8`, `+0x21c = roulis << 7`.

**Valeurs d'équilibre [calculé]** : avec la touche « avancer » tenue, `acc.tangage → -9 600` soit tangage `-36`/`-37` unités (≈ −26°) ; touche de côté : roulis `+45` unités (≈ 32°) ; virage clavier : cap `+600/256 = 2,34` unités par tick, soit **66°/s**, roulis ±8,8°. Avec un axe (souris, ±190 ; manette, ±128) : cap `ax·8/256` unités/tick (souris pleine course 5,9 unités/tick = 167°/s), tangage cible proportionnel à `ax·10`.

### 3.4 Physique de l'hélicoptère `FUN_00444af8(obj, hauteur=0x50)` [confirmé]

Appelée par la boucle d'objets **après** `x += vx ; y += vy ; z += vz` (vitesses Q8), puis la position est ramenée dans le tore. `P.tangage` et `P.roulis` sont ceux écrits par le pilote ce tick-ci.

```
si P.roulis  < 0 : P.roulis  += 4 ; si P.roulis  > 0 : P.roulis  -= 4     // recentrage de la copie
si P.tangage < 0 : P.tangage += 2 ; si P.tangage > 0 : P.tangage -= 2
si P.+0x14 > 0 : P.+0x14--
// poussée : le tangage et le roulis sont à la fois attitude et commande
si P.tangage != 0 : vx -= (SIN[cap] * P.tangage) >> 5 ; vz -= (COS[cap] * P.tangage) >> 5
si P.roulis  != 0 : vx += (SIN[cap+0x80] * P.roulis) >> 6 ; vz += (COS[cap+0x80] * P.roulis) >> 6
// altitude : se placer à 80 unités au-dessus du plus haut du terrain sous soi et à 32 ticks de vitesse devant
h = max(hauteur(x, z), hauteur(x + vx*32, z + vz*32)) >> 8        // unités
e = h + 0x50 - (P.y >> 8)
si e > 0 : vy += 2*e ; si e < 0 : vy += e >> 1
// frottement : v -= (v >> 4)  (ou v entier si v >> 4 == 0), pour vx, vy, vz
si P.y - 2000 <= hauteur(x, z) :            // 2 000 Q8 = 7,8 unités : contact avec le sol
    parmi 16 directions k (angle 32k), choisir celle où hauteur(x + SIN[32k], z + COS[32k]) est minimale
    vx = SIN[32k] << 4 ; vz = COS[32k] << 4 ; vy = 1000
    PV -= 10 (plancher 0) ; objet « poussière » 0x2afb ; son 0x3e9 ; FUN_00443ed0
```

Conséquences **[calculé]** (simulation du pilote + de cette fonction, sol plat) : vitesse d'équilibre avant **4 320 Q8/tick = 16,9 unités/tick = 675 unités/s** (≈ 10,5 cellules/s), constante de temps ≈ 16 ticks (0,4 s) ; vitesse de côté **2 700 Q8/tick = 10,5 u/tick = 422 u/s** ; un tour du tore (32 768 unités) en ≈ 48 s. L'altitude suit un ressort amorti (ω² = 2/256 par tick², frottement 1/16, ζ ≈ 0,35 : légères oscillations). Aucune gravité explicite : le maintien en altitude est asservi au terrain.

Altitude minimale : consigne = **80 unités** au-dessus du relief ; le relief situé 32 ticks de vitesse devant est anticipé, mais `P.y - 2000 <= hauteur` déclenche le choc (rebond vers l'aval, 10 PV).

### 3.5 Pilotes des véhicules (formes 1, 2, 4, 5) [confirmé, porté]

`0043a174`, `0043a760`, `0043ac64`, `0043b0ac`. Variables : `+0x74` poussée, `+0x34` cap, `+0xb4/+0xb0` braquage cible/courant, `+0x50` frein (1 = un tick).

```
si état == 1 : état = 0 ; braquage cible = 0
virage : axe (T > 1) cap += ax*10 >> 8, cible += ax*100 >> 8 ; sinon gauche : cap -= 4, cible = -40 ; droite : cap += 4, cible = +40
poussée : axe : += ax*0x104 >> 8 ; sinon avancer += pas, reculer -= pas (pas 0x82 ; forme 4 : 0xd2)
frein (clavier) : avancer+reculer, ou « frein », ou « latéral gauche » (formes 1, 4, 5 ; pas la 2) → état = 1
frein (axe) : « frein » si état == 0 (forme 2 : toujours)
puis, APRÈS les armes, si état != 1 : avancer += pas, reculer -= pas   // une touche tenue vaut donc 2 pas (0x104) sans frein
+0x94 = cap tant que « latéral droit » n'est pas tenu (cap de tir des projectiles)
formes 1, 2 : si vx*SIN[cap] + COS[cap]*vz < -7000 (marche arrière) : cible = -cible ; puis b0 → b4 par pas de 4 ; roues enfants (§3.6)
```

Le doc d'origine (R1) comptait un seul pas de poussée : corrigé, la lecture de la décompilation en montre deux. Les formes 4 et 5 n'ont ni braquage ni roues.

### 3.6 Suspension et physique des véhicules [confirmé, porté]

**`00443510(obj, 1000, forme)`** : 4 contacts (coins `(±5120, ±7680)` Q8, ordre AG, AD, RG, RD ; avant = +z), à la hauteur de pied du modèle (`+0x10`), tournés par tangage puis roulis puis cap (sinus/cosinus de l'angle **opposé**), `w[i] = y_monde − hauteur_terrain_eau`. `+2000` si type de sol < 4 pour la forme 1 (4 coins) ou la forme 2 (arrière seulement : les deux **arrière**, pas les avant comme noté avant). `T = (sin cap·cos tangage, sin tangage, cos cap·cos tangage)·1000` et poussée de pente `(005b04c8, 005b04cc)` = poids **le long de l'inclinaison du corps** (`350·(−cos tangage·sin roulis >> 10, sin tangage)` tourné par le cap), non le gradient du relief. Le type de sol `00577664` est celui du **dernier** contact.

**Physique** (`00445228` forme 1 ; variantes) :

```
poussée = clamp(+0x74, ±500) (écrite) ; puis +0x78 = +0x78·13>>4 ; +0x74 = +0x74·15>>4 ; +0x78 = +0x78·13>>4
h = min(1000, w0..w3)
si h < 1000 (au sol) :
  frein : (vx,vz)·14/16 (4, 5 : 15/16), +0x74 = 0 ; sinon ·15/16 (forme 4 : ·0x3d>>6 ; forme 5 : ·0x3c>>6)
  roulis += (w3+w1 − w2−w0) >> 9 ; si état == 3 : 0 ; si état != 2 : tangage += (w2+w3 − w0−w1) >> 9
  sol sec (type >= 4) / eau (< 4) ; « pente » = si état ∉ {1,2} : v += pente >> s ; « pousse » : v += +0x74·T >> s   (la poussée UTILISÉE est celle après frottement)
     forme 1 : sec  pente 8, pousse 11 ; eau  pente 10, pousse 13, pv −1
     forme 2 : sec  pente 8, pousse 11 ; eau  pas de pente, pousse 13, pv −1
     forme 4 : sec  pente 9, pousse 11 ; eau  pente 11, pousse 13, pv −2
     forme 5 : sec  pente 9, pousse 12, modèle 980 ; eau  pente 11, pousse 11, modèle 982, pas de dégâts
  +0x70 += +0x78 · min(10, (vx²+vz²) >> 18)
sinon en l'air : état 3 : tangage −4 si > −50 ; formes 1, 2 : tangage +2 si < 90 ; formes 4, 5 : tangage vers [−10, 0] par 2, roulis vers 0 par 1
forme 4 : v += +0x74·T >> 16 (toujours)
vy = vy·15>>4 ; si h > 0 : vy −= gravité (150 ; 120 pour 4, 5) ; si h < 0 : sons 0xfaa/0xfab (vy < −1100 / −1900), vy = max(vy, 0), y −= h
+0x190 += min(100, (v² >> 10) + 7000 − +0x190) (×2 formes 4, 5 ; plafonds 20500 → 15000, 41000 → 35000)
```

Aucun garde-fou d'angle dans l'exe (l'ancien `±128` du port est supprimé). **Vitesses mesurées dans le port** (sol plat, poussée tenue) : forme 1 : 3 650 Q8/tick (14,3 u/tick ; le doc d'origine annonçait ≈ 3 400, calculé avec une poussée non amortie) ; forme 4 : 4 990 (19,5) ; forme 5 : 1 810 (7,1), 3 640 sur l'eau ; sur eau la forme 1 tombe à 920. Rampe : la forme 1 passe de 3 280 (pente 0,06) à 1 460 (0,38), 800 (0,5), cale vers 0,6 ; la forme 4 monte encore à 0,75.

Hauteur et type de sol : `gm_terrain_height_water` (`sampleGround`) avec `00577670 & 2` (script : 3 dans TERRAN00-03, donc `water` vaut `true` par défaut dans `World`) : type = octet de la carte 102, coins d'eau relevés de `WAVE[(cz·4 + temps + SIN[(cx&31)·16]) & 31]·256`, `temps` = ticks (`00481154`).

**Roues enfants des formes 1 et 2** [confirmé, porté : `wheels.ts`] : décor sans effet sur la physique.

- **Création** (`0043de0c`) : objets clonés sur le joueur (classe `0x40`, pv 0, comportement vide `004450a8`), rangés en `+0x1a8…+0x1b4`, emplacement dans `+0x50`. Forme 1 : 4 roues `0x3d4` (980) aux emplacements 0-3 si le monde `004841b0` < 2, 7-10 sinon ; forme 2 : roues `0x3d4` 4, 5 et ski `0x3d7` (983) 6. Quitter la forme 1 ou 2 les efface (`+4 = 0`). Le monde est déduit du nom du niveau dans le port (seuls TERRAN00-03 sont livrés).
- **Emplacements** (table `00484324`, 16 octets : latéral, vertical, avant en Q8, 4ᵉ champ non lu) : 0-3 `(±4800, −1500, +3000 / −3000)` ; 4-5 `(±4800, −1500, −3000)` ; 6 `(0, −1500, +6000)` ; 7-10 `(±5000, −1500, +6000)` et `(±6200, −1500, −4000)` (voie plus large sur la Lune et Mars). L'ancien doc y voyait des « textures » : ce sont des indices d'emplacement.
- **`gm_wheel_update` (`004446a0`, roue, mode)**, à la fin de la fonction pilote, avec `004841bc = braquage +0xb0` :

```
vitesse = celle du joueur ; position = joueur + emplacement tourné par tangage, roulis, cap (FUN_004418b0 = gm_attach_offset)
h = hauteur_eau(x, z) ; si y <= h + 4000 : y = h + 2000          # roue relevée au-dessus du sol
cap = cap du joueur ; roulis = roulis du joueur
mode 2 (ski) : tangage = tangage du joueur ; cap += braquage ; modèle 0x3d7 ; fin
si type de sol < 4 (eau) et y − (h + 1500) < 2000 : y = h ; modèle 0x3d6 ; tangage = 0 ; modes 3, 4 : cap += braquage
sinon :
  modes 0, 3, 4 : tangage −= (SIN[cap]·vx + COS[cap]·vz) >> 13      # rotation selon la vitesse le long du cap
  mode 1 : tangage = tangage du joueur
  y = (cap & 511) + 1500 < y ? y − 1500 : cap & 511             # bogue de l'exe : la variable du sol est réutilisée pour le cap
  modèle 0x3d4 ; mode 3 : cap += braquage ; mode 4 : cap −= braquage >> 1
```

- **Appelants** : forme 1 (`0043a174`) modes 3, 3, 4, 4 ; forme 2 (`0043a760`) modes 1, 1, 2 ; pilote coupé `gm_pilot_wheels` (`00438694`, amarrage au sol par `004482dc`, Super Ressort des formes 1 et 2 par `0045e128`) : braquage vers la cible par pas de **8**, modes 3, 3, 4, 4 sur les **4** pointeurs (la motoneige y passe son ski en roue `0x3d4` et l'exe écrit un 4ᵉ pointeur resté de la forme 1 : ignoré dans le port) ; variante `00438c68` (modes 1, 1, 2, installée par `004495f8`, non porté) ; fins de niveau `00438ec8` / `00438fb8` (non portées). Le pilote de la forme 1 fait en plus tourner les roues arrière à chaque pas de poussée : touche avancer `−13` sur `+0x1b0` et `+0x1b4` (reculer `+13`), deux fois sans frein ; axe : `−axe·30 >> 8` sur `+0x1b0` seule.
- **Mort** (`0043b4f4`, formes 1 et 2) : après les explosions et les éclats du joueur, chaque roue devient un gros éclat (`0044412c`), vitesse `(x, |y|, z)·9` de la table pseudo-aléatoire, cap = `x` du tirage suivant, modèle `0x3d4`.
- Rendu : 980 et 982 sont dans les `.SLV` livrés (blocs 10980, 10982) ; **983 (ski) n'est ni dans les `.SLV` ni dans `GLOBAL.BD`** : le port ne dessine pas le ski (aucune mission livrée ne donne la motoneige) ; ce que fait l'exe d'un modèle absent n'est pas lu.

### 3.7 Collisions et dégâts [confirmé]

- **Terrain** : l'hélicoptère rebondit et perd 10 PV (§3.4). Les véhicules sont posés par les 4 contacts (§3.6) ; PV −1 par tick quand le type de sol `00577664` est < 4 (−2 pour la forme 4, 0 pour la forme 5) : ce sont les cases d'eau de la carte 102 [confirmé par le code].
- **Objets** (`FUN_0042a084`, cellules à l'état 0 seulement, hors réseau) : pour chaque paire (A, B) dont l'un a le drapeau `+4 & 2`, ni B fantôme (`+4 & 0x40`) ni liés par `+0x5c`, `d² = Σ((Δ >> 8)²)` en unités ; **collision si `d² <= rayon²(A) + rayon²(B)`** avec `rayon² = bloc de modèle +0xc` (100 si type 0 ou ≥ 10 000, `FUN_0042a010`). Normale : `FUN_00415374` (normalise `Δ >> 4`). Si les deux n'ont que le drapeau 2 (physique pure) : poussée `v += ∓4·n`. Sinon : dégâts **`min(PV_A, PV_B, 100)` retirés aux deux** (sauf drapeau `+6 & 4` « invulnérable »), drapeaux `+6 |= 0x102` (« touché »), `+0x58` = propriétaire de l'autre, recul `v += ∓8·n`.
- **Mort** : voir `FUN_0043c234` : forme `0x2b`/`0x2a` après la séquence `00438744` (chrono `+0x50` jusqu'à 0x3e8 ; objets 0xe1 explosion à chaque tick entre 0xaa et 0x258, caméra figée à 0x17c, etc.). Détails à fusionner avec R3.

### 3.8 Re-visée (cible verrouillée) `FUN_00438198` [probable]

Pour l'hélicoptère et les véhicules : tous les `n` ticks (`n` = 60 si `(vx>>8)²+(vz>>8)² < 30`, 35 si < 140, sinon 7, compteur `+0x18` ; le compteur est remis à 0 à chaque re-visée), choisit parmi les objets de la liste ennemie (`FUN_0042af88(3, 0)`) celui qui maximise `cap·Δ + biais` avec `cap = (sin yaw, cos yaw)` (Q8), `Δ` en unités, biais +4 000 (octet `+5 & 0x10`), −6 000 (`+4 & 8`), −4 000 (`+5 & 0x40`), 0 sinon, seuil initial 50 000. Résultat dans `+0x58`.

### 3.9 Apparition [confirmé]

`gm_level_spawn_objects` `0043e958` : l'objet de type **1000** du bloc 105 `(1000, x, z, cap)` crée le joueur solo (1001, 1002 : variantes de départ `0x2a`/`0x2b`) avec `gm_object_init(0, 0, mode 0, x, 0x50, z, cap…)` : `x`, `z` en unités (`<< 8`), `y = hauteur_terrain + 0x50 × 256` (80 unités au-dessus du sol), cap en unités d'angle ; puis `FUN_0043cab4` (PV, armes, touches copiées de `profil[4..14]`), forme initiale, et la vue 0 reçoit `00480e7c = 0`, `00480e80 = 0`, `00480e84 = 0x1e`, `00480e88 = 0x226`. TERRAN00 : départ `(12159, 29373)` cap 248 ; TERRAN01 `(30804, 20028)` cap 424 ; TERRAN02 `(3963, 10467)` cap 72 ; TERRAN03 `(11121, 16469)` cap 208 ; DEMO : type 1001 `(15747, 20469)` cap 424. Plafond de vol : `005b03cc = 0x7ffffff8` (aucun) sauf objet de type `0x1edc` (hauteur du terrain à son emplacement, `0043e958` / `00440e71`).

### 3.10 Pilote de démonstration (forme `0x2a`, `00449af8`) [confirmé, porté]

Le choix n'a rien d'implicite : `gm_level_spawn_objects` crée le joueur du type 1001 avec `gm_player_set_form(0x2a)` (type 1000 : forme du profil ; 1002 : `0x2b`). Sa « fonction pilote » est vide (`gm_pilot_none`), le mouvement est dans la physique `+0x68 = 00449af8` (`demo-pilot.ts`) :

```
si +0x40 == -1 : gm_node_claim_air                     // nœud aérien libre le plus proche
gm_heli_physics(obj, 0x50)                             // vol à 80 unités du relief
gm_aircraft_turn_to_point(obj, 0x19, x_nœud, z_nœud)   // bascule bornée à 25, cap par secteurs
si (Δx² + Δz²) < 10000 (unités) : FUN_00442c90          // nœud suivant
```
`FUN_00442c90` prend le **dernier** lien non vide du nœud courant, efface dans ce nœud les liens qui reviennent vers l'ancien (le circuit ne se parcourt que dans un sens), rend l'ancien nœud (capacité aérienne +1) et réserve le nouveau. Sur `DEMO.SLV` l'appareil boucle en ≈ 2 200 ticks à ≈ 2 900 Q8/tick, tangage ≈ −25, sans dégât ; les entrées sont ignorées.

## 4. Caméra

### Vue [confirmé]

Une vue = 0x1a dwords à `00480e74 + 0x68·n` ; `V[0]` = joueur suivi. Champs utiles : `V[1]` dernier joueur suivi, `V[2]` (`00480e7c`) drapeau « caméra figée », `V[3]` (`00480e80`) décalage de cap de la caméra, `V[4]` (`00480e84`) **angle de site** (unités d'angle, bornes 15..100, défaut **30** = 21,1°), `V[5]` (`00480e88`) **distance** (bornes 200..800, défaut **550** unités), `V[6..8]` point visé lissé, `V[10..12]` position de l'œil lissée, `V[13]` roulis lissé (flottants).

Cible instantanée (chaque image, `gm_render_view` `0042b31c`) :

```
cible.x = (P.x >> 8) + (SIN[P.cap] >> 1)          // 128 unités devant le joueur (horizontalement)
cible.y = P.y >> 8
cible.z = (P.z >> 8) + (COS[P.cap] >> 1)
V4 = clamp(V[4], 15, 100) ; V5 = clamp(V[5], 200, 800)
rayonH = (COS[V4] * V5) >> 8 ; a = (P.cap + V[3]) & 0x1ff
œil.x = cible.x - ((SIN[a] * rayonH) >> 8)
œil.y = cible.y + ((SIN[V4] * V5) >> 8)            // 198 unités au-dessus pour 30/550
œil.z = cible.z - ((COS[a] * rayonH) >> 8)
si liste 00587704 non vide : œil.y += 900 (0x480388) et recule une 2e fois de rayonH      // « plan large » des événements (hypothèse)
// garde-sol : œil.y >= max(hauteur_terrain en 5 points : œil et œil ± 30 000 Q8 en x et en z) / 256 + 120
roulis cible = clamp(-P.roulis * 0.013333, -0.5, 0.5)                              // flottant, pas des unités d'angle
```

Points à retenir : l'œil est **derrière et au-dessus** (≈ 508 unités derrière, 198 au-dessus pour les valeurs par défaut), regarde un point 128 unités devant l'appareil ; l'altitude de l'œil ne descend jamais sous 120 unités au-dessus du plus haut terrain environnant.

### Lissage (une fois par **image**, pas par tick) [confirmé]

`k = max(1, fps / 4)` (division entière par 4 de `00481190`, §1) :

```
V[6..8]  += (cible - V[6..8]) / k          // point visé
si V[2] == 0 : V[10..12] += (œilCible - V[10..12]) / k           // position
sinon (caméra figée) : on ne touche pas à l'œil ; V[2] = 0 si dist²(œil, joueur) > 3 500 000 (≈ 1 870 unités)
V[13]    += (rouliscible - V[13]) / fps    // roulis plus lent
```

Soit un lissage exponentiel de constante de temps ≈ 0,25 s (position, point visé) et ≈ 1 s (roulis), indépendante de la cadence. Les coordonnées lissées sont recalées modulo 32 768 (boucles `while` sur ±20 000 / ±32 768, constantes `00480398…004803d4`) pour suivre le tore. `V[13]` est borné à ±0,5. Quand la vue vient de changer de joueur (`V[1] != P`), tout est copié sans lissage.

Figement : `V[2] = 1` quand `+0x50 == 0x17c` pendant la séquence de mort, et par F4 (§5.5). Réinitialisé à 0 à chaque apparition.

### Projection [confirmé pour les constantes citées]

- Cadre logique : **320 × 400** (colonnes 0..319, lignes 0..399, mode X double ligne) à pleine taille ; la fenêtre se rétrécit avec « Screen Size » `00480c88` (255 = plein) : `gauche = 0x9f - ((c88 + 0x40) >> 1)`, `haut = 199 - (((c88 + 0x40) * 0xa0) >> 8)` (lignes doublées). Largeur `0048103c = droite - gauche` ; focale verticale `00577614 = largeur * 5 / 3` (pixels non carrés) ; zoom `(0x20 + 00480c78 [0x60]) * largeur >> 7` = la largeur pour 0x60.
- **Division perspective par `profondeur + 0x19`** (profondeur de vue en unités, `>> 8` de la coordonnée Q8 ; 25 unités de recul) : `xÉcran = centreX + (X·r0) / (profondeur + 25)` (voir `models.md`, `render.md` pour la suite).
- **Distance d'affichage des objets** : `gm_render_terrain` `0042718c` ne parcourt que les **7 × 7 cellules de hachage** (512 unités chacune) centrées sur la cellule du joueur suivi (±3 cellules : 1 536 à 2 048 unités) et ne dessine l'objet que si `-10 < profondeur < 2000` unités et s'il tombe dans le cadre (marge 0x14/0x1e pixels). Le terrain lui-même est tracé par `gm_render_view` (R4). La fenêtre de simulation (11 × 11) est plus large que la fenêtre de rendu (7 × 7).

## 5. Commandes

### 5.1 Table des touches et types de contrôleur [confirmé]

- **Table d'états `00490010[256]` (u32)**, indexée par **code de balayage PC (set 1)** : `index = (lParam >> 16 & 0x7f) + (lParam >> 17 & 0x80)` (le bit « étendu » ajoute 0x80 ; `0xb8`, AltGr, est ignoré). `WM_KEYDOWN` met 1, `WM_KEYUP` met 0 (sauf `0x45`, verrouillée : jamais remise à 0 par le relâchement, c'est la **touche pause**, `00480a94 = 0x45`). Souris : bouton gauche = index `0x90`, droit `0x91`, milieu `0x92`. Manette (type 5) : bouton `n` (0..7) = index `0x93 + n`, boutons 8..15 = `0x10..0x17` (`00480acc`). `gm_clear_keys` `00410010` remet tout à 0.
- Le jeu **ne relâche pas** les touches à la perte de focus : un port navigateur doit tout remettre à 0 sur `blur`/`visibilitychange`.
- **Type de contrôleur** `004841a4` = `profil[3]` : 1 clavier, 2 souris, 3 manette de jeu, 4 Gravis Gamepad, 5 « Direct Input Device », 6 Creative Labs Blaster Gamepad (chaînes table 3 ids 11..16 de `GLOBAL.BD`). Les axes ne servent que si `T > 1` **et** l'axe correspondant est lié ; au clavier (T = 1) seules les touches comptent. Seuls les types 2 (souris) et 5 (`joyGetPosEx`) sont lus par `gm_poll_events` ; 3/4/6 : fonctions de lecture non trouvées (voir §8).
- Le profil du contrôleur est l'enregistrement `(0x14, pilote, 2)` de `swiv.cfg` (`gm_profile_record(0x14, pilote, EBX = 2)`) : `[3]` type ; `[4..14]` = 11 touches dans l'ordre `+0xb8..+0xe0` du joueur (copiées par `FUN_0043cab4` / `FUN_0043ca60`) ; `[15]` = 4 octets d'axes (voir ci-dessous). Le fichier `swiv.cfg` (ou `C:\swiv.cfg`, `swivdemo.cfg` pour la démo) = 300 enregistrements de 128 octets (`gm_cfg_load`/`gm_cfg_save`), chargé au démarrage, réécrit en quittant les menus. Les valeurs par défaut sont posées quand le type change (`FUN_004171b4` `0x4171b4`) ; au premier lancement (`+0xc == 0` ou `-1`) le menu de choix du contrôleur s'ouvre.

### 5.2 Actions et touches par défaut du clavier (type 1) [confirmé]

Ordre = ordre des 11 touches du profil (`+0x10 … +0x38`), noms de l'interface (table 3 de `GLOBAL.BD`, ids 21..32 ; en français « Bombarder » désigne en fait le déplacement latéral) :

| Offset joueur | Action (EN / FR) | Id | Code PC | Touche | `KeyboardEvent.code` |
|---|---|---|---|---|---|
| `+0xb8` | Turn ← / Tourner ← | 21 | `0xcb` | flèche gauche | `ArrowLeft` |
| `+0xbc` | Turn → / Tourner → | 22 | `0xcd` | flèche droite | `ArrowRight` |
| `+0xc0` | Move ↑ / Avancer ↑ | 24 | `0xc8` | flèche haut | `ArrowUp` |
| `+0xc4` | Move ↓ / Avancer ↓ | 25 | `0xd0` | flèche bas | `ArrowDown` |
| `+0xc8` | Strafe ← / Bombarder ← | 26 | `0x33` | virgule | `Comma` |
| `+0xcc` | Strafe → / Bombarder → | 27 | `0x34` | point | `Period` |
| `+0xd0` | Fire Primary / Arme principale | 29 | `0x39` | espace | `Space` |
| `+0xd4` | Fire Special / Arme spéciale | 30 | `0x32` | M | `KeyM` |
| `+0xd8` | Select Up / Sélectionner ↑ | 31 | `0xc9` | page précédente | `PageUp` |
| `+0xdc` | Select Down / Sélectionner ↓ | 32 | `0xd1` | page suivante | `PageDown` |
| `+0xe0` | Strafe On/Brake / Freiner | 28 | `0x1d` | Ctrl gauche | `ControlLeft` |

Comportement : **hélicoptère** : `Strafe On` + `Turn ←/→` = déplacement latéral au lieu de virer ; les touches `Strafe ←/→` se combinent à tout moment ; `Select Up` = arme suivante (`-1`), `Select Down` = précédente (`-2`). **Véhicules** : `Strafe On/Brake` freine (frottement 14/16, poussée annulée) ; `Strafe ←/→` ne font rien (la forme 1 freine avec `Strafe ←`).

Sélection directe de l'arme : touches de balayage `0x02..0x0b` (`Digit1..Digit0`) ; presser deux fois la même touche bascule sur la 2e banque (`+10`, `FUN_004582dc`) si elle est disponible pour la forme courante (masque `1 << forme` contre `004843dc`, 20 armes, `+0x120`).

### 5.3 Souris (type 2) [confirmé]

Défauts : tourner = flèches, avancer = flèches haut/bas, latéral = flèches (avec `Strafe On`), **tir principal = bouton gauche (`0x90`), tir spécial = bouton droit (`0x91`)**, sélection = PgUp/PgDn, `Strafe On` = Ctrl gauche ; octets d'axes `(1, 0, 0, 1)` : **l'axe X de la souris tourne**, rien d'autre. Molette : arme suivante/précédente (pas de 120).

Lecture (`gm_poll_events`, une fois par image) : la souris est recentrée dans la fenêtre à chaque appel (`SetCursorPos(centre = origine client + (0xa0, 0x78))` : fenêtre 320 × 240) et l'axe est une **vitesse** : `axe = clamp((curseur - centre) * 256 / dtMs, -190, 190)` (`0xbe`), `dt = timeGetTime() - précédent` ≥ 1, ignoré si `dt >= 1500` ; Y inversé (`centre.y - curseur.y`). Dans un navigateur : `Pointer Lock`, accumuler `movementX/Y` en pixels de la grille 320 × 240 depuis la dernière image : `axe = clamp(dxPx * 256 / dtMs, ±190)`.

### 5.4 Manette et joystick [confirmé]

Types 3, 4, 5 : tourner/avancer/latéral par axes, octets `(1, 2, 0, 1)` : **tourner = X, avancer = Y** (haut = avant), latéral non lié ; le 4e octet `[+0x3f]` = « Clip To Center » (`005b043c`) : à 0, une **zone morte de ±50** (sur ±128) s'applique à X, Y, Z. Normalisation (`joyGetPosEx`, `JOY_RETURNALL`, `dwFlags = 0xff`) : `X = (x - min) * 256 / (max - min) - 128` ; `Y = 128 - (y - min) * 256 / (max - min)` ; `Z = (z - min) * 256 / (max - min) - 128` (`min`/`max` `0049050c`/`00490510`, fixés par la calibration `FUN_00416b50`, valeurs communes aux trois axes). Boutons par défaut :

| Type | Tir principal | Tir spécial | Select ↑ | Select ↓ | Strafe On/Brake |
|---|---|---|---|---|---|
| 3 joystick, 5 DirectInput | bouton 1 (`0x93`) | bouton 2 (`0x94`) | `ArrowUp` (`0xc8`) | `ArrowDown` (`0xd0`) | bouton 3 (`0x95`) |
| 4 Gravis | `0x93` | `0x94` | bouton 4 (`0x96`) | `ArrowDown` | `0x95` |
| 6 Blaster | `0xf6`/`0xf7`… (codes propres, lecture non trouvée) | | | | |

Dans tous ces types, les touches de tourner/avancer/latéral par défaut restent les flèches/virgule/point (secours clavier).

### 5.5 Touches système pendant la partie [confirmé / hypothèse]

| Touche (code PC) | Effet | Source |
|---|---|---|
| `Échap` (`0x01`) | confirmation d'abandon (`gm_menu_abort`) | `gm_start_level` |
| `Pause` (`0x45`) | pause (`gm_screen_pause`, boucle bloquante) | `gm_frame` |
| `F1` (`0x3b`) | menu options en jeu (`gm_menu_setup`, puis recharge des touches) | `gm_frame` |
| `F3` / `F4` (`0x3d`/`0x3e`) | `00480c80 = 0` / `= 1` (+ `V[2] = 1`) : surimpression radar et caméra figée (**hypothèse**) | `gm_frame` |
| `F5` / `F6` (`0x3f`/`0x40`) | `V[3] += 6` / `-= 6` par image : fait tourner la caméra autour de l'appareil | `gm_frame` |
| `F7` / `F8` (`0x41`/`0x42`) | `V[4] += 6` / `-= 6` : angle de site (borné 15..100) | `gm_frame` |
| `Pavé -` / `Pavé +` (`0x4a`/`0x4e`) | « Screen Size » ∓ 5 (0..255) | `gm_frame` |
| `F11` (`0x57`) | capture d'écran (`gm_menu_screengrab`) | `gm_frame` |
| `F12` (`0x58`) | menu de bonus/triche (`gm_menu_pickups`) | `gm_frame` |

F3, F5..F8, F11 ne réagissent que si `profil(0x14, pilote, 1)[+0x28] > 0` (`*(005af3bc + 0x28) > 0` : pilote ayant terminé au moins une mission ? **hypothèse**).

### 5.6 Correspondance navigateur (touches physiques) et manette proposée

Utiliser `KeyboardEvent.code` (position physique, donc indépendant d'AZERTY/QWERTY) avec la table du §5.2 ; ajouter : `Escape` (abandon), `Pause` (pause ; `KeyP` en alias), `Digit1`..`Digit0` (armes), `F1`, `F3`..`F8`, `F11`, `F12` (comme ci-dessus), `NumpadSubtract`/`NumpadAdd` (taille d'écran). Au clavier on appelle `preventDefault()` sur les flèches, `Space`, `PageUp`, `PageDown`, `Comma`, `Period`. Alias de confort recommandés (non d'origine) : `KeyW`/`KeyA`/`KeyS`/`KeyD` physiques (ZQSD sur AZERTY) = avancer, tourner ←, reculer, tourner →.

Manette (Gamepad API, mappage `standard`) :

| Action | Proposition | Note |
|---|---|---|
| Tourner (axe) | `axes[0]` (stick gauche X) | ±1 ↔ ±128 ; zone morte d'origine 0,39 (50/128) à mettre à 0,2 |
| Avancer / reculer (axe) | `axes[1]` stick gauche Y, **inversé** | haut = avant (origine : Y inversé) |
| Déplacement latéral (axe) | `axes[2]` stick droit X | axe Z d'origine, non lié par défaut |
| Tir principal | `buttons[0]` (A) ou `buttons[7]` (RT) | originalement bouton 1 |
| Tir spécial | `buttons[1]` (B) ou `buttons[2]` (X) | originalement bouton 2 |
| Strafe On/Brake | `buttons[6]` (LT) | originalement bouton 3 |
| Arme précédente / suivante | `buttons[4]` (LB) / `buttons[5]` (RB) | croix haut/bas possible |
| Pause | `buttons[9]` (Start) | |
| Abandon | `buttons[8]` (Back) | |

Constante d'échelle : multiplier l'axe normalisé `[-1, 1]` par 128 pour obtenir la valeur d'origine ; pour la souris, borner à ±190.

## 6. Pseudo-code de référence (TS)

```ts
const SIN = Int16Array.from({ length: 512 }, (_, i) => Math.round(256 * Math.sin((2 * Math.PI * i) / 512)));
const COS = Int16Array.from({ length: 512 }, (_, i) => Math.round(256 * Math.cos((2 * Math.PI * i) / 512)));
const TORE = 1 << 23;                      // période en Q8 (32 768 unités)
const TICK_MS = 25;                        // 40 Hz

/** Boucle : accumulateur d'horodatage, plafond de 800 ms. */
function frameLoop(now: number): number {  // retourne le nombre de ticks à exécuter
  acc += now - last; last = now;
  if (acc > 800) acc = 0;
  let n = 0;
  while (acc > 25) { acc -= 25; n++; }
  return n;
}

/** Hauteur du terrain, Q8 (carte 512×512, torique). */
function terrainHeight(h: Uint8Array, x: number, z: number): number {
  const cx = x >> 14, cz = z >> 14, fx = (x >> 6) & 0xff, fz = (z >> 6) & 0xff;
  const g = (i: number, j: number) => h[(j & 0x1ff) * 512 + (i & 0x1ff)] * 0x400;
  const a = g(cx, cz), b = g(cx + 1, cz), c = g(cx, cz + 1), d = g(cx + 1, cz + 1);
  const top = a + (((b - a) * fx) >> 8), bot = c + (((d - c) * fx) >> 8);
  return top + (((bot - top) * fz) >> 8);
}

/** Pilote de l'hélicoptère (formes 0 et 3) : produit les accumulateurs d'angle. */
function heliPilot(p: Player, k: Keys, axes: Axes, cfg: Axis3) {
  let dCap = 0, dTangage = 0, dRoulis = 0;
  if (cfg.type > 1 && cfg.avancer) dTangage += axes[cfg.avancer] * 10;
  else { if (k[p.keyAvancer]) dTangage += 0x4b0; if (k[p.keyReculer]) dTangage -= 0x4b0; }
  if (k[p.keyStrafeOn]) {
    if (cfg.type > 1 && cfg.tourner) dRoulis += axes[cfg.tourner] * 7;
    else { if (k[p.keyTournerG]) dRoulis -= 0x320; if (k[p.keyTournerD]) dRoulis += 0x320; }
  } else {
    if (cfg.type > 1 && cfg.lateral) dRoulis += axes[cfg.lateral] * 7;
    else { if (k[p.keyLatG]) dRoulis -= 0x320; if (k[p.keyLatD]) dRoulis += 0x320; }
    if (cfg.type > 1 && cfg.tourner) { dCap += axes[cfg.tourner] << 3; dRoulis += (axes[cfg.tourner] * 0x320) >> 8; }
    else {
      if (k[p.keyTournerG]) { dCap -= 0x258; dRoulis -= 0xc8; }
      if (k[p.keyTournerD]) { dCap += 0x258; dRoulis += 0xc8; }
    }
  }
  p.accCap += dCap; p.accTangage -= dTangage; p.accRoulis += dRoulis;
  p.cap = p.accCap >> 8; p.tangage = p.accTangage >> 8; p.roulis = p.accRoulis >> 7;
  p.accTangage = (p.accTangage * 14) >> 4; p.accRoulis = (p.accRoulis * 14) >> 4;
}

/** Physique de l'hélicoptère, après y += vy etc. (vitesses en Q8 par tick). */
function heliPhysics(p: Player, height: Uint8Array) {
  if (p.roulis < 0) p.roulis += 4; if (p.roulis > 0) p.roulis -= 4;
  if (p.tangage < 0) p.tangage += 2; if (p.tangage > 0) p.tangage -= 2;
  if (p.tangage) { p.vx -= (SIN[p.cap & 511] * p.tangage) >> 5; p.vz -= (COS[p.cap & 511] * p.tangage) >> 5; }
  if (p.roulis) { p.vx += (SIN[(p.cap + 0x80) & 511] * p.roulis) >> 6; p.vz += (COS[(p.cap + 0x80) & 511] * p.roulis) >> 6; }
  const sol = terrainHeight(height, p.x, p.z);
  const devant = terrainHeight(height, p.x + p.vx * 32, p.z + p.vz * 32);
  const e = (Math.max(sol, devant) >> 8) + 0x50 - (p.y >> 8);
  if (e > 0) p.vy += 2 * e; if (e < 0) p.vy += e >> 1;
  for (const a of ["vx", "vy", "vz"] as const) { const d = p[a] >> 4; p[a] -= d === 0 ? p[a] : d; }
  if (p.y - 2000 <= sol) { /* choc : voir §3.4 (16 directions, vy = 1000, PV -= 10) */ }
}

function wrap(p: { x: number; z: number }) { p.x &= TORE - 1; p.z &= TORE - 1; }   // après pos += vel et la physique
```

Les caméras et la physique des véhicules sont décrites en formules aux §3.6 et §4.

## 7. Fonctions à nommer

Les noms `gm_*` proposés ne sont pas dans `keyfuncs.def.tsv` (le coordinateur fusionnera). Les adresses marquées (label) ne sont pas des fonctions pour Ghidra (aucun `decomp/`), il faut les créer.

| Adresse | Nom `gm_*` | Rôle |
|---|---|---|
| `0043c234` | `gm_game_tick` | un tick de logique (25 ms) : objets, fonctions pilote, mort, jauge de PV |
| `004234ec` | `gm_effects_tick` | tick de la file d'effets (particules) `005876dc` : `pos += vel`, durée `+0x38` |
| `004157d0` | `gm_menu_anim_tick` | décompte animé des scores des menus (drapeau 2 de `gm_poll_events`) |
| `0042fc70` | `gm_ground_flash_fade` | décrémente de 0x1e les 4 096 cases de la carte d'éclairs au sol `005624c8` (C) |
| `0042a084` | `gm_objects_update` | mise à jour des objets solo : fenêtre 11 × 11, `pos += vel`, tore, fonction `+0x68`, collisions sphériques |
| `0042a940` | `gm_objects_update_net` | variante réseau (probable) |
| `0042a010` | `gm_type_radius2` | rayon² du modèle du type (100 si type 0 ou ≥ 10 000) |
| `00415374` | `gm_normalize_delta` | normalise un vecteur d'écart (tables `0055a4c8`/`005836ac`) |
| `00425c94` | `gm_terrain_height_water` | hauteur Q8 avec ondulation d'eau (carte 102, drapeau de mission 2) ; pose `00577664` |
| `00443510` | `gm_vehicle_contact` | 4 points de contact des roues + vecteur de poussée du corps |
| `00444af8` | `gm_heli_physics` | physique de l'hélicoptère (altitude assistée, poussée par tangage/roulis, choc) |
| `00445228` | `gm_vehicle_physics_1` | physique du véhicule forme 1 |
| `00445670` | `gm_vehicle_physics_2` | physique du véhicule forme 2 |
| `00445a84` | `gm_vehicle_physics_4` | physique du véhicule forme 4 |
| `00445f44` | `gm_vehicle_physics_5` | physique du véhicule forme 5 |
| `004446a0` | `gm_wheel_update` | position, braquage et rotation d'une roue enfant (§3.6) |
| `0043de0c` | `gm_player_set_form` | change la forme du joueur (type 990/991, fonctions pilote/physique, enfants, sons) |
| `0043cab4` | `gm_player_init_state` | initialise PV, armes, touches (copiées du profil `(0x14, pilote, 2)`) |
| `0043ca60` | `gm_player_load_keys` | recopie 11 touches du profil dans le joueur |
| `0043e5c4` | `gm_player_join_local` | place un joueur sur un point de départ |
| `0043e7d8` | `gm_player_join_net` | idem, joueur réseau |
| `00438198` | `gm_player_retarget` | choix de la cible verrouillée |
| `0043c07c` | `gm_player_death_begin` | choisit la fonction pilote de mort selon la forme |
| `00438678` (label) | `gm_pilot_none` | fonction pilote vide (formes `0x2a`, `0x63`) |
| `00438744` (label) | `gm_pilot_dying` | séquence de mort/fin (forme `0x2b`) |
| `00439088` (label) | `gm_pilot_heli` | pilote de l'hélicoptère, forme 0 |
| `00439670` (label) | `gm_pilot_heli_net` | même, joueur réseau (entrées `+0xe4..`) |
| `00439bcc` (label) | `gm_pilot_heli_3` | pilote forme 3 |
| `0043a174` (label) | `gm_pilot_vehicle_1` | pilote forme 1 (roues) |
| `0043a760` (label) | `gm_pilot_vehicle_2` | pilote forme 2 |
| `0043ac64` (label) | `gm_pilot_vehicle_4` | pilote forme 4 |
| `0043b0ac` (label) | `gm_pilot_vehicle_5` | pilote forme 5 |
| `004582dc` | `gm_weapon_select` | choix de l'arme : -1 suivante, -2 précédente, 0..9 directe (2 banques) |
| `00458590` | `gm_fire_special` | déclenche le tir spécial |
| `0046b6fc` | `gm_fire_primary` | tir principal (armes, R3) |
| `00410b74` | `gm_joy_read_axes` | lit `joyGetPosEx` pour la calibration |
| `004168b0` | `gm_menu_ctrl_misc` | menu secondaire de la configuration du contrôleur (hypothèse) |
| `00416b50` | `gm_menu_joy_calibrate` | calibration du joystick / Gravis |
| `004171b4` | `gm_menu_ctrl_type` | choix du type de contrôleur et **valeurs par défaut des touches** |
| `0041797c` | `gm_menu_ctrl_axes` | liaison des axes (tourner/avancer/latéral, « Clip To Center ») |
| `00418454` | `gm_menu_ctrl_bindings` | menu « Controller Bindings » (11 touches) |
| `00411eb8` | `gm_net_receive` | reçoit les messages DirectPlay (joueurs distants) |
| `0043daa0` / `0043db98` | `gm_net_send_input_client` / `gm_net_send_state_host` | émission réseau (hypothèse) |

Variables globales utiles : `00490010` états de touches, `004841a4` type de contrôleur, `00484188/8c/90` axes liés (tourner/avancer/latéral), `005b0434/38/30` axes X/Y/Z, `004841d4/d8/dc` intentions cap/tangage/roulis, `004841b8` molette, `005af3ac` liste des joueurs, `005af3c4` joueur local, `00480e74` vues, `00480aac` accumulateur de temps, `00481190` ips estimées, `005b0404` ticks de mission, `005b03cc` plafond de vol, `005b1fc4` carte de hauteur, `00577664` type de sol, `00577670` drapeaux de mission.

## 8. Questions ouvertes

- Lecture des types 3, 4 (calibration), 6 (Creative Blaster) : seule `joyGetPosEx` du type 5 est dans `gm_poll_events` ; `FUN_00410b74` lit les trois axes pour la calibration. Les codes `0xf0..0xf7` du type 6 restent inexpliqués.
- Forme 3 (identique à la 0 pour le pilotage) ; déclencheurs précis des formes 2, 4, 5 (objets bonus), à croiser avec R2/R3. Noms des formes (buggy, motoneige, aéroglisseur) : déduits du comportement (eau, modèles), pas des chaînes du jeu.
- `+0x94` (cap de tir) est tenu à jour dans `Player.fireYaw` et lu par le canon (`gm_primary_bullet_spawn`, `0046b4b4`). Les constantes de frottement des formes 4 et 5 sont à relire dans `00445a84` / `00445f44` avant portage.
- Liste `00587704` (« plan large », +900 en hauteur), `+0x190`, `00480c80`, le sens des touches F3/F4 et la condition `profil[+0x28] > 0` : hypothèses.
- `FUN_00443ed0` (effets au choc) non lu ; séquence de mort `00438744` non décrite en détail (R3).
- La cadence réelle dépend de la résolution de `msg.time` de Windows 95 ; le port devrait utiliser un pas exact de 25 ms avec la même règle de plafond (800 ms).
- Les simulations par calcul (§3.3, §3.6) n'ont **pas** été recoupées avec une exécution du jeu d'origine : les valeurs d'équilibre sont à valider visuellement.
