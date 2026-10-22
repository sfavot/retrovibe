# Partie et plateau S01 (E2a)

Adresses `segment:offset` de `SMURF.EXE`. Confiance : **sûr** (code lu), **probable**, **hypothèse**.

## Boucle de partie `28a3:00ad` (sûr)

Par tour : musique aléatoire `s52m00Nm` (`28a3:0007`), plateau `291e:0401` → code, voix d'accroche `sNNa` + 1 ou 2 (`28a3:04dc`, absentes pour S13, S38, S39, S41), scène. Codes 200 à 203 (pause) n'avancent pas le joueur. Victoire testée pour le seul joueur courant, puis fin du temps. Fin : S11 `s11a.mux` (`28a3:0080`) ou `s42a0N.mux` (N = 0x29 + message + 9 × rand 4), puis `21ee:1c92` (heure de fin, verrou parental).

## Plateau `291e:0401` (sûr sauf mention)

- Cadence : `1f33:0348(4)`, 15 images/s.
- Début de tour : annonce du personnage `s01v` (`26ee:006a(12)` : `table[perso] × 5 + rand 5 + 1`, table 0,4,5,1,2,3), 0,5 s d'attente, puis avertissement de temps. Le chrono du tour (slot 1) repart après l'annonce. S19 (`1e52:0324`) au premier tour ; réplique du Grand Schtroumpf (`26ee:027e`) après l'avertissement ; commentaire d'avancement (`26ee:0f17`) avant le dessin du plateau (voir `screens-grand-schtroumpf.md`).
- Poses `DS:28A0` (table `CS:2bd4:029d`) → animations de `s01a000s.hy8` (`291e:000e`) : 0/1 attente D/G (anims 0, 1) ; 2/3 marche (2, 3, 8 images) ; 4/5 saut (4, 5, 10 images) ; 6/7 course (6, 7) ; 8/9 impatience (9, 0xB) ; 10 arrivée (0xC, 8 images) ; 12/15 pion caché (sprite 0xAA). Un seul Schtroumpf pour tous les joueurs ; le personnage n'apparaît que sur le bandeau (`s01a001s.hy8`, sprites 0 à 5).
- Choix de pose `2bd4:02bd` : saut à droite > saut à gauche > marche à gauche > marche à droite. Marche 4 px par image (`2bd4:0093`), course 8 px après 5 s de marche continue (chrono slot 6, repart au changement de pose sauf marche → course et attente → impatience), impatience après 8 s. Saut : « haut » + direction, 10 images sans réaction aux touches, +0x44 px à l'image suivante. Bruitage du saut (bip 2) à la 2e image, armé seulement après un premier saut fini (`DS:8FFE`, nul au départ : probable). Arrivée : bip 1 à la fin de l'animation, puis attente tournée à droite.
- Bords `291e:13f2` : voir `rules.md` ; sorties 100 / 101 → `s01b.mux` / `s01c.mux`.
- Bandeau `1e52:060b` : portrait (sprite = personnage) en (0x55, 0xB6), ingrédients de l'objectif (0x0F + i manquant, 6 + i possédé) puis les autres possédés, texte « points/objectif » en y 0xA7, goutte (0x0E, 0x17 si 0 point).
- Minuteur de tour (`2bd4:0046`, multijoueur) : image 0x77 + min(9, secondes / 3) de `s01a000s.hy8` en (0x124, 0xC6) (probable pour la position).
- Cage `291e:125c` : sprite 0x9D par écran (3 : 0xAC/0x84 ; 5 : 0x106/0x84 ; 7 : 0xB0/0x39 ; 8 : 0x34/0x84 ; 9 : 0x3A/0x84). Siphon : sprite 0x52 (D) / 0x53 (G) en (0x109, 0x84) écrans 3 et 6, (0xA3, 0x38) écran 5.
- Décor `2bd4:07e2..149c` : écran 1 trois animations continues ; écrans 3, 4, 7 animations minutées ; puits ouvert : anim 0x18 aux écrans 4, 6, 9 ; oiseaux (`2bd4:1634` / `174a`) aux autres écrans (probable pour les détails).
- Lac et pont : bruit `s18a001b` / `s16a001b` à l'entrée dans la plage comptée, si rien ne joue.
- Indices (`26ee:006a`) : 12 s → `s01v` 31..35, 24 s → 36..40 (seulement si aucune touche). À 36 s à plusieurs : appui automatique. « Rien ici » (multijoueur) : `s01v` 46..50. Prisonnier : `s20v` 1..3 ; siphon : `s20v` 1, 3 ou `s21v` 1.
- Clic droit : voix `s45v` + porte de la zone (table `DS:28B2`, 14 → 13 aux écrans 4, 6, 9), chrono gelé.
- Pause : P → S48 (`269a:0007`), chrono du tour gelé, chrono de la partie en marche (hypothèse). 200 reprise, 201 S46 (`1823:0415`, réaffiché tant qu'il reste des joueurs), 202 S02 consultation (`1a3c:0225(zone, 1, 0)`), 203 S45.

## Écarts à l'original

- Le bouton est un appui (front), pas un bouton tenu ; clavier d'origine seul, souris : boutons.
- Bandeau sans objectif avant S19, comme l'original (`Board.setGoalHidden`) ; S19 le complète, puis le plateau le redessine entier.
- Poussée hors des lignes de séparation (`2813:0886`) et marche d'entrée d'écran (`291e:13f2`) instantanées, sans animation.
- Fondu de 0x20 pas après la voix d'accroche : fondu normal.
- Grand Schtroumpf (S19, S42, S11, `26ee:0f17`, `26ee:027e`) : voir `screens-grand-schtroumpf.md`. Non reproduit ici : animations S13 à S21 (souches).
