# Armaeth : analyse dynamique sous DOSBox-X

Tâche DX1. Un banc d'essai sans fenêtre fait tourner l'*Armaeth* d'origine (CD DOS, version française) dans DOSBox-X, le pilote par touches et en enregistre la vidéo ; on s'en sert pour trancher par l'observation des points restés ouverts dans `engine.md`, `parser.md`, `objects.md` et `characters.md`. Le code du port n'est pas modifié ; les changements recommandés sont listés en fin de document.

## 1. Résumé

| Question | Résultat | Confiance |
|---|---|---|
| Cadence du jeu | **un tic de monde = 7 images à 70,0866 Hz = 99,9 ms, soit 10,01 tics/s** au délai 6 ; le héros marche à 2 px par tic = **20,0 px/s** | certain (57 tics sur 59 durent exactement 7 images, 2 durent 8) |
| La cadence dépend-elle du CPU ? | non entre 12 000 et 60 000 cycles (486 DX/33 à Pentium) | certain |
| « Trop loin » : qui marche ? | **le héros marche vers l'objet**, puis la commande est rejouée ; `V008` n'est pas affiché | certain pour une clef, une armoire (sans Prytwen) |
| « Trop loin » en présence de Prytwen (salle 105) | le héros ne bouge pas, **Prytwen marche vers le héros** et dit « Prytwen n'aime pas que l'on fouine… » | certain (observé) |
| Refus parasite (`V014` à côté de `V082`) | **non tranché** : la porte 111 s'est ouverte (« Ok. »), pas de mauvaise clef testée | non vérifié |
| Lumière | le décalage mesuré entre 12 h 10 et 0 h 10 est de -47 (le port : -48) ; en dessous de -40 le jeu d'origine est très sombre | probable (un cran de DAC d'écart) |
| Jetons de débogage `/dgs 99`, `/trf`, `/loc`, `/inf`, `/heu`, `/dlo`, `/ego` | **fonctionnent en jeu** (outil d'observation précieux, § 5) | certain |

## 2. Lancer le banc

```
scripts/armaeth/dosbox/run.sh -s scenario.txt -d 90 -o /tmp/essai -p "30 45"   # puis : video.py --help
```

Fichiers : `scripts/armaeth/dosbox/run.sh` (en-tête : mode d'emploi complet, format des scénarios, pièges), `dosbox.conf` (matériel émulé), `autotype.py` (scénario vers AUTOTYPE), `video.py` (analyse de la vidéo). Prérequis : `dosbox-x` et `ffmpeg` installés, CD extrait dans `archives/armaeth/cd/` (`scripts/armaeth-extract.sh`). Aucune fenêtre n'est ouverte (`SDL_VIDEODRIVER=dummy`). La vidéo (`DX-CAPTURE /V`) compte une entrée par image VGA émulée : l'image n est à n / 70,0866 s, quelle que soit la vitesse de la machine hôte. Une session de 3 minutes dure 3 minutes.

Choix de configuration : `machine=vgaonly` (le pilote `VGA.EXE` exige un VGA couleur et écrit directement dans le DAC), interpréteur `core=normal`, `cputype=486`, **25 000 cycles fixes** (repère de la documentation de DOSBox pour un 486 DX2/66 ; une cadence recalée à 12 000 cycles donne les mêmes résultats), Sound Blaster 2.0 (OPL2 seul, MPU-401 coupé : le pilote musical n'a qu'AdLib à choisir), pas de souris.

### Ce que le banc a dû contourner

- **`SC0` (protection) est sauté**, mais `am1` s'arrête alors sur « Gestion vidéo non disponible » : la table du pilote VGA n'est publiée qu'après l'appel de l'entrée `+0x14` du bloc de liaison (`vga_init_block`, le jeton `isr`), que rien d'autre ne fait au démarrage (`re-index.md` : « non élucidé »). Un `VINIT.COM` de 20 octets fait cet appel entre `vga` et `am1`. *Hypothèse non vérifiée* : c'est ce que `SC0` fait en passant. Aucun écran de protection n'est donc reproduit ni testé.
- `ARMINS` écrit l'étiquette du volume dans `A1FINS.SYS` ; le lecteur est monté avec `-label ARMAETH`, sinon « Le label disque ne correspond pas ».
- **AUTOTYPE** : une seule commande par session (deux commandes qui se suivent figent l'émulateur dès que la seconde démarre en jeu) ; une touche coûte `cadence + 0,058 s`, une virgule `2 x cadence` ; la cadence doit rester sous 0,25 s (à 0,5 s et plus la touche se répète) ; pas d'Alt+lettre, donc pas de réglage de cadence au clavier.
- **Fiabilité** : environ une session sur cinq perd les touches (une fenêtre ou la ligne de saisie ignore Entrée pendant des dizaines de secondes ; la cause n'est pas trouvée) et DOSBox-X se fige parfois à la sortie (chien de garde). `run.sh` relance l'essai quand une attente `@expect` du scénario n'est pas vérifiée (l'introduction en a deux d'office) ; une session réussie est reproductible à l'image près. Les enchaînements longs de commandes tapées (`/trf` puis une autre commande) échouent souvent. Pistes écartées : toucher `kp_enter` au lieu de `enter` (variable `AT_ENTER`) a donné 6 réussites sur 6 sur un scénario court mais n'a rien changé sur les longs ; INT 33h coupé ou non ne change rien non plus. Piste restante : après `/ego`, `/trf` ou une fenêtre, le jeu semble ignorer les touches tant qu'un script tourne (les caractères sont alors ignorés, `parser.md` § 11.2), ce qui ressemble à des touches perdues ; sans point d'arrêt dans `am1` on ne peut pas le prouver.

Le premier écran de jeu est atteint en ~42 s : titre (`01-titre.png`), récit (`02-recit.png`), salle 1 et fenêtre S13 (`03-s13.png`), salle 1 (`04-salle1.png`). Images dans `docs/armaeth/dosbox/`.

## 3. Cadence (engine.md § 3, movement.md § 8 point 11)

**Méthode.** Le héros (salle 1, X = 219) marche vers la gauche après une pression de flèche ; on suit le centroïde des pixels de sa tunique image par image (`video.py track`). **Résultat** : sa position change toutes les **7 images** (56 fois sur 58 ; 8 images 1 fois, ~20 ms de retard de capture) ; sur un cycle de 8 tics (8 pas d'animation) il avance de **16 px**, soit 2 px/tic (`dpX = 2` dans la fiche `/inf 1`, `05-inf-clef.png` montre celle de la clef). Identique à 12 000, 25 000 et 60 000 cycles : la boucle est calée sur le retour vertical (`3DAh`), pas sur le processeur (un 486 DX/33 y arrive encore).

- images : 70,0866 Hz (mode 13h) ; tic de monde : 70,0866 / (délai + 1) = **10,01 tics/s** au délai 6 (c'est la valeur « ~10 à 70 Hz » d'`engine.md` § 3, qui est donc **confirmée**) ;
- horloge de jeu : 100 tics = 1 minute de jeu = 10 s réelles (inchangé, calcul) ; S13 apparaît 60 tics après l'arrivée dans la salle 1 : mesuré 37,7 s contre 31,9 s pour l'arrivée, soit ~5,8 s (cohérent avec 6,0 s, à la précision du repérage près) ;
- le port avance à **50 Hz** (`TICK_MS = 20`) : 7,14 tics/s au délai 6, soit **40 % trop lent** (marche : 14,3 px/s au lieu de 20).

Non mesuré : la fréquence réelle des tics BIOS (`wat n`, fenêtres à délai) ; le test `/wat 200` n'a pas abouti (touches perdues). Indice : titre (`wat` de 80 tics) ~6,4 s et distribution (60 tics) ~4,7 s, bornes hautes qui incluent des chargements ; le rythme du port (18,2 Hz) est donc plausible mais non confirmé.

## 4. Observations

### 4.1 « Trop loin » (parser.md § 6.7, objects.md § 1.5, characters.md § 13)

- Salle 11, `prendre la clef` (la clef est à ~20 px) : dès l'Entrée, le héros marche vers la clef et la prend ; fenêtre « Ok. » (`V015`) ; **aucune fenêtre `V008`** n'apparaît (elle est avalée par la marche, comme dans le port).
- Salle 105 sans Prytwen (`/dlo 101`), héros à droite, armoire à gauche (~150 px), `regarder dans l'armoire` : **le héros traverse la salle**, la commande est rejouée à l'arrivée et affiche « La porte est fermée. » (`V084`) (`07-armoire-heros-marche.png`, `08-armoire-v084.png`). C'est exactement le test `reactions.test.ts` du port.
- Même commande **avec Prytwen** : le héros reste à sa place, **Prytwen marche vers lui** (`06-armoire-prytwen.png`) et la fenêtre « Prytwen n'aime pas que l'on fouine dans ses affaires, il va d'ailleurs vous l'expliquer lui-même… » apparaît. Cas particulier du gestionnaire de Prytwen (fouille de ses affaires), qui explique la lecture « le personnage marche vers le héros » de `characters.md` § 13. À noter : s'il atteint le héros, celui-ci est assommé (« Pas maintenant ! », `V093`, les commandes sont refusées).

**Conclusion** : `objects.md` § 1.5 a raison pour le mécanisme général ; `characters.md` § 13 décrit le cas Prytwen.

### 4.2 Refus parasite

`ouvrir la porte avec la clef` en tenant la clef d'or (6) devant la porte 111 (salle 105, clef attendue : 109) : la porte **s'est ouverte** avec « Ok. » (`10-porte-ok.png`), sans `V082` ni `V014`. Soit la porte n'est pas verrouillée au départ (`Ego 1`, alors que `characters.md` § 5 la dit fermée à clef), soit la clef d'or convient. Non tranché : on a essayé de forcer `Ego 0` (`/dgs 99` puis `/ego 0 111`, dans la salle 105 juste après l'arrivée, clef d'or en main) à quatre reprises ; chaque fois la ligne de saisie est restée bloquée (« /ego 0… » puis « ouv » sans suite) : après `/trf` ou `/ego` les touches ne sont plus lues avant des dizaines de secondes. La clef de bronze 109 n'a pas été cherchée (`/loc 109`). À refaire avec une meilleure injection de touches (voir § 6).

### 4.3 Lumière (engine.md § 7.5)

`/heu 12 9 99` puis `/heu 0 9 99` dans la salle 1 : en échantillonnant des pixels fixes, la teinte de nuit se déduit de celle de jour par un décalage de **-47** par composante (en 6 bits, borné à 0), contre -48 attendu (`daylight(0, 10) - 63`). Écart d'un cran de DAC, sans conséquence. **Heures 5, 8 et 20 (10 minutes)** : décalages mesurés par rapport à 12 h 10 : -39, -18, -28 ; le port calcule `daylight(h, 10) - 63` = -40, -19, -29. La courbe `DAYLIGHT_CURVE` et l'interpolation par les minutes sont donc **confirmées**, à un cran de DAC près (constant, probablement le niveau de midi vaut -1 dans l'original ou l'arrondi du DAC). Voir `09-nuit-0h10.png` : à ce niveau (< -40) la scène est quasi noire, cohérent avec `DARK_LEVEL`.

### 4.3 bis Fenêtre de message (screens.md E9)

La fenêtre d'une ligne (« La porte est fermée. », `08-armoire-v084.png`) occupe x 113 à 208 (centrée, largeur ~96), **y = 21, hauteur 21** (= 7 x (1 ligne + 2)) : conforme à `parser.md` § 13.2 (y = 0x15, hauteur 7 x (lignes + 2), rétrécie au texte et centrée). Largeur exacte non comparée à la police GPH.

### 4.4 Jetons de débogage (parser.md § 17, 6)

`/dgs 99` rouvre bien tout l'interpréteur ; ce niveau **retombe à 0 à chaque script** (donc après chaque `/trf`) : retaper `/dgs 99`. Confirmés en jeu : `/trf n` (téléportation, héros compris), `/loc n` (« Salle 105 » pour l'armoire 113 et Prytwen 101, « Salle 011 » pour la clef 6), `/inf n` (fenêtre de tous les champs : `X`, `Y`, `P`, `Sol`, `dpX`…), `/heu`, `/dlo`. `F8` n'a pas pu sauter l'introduction (la touche n'est pas lue pendant les attentes de `tta`).

## 5. Changements recommandés pour le port (non faits)

1. **`src/games/armaeth/ui/scheduler.ts`** : `TICK_MS = 20` → `1000 / 70.0866` (14,268 ms) pour la boucle de jeu (images). Le monde avance alors tous les `délai + 1` images, soit 10,01 tics/s au délai 6. Revoir en même temps `engine.ts` : `BIOS_PER_TICK`, `CARET_BLINK` et toute durée exprimée en images.
2. **Séparer la musique** : le séquenceur doit rester à 50 Hz (IRQ0, diviseur PIT `0x5D37`) alors que les images passent à 70,09 Hz (deux horloges).
3. Corriger les documents : `engine.md` § 3 (valeur confirmée : le point 9 de § 13 se ferme) ; `plan.md` « Cadence » (« IRQ0 à 50 Hz » vaut pour la musique, pas pour les images) ; `characters.md` § 13 et `parser.md` § 6.7 (qui marche : le héros, sauf gestionnaire propre à Prytwen) ; `objects.md` § 548 point 1 (rejeu : confirmé pour 1, 2, 4 non distingués).
4. À tester dans le port : la salle 105 avec Prytwen (le héros ne doit pas marcher, Prytwen oui).

## 6. Ce qui reste invérifiable ou non fait

- Mauvaise clef sur une porte (§ 4.2), rendu des objets invisibles (`Inv`), miroir du masque de profondeur : non mesurés (le banc perd des touches ; les chaînes de commandes tapées de plus de deux étapes sont peu fiables).
- Fréquence des tics BIOS (`wat`).
- L'écran de protection `SC0` n'est pas exécuté (la table de nombres n'est pas dans le dépôt).
- Le CPU 386 (< 12 000 cycles) n'a pas été essayé pour la cadence (une session à 4 000 cycles a été trop lente pour le scénario d'introduction).

## 7. Corrections appliquées au port

- **Cadence (§ 5 point 1)** : `TICK_MS = 1000 / 70,0866` (`ui/scheduler.ts`, `FRAME_RATE` exporté par `engine/engine.ts`) ; `BIOS_PER_TICK` 1821 -> 1299 (18,2065 / 70,0866 = 0,2598 tic BIOS par image, sur 5000) ; `CARET_BLINK` 25 -> 35 images (0,5 s conservé, pas d'origine non mesuré). Le diviseur de monde (`délai + 1` images) est inchangé.
- **Musique (§ 5 point 2)** : le séquenceur reste à 50 Hz par un accumulateur entier dans `ArmaethEngine.advanceSequencer` (50 x 10^4 ajoutés par image, un tick à chaque dépassement de 70,0866 x 10^4 ; au plus un tick par image, déterministe). `WebOpl` / `OplStream` datent déjà les écritures par numéro de tick du séquenceur : seuls les commentaires changent.
- **Documents (§ 5 point 3)** : `plan.md` (Cadence), `engine.md` § 3 et § 13 point 9, `parser.md` § 6.7, `characters.md` § 13 mis à jour. `objects.md` n'a pas été modifié (hors périmètre de cette tâche).
- **Prytwen et l'armoire (§ 5 point 4)** : `tooFarWardrobe` (`game/helpers.ts`), utilisé par les gestionnaires de l'armoire (direct et indirect) : si Prytwen (`Ego 0`) est dans la salle de l'armoire, le héros n'est pas armé pour marcher, Prytwen reçoit le héros pour cible (`walkTo`) et `G119` s'affiche ; sinon `tooFar` habituel. *Hypothèse* : la condition `Ego 0` de Prytwen (seul état observé) ; le comportement quand l'armoire est à portée n'est pas mesuré. Tests : `reactions.test.ts`.
- **Lumière (§ 4.3)** : pas de correction. `render/light.ts` suit `engine.md` § 7.5 (12 h 10 : `63 - 63 = 0` ; 0 h 10 : `15 - 63 = -48`, pas d'arrondi en jeu, l'interpolation est nulle entre deux valeurs égales). L'écart d'un cran vient plus probablement de la mesure (le décalage est déduit d'une vidéo 8 bits : la conversion DAC 6 bits vers 8 bits de DOSBox arrondit) que du port.

