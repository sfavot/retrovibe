# Groupe `misc` (vague Φ2) : notes de portage

Câblage : `engine/parts/misc/index.ts` appelle `registerPipes`, `registerTools`, `registerPlay`, `registerObjects`. Chaque fonction traduite porte `// <adresse> <nom>`. Traces de référence locales : `test/tim3/traces/misc-*.tsv` (v1) et `test/tim3/traces/v2/` (non versionnées) ; tests `test/tim3/engine/parts/misc-*.test.ts`.


## Outils : gant 35, taille-haie 37, cisailles 77, tremplin 39, ouvre-boîte 67 (`parts/misc/tools.ts`)

- Adresses portées : 442210 / 44224f / 44234c / 4423b5 (gant), 442760 / 442905 / 442800 / 442a44 (37 et 77 partagés ; dessins 442a75 / 442ab8 sans effet dans le moteur, portés par le rendu (`render/parts.ts`)), 443168 / 443218 / 4431d9 (tremplin), 445801 / 4457ac (ouvre-boîte), plus 434eff (`gatherInRect`, zone de frappe du gant, exportée) et 4423ed (force du coup selon la masse).
- Les globales de cache (0x481e40, 0x481e68…, 0x481e88, 0x481668, 0x481f48) ne dépendent que des ANM : recalculées à chaque appel (`stateFirst` = 44b2c0). Le compte à rebours de clignotement du taille-haie (0x47806c, 120 au départ) est gardé par monde.
- Besoins hors du groupe : (1) `cutRopes` (442af6, coupe des cordes 10 et 76 par les cisailles et le taille-haie) lit la structure des cordes, donc `mechanics` : souche journalisée (`442af6`) ; tables de segments déjà relevées (0x47802c … 0x47805c) ; (2) le gant appelle 43f907 (moteur 6) et 440454 (aquarium 15) via `World.special` ; (3) la globale 0x481664 (image de repos de la souris 54, écrite par 4445e5) n'a pas de champ dans `World` : `mouseRestFrame` rend 0.
- Scénarios (`test/tim3/engine/parts/misc-tools.test.ts`, traces `misc-<NIVEAU>-tools<type>.tsv`, 500 pas) : 12 identiques au banc (gant TLEV18 avec coup effectif ; tremplin TLEV17 ; taille-haie TLEV13, RLEV2, TLEV33 ; reste sans déclenchement). L'ouvre-boîte (67) et les cisailles (77) ne se déclenchent dans aucun scénario disponible : leur code n'est vérifié que par lecture.

## Groupe C : jouets et balles spéciales (`parts/misc/play.ts`, `kick.ts`)

Types 59 (super-balle), 64 (bumper), 69 (coussin antigravité), 87 (balle programmable), 116 (flipper), 117 (queue de billard), 119 (poche). Tests : `test/tim3/engine/parts/misc-play.test.ts` (26 scénarios `--keep` en v1, 6 comparaisons d'image/compteur en v2 : `play-*.v2` dans `test/tim3/traces/`).

- **Convention slot 0** : l'exe passe la pièce qui touche et relit la touchée par +0xDC ; le port reçoit `(part = touchée, arg = toucheuse)`, et `part` seul quand 43373c appelle le slot 0 d'une pièce sur elle-même (super-balle). Helper `toucher(part, arg)`.
- **87** : le slot 2 recalcule l'accélération (`prog[3]`) depuis la densité réglée (4340b0/4340ef) ; le slot 7 (réglages d'éditeur) n'est pas appelé par la simulation. Le bloc +0x90 reste `Part.prog`.
- **64 bumper** : 43a28f (vitesse polaire, `sin` pour vx, `cos` pour vy) et 43712c (angle des centres) sont recopiés localement (`centreAngle` de `bounce.ts` n'est pas exporté : besoin de noyau mineur). L'exe calcule aussi `max(0x1c00, |v|…)`, jamais lu : omis.
- **69** : 434eff porté en `collectInArea` (`kick.ts`) ; la chaîne se construit en tête (ordre inverse des listes).
- **116** : 43dcb5 (2 543 octets, aiguillage « actionner la pièce » par type, partagé avec gant, cisailles…) et la zone 43dc3c ne sont pas portés ici : `kick()` appelle `World.special(0x43dcb5)` (souche journalisée), la zone est dans `kickZone` (globales 0x481d30…3c). À brancher par le groupe qui porte 43dcb5.
- **117** : tables de données lues dans l'exe (0x478364, 0x4783f4, 0x478374, 0x4783b4) ; 41355c (intersection de segments, arrondi `idiv`) et 41352a (borne sur 16 bits) recopiés.
- Écart hors périmètre (famille `balls`) : le clignotement de la boule de flipper 43 (43bd83) n'est pas à l'heure du banc en v2 (premier clignotement au pas 20 dans TLEV17 côté banc, 13 côté port ; 120 contre 78 dans TLEV1) : minuterie 0x477d00 initialisée autrement. Invisible en v1, mais il consomme le générateur (4520a4).

## Objets : ballon 4, panier 11, aquarium 15, punaise 53, boîtes 71, cheville 72 (`parts/misc/objects.ts`)

- Scénarios : 44 sur 60 identiques au banc (v1 et v2, 500 pas) ; 16 ignorés (ballons et paniers attachés à une corde : le banc les retient, la tension 43a31d est du noyau `mechanics`). Cheville 72 : aucun niveau, traduite sans trace.
- Besoins de noyau : (1) slot 5 appelé avec 6 arguments par la tension de corde 43a8f1 (`reactToCollision(world, other, self, mode, momentum, basket)` exporté ; le handler enregistré fait un appel réduit) ; (2) octets +0xB0/+0xB1 (ancrage de corde) absents de `Part` (WeakMap locale `anchorOf`) ; (3) structure de corde +0xA8 opaque (`RopeData` locale) ; (4) création de pièce (432d00) pour le bout de corde 0x31 d'un ballon éclaté attaché : souche 43f34d.
- Constat noyau : sur les murs de type 56, +0x104 vaut 12 au pas 0 dans l'exe, 0 dans le port.

## Tuyaux : 47, 57, 97, 98, accélérateur 88, bloc de couleur 127 (`parts/misc/pipes.ts`)

- Parcours des tuyaux (43d59c, 43d711, 43d972, 43d9a8, 43da1a) interne à `pipes.ts`. 65 niveaux réels `--keep` et 6 niveaux synthétiques (`test/tim3/traces/synthetic/`, générés par `TIM3_WRITE_PIPES_LEV=<dossier> npx vitest run test/tim3/engine/parts/misc-pipes.test.ts -t écrit`, tracés par `bench.py trace --lev`) identiques au banc sur 600 pas. Non couverts : 57 images 0 et 1, 98 entré par les côtés, 97 par l'indice 4 depuis le bas.
- Besoins : (1) sortie 43da1a : les billes 54, 70, 109 appellent 444adc, 445c9e, 447b19 : crochet `pipeExitHooks` (groupes `creatures` et `electric`/autre) ; (2) poignée de redimensionnement 0x4815b4 (slot 4 du 97) : WeakMap locale `setResizeHandle`, champ de `World` à créer pour l'éditeur ; (3) slot 4 (97, 127) jamais appelé par le noyau : à câbler côté éditeur si l'exe le fait.
