# Groupe L4 : Goewin, les moines, les grottes, le château

Référence : `scripts.cpp` (`Script::startOilBurner`, `transformPlayer`, `makeGoewinFollow`, `fixGoewin`, `makeGoewinWork`, `freeGoewin`, `checkHasBook`, `enableGargoylesTalk`, `normalGoewin`) et `hotspots.cpp` (`goewinCaptiveAnimHandler`, `catrionaAnimHandler`, `morkusAnimHandler`, `gargoyleAnimHandler`, `skullAnimHandler`, `dragonFireAnimHandler`, `castleSkorlAnimHandler`, `rackSerfAnimHandler`) du moteur `lure` de ScummVM (GPL v3+), lus puis réécrits.

## Code
- `engine/methods/group-4/` : `index.ts` (9 méthodes : 37, 38, 41, 43, 52, 55, 58, 59, 60), `ids.ts` (numéros nommés absents de `engine/ids.ts`).
- `engine/handlers/group-4/index.ts` : 8 fonctions (13 numéros : 19, 21, 22, 26, 28 à 33, 34, 35, 36). Tous ceux qui appellent `handleTalkDialog()` dans ScummVM le font en tête (Catriona, Morkus, gargouilles, Skorl du château, serf) ; Goewin captive, les crânes et le feu du dragon ne le font pas (ScummVM non plus).
- Enregistrés dans `methods/index.ts` et `handlers/index.ts` (une ligne d'import, un élément de table chacun).
- Aucun nouvel état : tout vit dans les enregistrements de hotspots (`actions`, `walkX/Y`, pile d'actions, `tickProcId`, script) et les champs, déjà sérialisés par `save.ts` (testé : `methods.test.ts`, aller-retour avec Goewin au travail).

## Élucidé
- **Goewin « ne s'active pas hors de ses pièces »** : elle s'active partout (`activateHotspot` marche dans toute pièce, elle est persistante), mais elle naît **captive**, avec une animation de 5 images (haut 0, bas 22, gauche 158, droite 18). Le script de libération (`freeGoewin`, séquence `0x2182` après le dialogue `0xE8D0`) met `actionCtr` à 1 ; `goewinCaptiveAnimHandler` joue alors son script, qui change d'animation, puis elle prend le gestionnaire standard. Avant cela elle n'a aucun verbe. Les tests de dialogue la faisaient parler captive.
- **« image 22 hors de l'animation »** : `Hotspot::setFrameNumber` de ScummVM ne contrôle rien ; le portage levait. Tout code qui tourne Goewin captive (la séquence d'entrée de la pièce 38, `makeGoewinFollow`, dans les tests qui visitent toutes les pièces) plantait. **Modification du socle** : `Hotspot.setFrameNumber` ne lève plus, et `drawHotspot` (`render/sprites.ts`) ne dessine rien pour une image hors de la planche.
- **`d99e` exige Goewin active** : la réponse appelle `normalGoewin` (assert chez ScummVM) ; en jeu elle est active depuis la pièce 31.
- **`0x3F2` parle à `0x437`** : la pièce 42 active `0x437` (séquence `0x51`, `activateHotspot 1079`) dès l'entrée dans le château ; le plantage n'arrive que si l'on place `0x3F2` sans passer par la pièce 42. Rien à corriger.
- **Ratpouch qui disparaît en entrant dans la pièce 6** : la séquence d'entrée de la pièce 6 fait `deactivateHotspotSet 3` (liste qui contient Ratpouch) avant le combat du cochon. Comportement d'origine.
- **Gwen (pièce 12 vers 32)** : élucidé au banc, voir `group-3.md` (blocages b et c).

## Écarts avec ScummVM
- `getActiveHotspot` nul déréférencé (41, 52) lève (`requireActiveHotspot`) ; `fixGoewin` lève si l'emploi du temps `0x1C00` est introuvable (assert).
- `setFrameNumber` : voir plus haut (rendu : image hors planche non dessinée, ScummVM lit au-delà).

## Tests (`test/lure/engine/group-4/`)
- `methods.test.ts`, `handlers.test.ts` : un test par méthode et par gestionnaire (6 crânes), états limites (Goewin inactive, pile vide).
- `passage-castle.test.ts` + `test/lure/solution/zone-castle.ts` : **le château de la pièce 42 à la fin du jeu** (`host.exits === 1`), de vrais clics, puis avec sauvegarde et reprise à chaque étape. État de départ : `setupCastleStart` rejoue la séquence différée `0x2911` (dialogue d'Ewan, `0xEED2`). Marges étroites (graine par défaut) : le Skorl doit atteindre la cave avant la fin du vin (~1192 images) et le treuil doit être actionné dans les 62 images du levier tiré.
- Observations du château, élucidées au banc (`group-3.md`, blocages d et e) : « Hey, , attendez! » venait du journal du joueur de test (texte brut, sans le nom substitué ; la bulle affiche « Hey, Minnow, attendez! » ou « Hey, Etranger, attendez! » comme ScummVM) ; dans la pièce 49 le joueur qui vise la sortie marche vers `(-3, 176)` hors de l'écran et reste « en marche » pendant que la séquence de fin (`0x1AD`) se joue : identique dans ScummVM.
- Le joueur des solutions est désormais `runner.ts` (unifié) ; `runner-castle.ts` et `play-caves.ts` sont supprimés (le combat réactif des grottes est `Play.fight`, il gagne aussi le combat du Skorl).

## Passage « grottes et monastère » (fait)

`test/lure/solution/zone-caves.ts` (données, 9 phases, 60 étapes), jouées par `play-caves.ts` (`CavesPlay`, au-dessus de `Play`) ; test `test/lure/engine/group-4/passage-caves.test.ts` : (a) d'une traite, avec trois autres graines, (b) sauvegarde et reprise sur moteur neuf (vrai JSON) après **chaque** étape (53 reprises sur 60 ; refusées pendant un combat, un dialogue, une vue à distance).

- **Départ** (`setupCavesStart`) : le village installé (`startVillage`), puis les **séquences réelles** des réponses de Goewin : `0x2182` (libération), `0x2582` + `0x2524` (le sort, potion qui convient au dragon : champ 56 = 0, `TALK_INDEX` 14), attente de la séquence différée `0x2680` (champ 45 = 2), `0x269e` (la potion est donnée, `TALK_INDEX` 15) ; joueur et Ratpouch sur la place (14). Non joué : le livre, le rameau, les plantes (rien dans la zone ne les exige).
- **Arrivée** : la cave du château (pièce 42) par le dialogue d'Ewan (`0xEED2`, séquence différée `0x2911`), comme `setupCastleStart`.
- Déroulé : Ultar (bar) active les gargouilles (méthode 59) ; Goewin (`0xD99E`) part vers la grille et **n'y attend que ~250 images** (`0x2731` remet le champ 19 à 16) : la phase se rejoue quand elle a abandonné (0 à 2 reprises selon la graine) ; `0xD9CC` ouvre la porte `0x271E` ; pièce 38 (champ 19 = 21) ; crânes ; cochon ; dragon (`Utilise` la potion, puis `Parle à` : Oeil de Gethryn, champ 19 = 22, porte `0x2729`) ; retour par les crânes ; pièce 15 (champ 19 = 23) ; **vue à distance** de la boutique d'Ewan par la fenêtre `0x754C` (« Regarde par », méthode 18) pendant que le Skorl `0x3F1` lui parle : champ 19 = 24 (`npcJumpAddress` 0 : `OLD_ROOM_NUMBER` = 19) ; Ewan (deux « Parle à » : présentation puis `0xEED2`).
- **Le puzzle des crânes** : trois portes A/C/E (jumelles de chaque côté), **une seule ouverte à la fois** : « Tire » un crâne ouvre sa porte et ferme les autres, « Pousse » ferme la sienne. Ceux de la pièce 38 sont poussés par la séquence d'entrée (script différé `0xEBD`). Solution (trouvée par recherche exhaustive sur le modèle, vérifiée) : tirer 42E (A), passer en 39 ; « Dis à Goewin : Va à La Grotte d'entrée, Tire Crâne de gauche, Va à La Grotte Verte, Tire Crâne de droite » ; passer en 40 par C ; tirer 432 (A) : Goewin, qui attendait devant A, passe et tire 430 (E) ; passer en 5. Retour : 433 (C) en 40, 431 (A) en 39. Le menu « Dis à » ne propose que les pièces visitées et les objets survolés ; les objets propres à une pièce (crânes) sont ceux de la pièce où le personnage **sera** après l'ordre précédent.
- **Le combat du cochon** se perd une fois sur deux avec la stratégie à l'aveugle de `Play.fight` (16 parties gagnées sur 30 au mieux). `CavesPlay.fight` réagit à la séquence du cochon (`fwseq_no`) d'après les données de combat (garde 4/1 contre les coups 7 et 10, 5/2 contre le 6, 2/3 contre le 8 et le 11 ; ne pas frapper à la hauteur gardée) : 30 sur 30 sur les graines 1 à 30. **À reprendre dans `runner.ts`** (la solution du château a le même défaut).

## Ce que la solution a révélé (mouvement et PNJ : signalé, non corrigé)

- Un personnage qui **arrive** sur un autre (point d'arrivée de la pièce) ne change pas de pièce : il marche au hasard (`checkForIntersectingCharacter`, comme ScummVM). Le joueur qui reste sur le point d'arrivée empêche Goewin d'entrer ; il doit s'écarter.
- Le joueur est ralenti (parfois 300 à 700 images pour une pièce) par les villageois et le Skorl `0x3F1` en promenade (bulles « Excusez-moi », arrivées bousculées) ; c'est ce qui rend la course contre Goewin aléatoire. Non comparé au banc.
- Goewin ne suit pas d'elle-même après `makeGoewinFollow` (la suite de l'emploi du temps `0x1800` la tient) ; elle renonce à franchir une porte fermée après 5 essais (`npcRoomChange`).
- Le château enchaîné derrière cette zone : Minnow abandonnait son emploi du temps quand on lui parlait pendant un détour (`blockedFlag` laissé vrai par `setSupportData`, comme ScummVM) ; le joueur n'interpelle plus un personnage en détour et lui cède le passage (`group-3.md`, « Causes établies »). Goewin bloquée en 39 et la porte C (autres graines) : le joueur restait sur son point d'arrivée ; `giveWay` remplace les points d'écart fixes. Les trois passages sont verts (grottes : graines 1, 2, 3, 5).

## Comparaison au banc ScummVM

Scénarios `bench/scenarios/l-skulls.txt`, `l-dragon.txt`, `l-serf.txt` (graine 1, `port/run-port.sh lure`), planches `bench/sheets/lure-skulls.png`, `lure-dragon.png`, `lure-serf.png`.
- **Crânes** (pièce 39, `enter 39` ; `enter 38` fait **planter ScummVM** : `setFrameNumber` hors de l'animation de Goewin encore captive, assertion de `hotspots.h`, c'est l'écart « image 22 » ci-dessus) : 13 captures, les 7 premières (pièce, survol, menu, « Pousse » = « Le Crâne ne bouge pas. », menu) **à 0 %** ; après « Tire » la porte A s'ouvre de la même façon : 0,21 % (la ligne d'état : verbe tronqué, D9).
- **Dragon** (pièce 41) : 10 captures, 0 % sauf la capture du menu (2,9 % : phase de la lave animée) et 0,1 à 0,15 % ensuite (ligne d'état, « Parle » / « Parle à », D9).
- **Serf du chevalet** (pièce 4) : le serf n'est dessiné ni dans ScummVM ni dans le portage à `enter 4` (hotspot sans animation avant la coupe de la corde) : pièce **identique à 0 %** ; les 12 % restants viennent du banc (le clic choisit « Statut » dans ScummVM, « Regarde » dans le portage : boîte « Vous avez rien » d'un seul côté). Le gestionnaire du serf n'est donc pas comparé.
