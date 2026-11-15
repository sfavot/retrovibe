import { parseSteps, type Step } from "./driver";

/**
 * Solution de *Ween: The Prophecy* (version française), jouée par `driver.ts`. Sources et traduction en gestes :
 * `docs/ween/walkthrough.md`. Une ligne par étape (`libellé : action ; …`, format de `parseSteps`, `#` : commentaire) ;
 * coordonnées relevées sur les zones actives (`explore.test.ts`, `zones.ts`), noms de survol tirés des `.DAT` du jeu.
 * La partie va jusqu'à la fin du jeu : grains dans le Revuss, `GAGNEFX.TOT`, écran final `EMAJ1END.TOT` (`END_TOT`).
 */
export const SOLUTION = `
# Chapitre 1 : cabane, laboratoire, précipice, salle du crâne, stèle, salle de l'épée (premier grain de sable)
Échap : w 20 ; !k ESC
EMAJ1000 : t EMAJ1000 ; !m 160,120
boule de cristal : 89,105 "Boule de cristal"
message de Petroy : 160,170
boule de cuivre : p 89,105 "Boule de cuivre"
pince : p 244,111 "Pince"
placard ouvert : 268,55 "Placard"
saindoux : p 267,56 "Saindoux"
placard rouvert : 268,55 "Placard"
couteau : p 267,56 "Couteau"
vers la galerie : g 65,80 @EMAJ1001
Uki et Orbi : d
paille : p 167,94 "Paille"
pince sur la rambarde : i PINCE ; 116,114 "Rambarde" ; s
couteau sur le roseau : i COUTEAU ; 34,115 "ROSEAU" ; s
couteau sur le roseau (flûte) : i COUTEAU ; i ROSEAU ; s
axe : p 180,132 "Axe"
retour à la cabane : g 229,92 @EMAJ1000
vers le laboratoire : g 195,91 @EMAJ1002
tablette (gros plan) : 83,106 "Tablette"
tablette : p 87,84
soporifique : p 211,115 "Soporifique"
graines : p 180,127 "Graines"
clef sur le crâne : 92,115 "Clef" ; 207,97 "CRANE" ; s
bague : p 207,97 "Bague"
bague (gros plan) : p 231,79
soporifique sur graines : i SOPORIFIQUE ; i GRAINES ; s
tableau sur crochet : 175,72 "Tableau" ; 124,60 "CROCHET"
drogue sur la niche : i DROGUE ; 175,72 "NICHE"
moule (gros plan) : 147,43 "Moule"
moule : p 158,46 "Moule"
vers la cabane : g 210,65 @EMAJ1000
chaudron (Uki et Orbi) : s
flûte sur Ween (Urm) : i FLUTE ; c WEEN ; s
fraises à Urm : i FRAISES ; 151,74 "URM"
or : p 117,112 "Or"
confiture : p 198,131 "Confiture"
paille dans la cheminée : i PAILLE ; 266,106 "CHEMINEE"
bois dans la cheminée : i BOIS ; 266,106 "CHEMINEE"
flûte (Urm) : i FLUTE ; c WEEN ; s
confiture à Urm : i CONFITURE ; 151,74 "URM"
pouvoirs d'Urm sur la cheminée : 266,106 "CHEMINEE"
or dans le chaudron : i OR ; i CHAUDRON ; s
chaudron sur le feu : i CHAUDRON ; 266,106 "CHEMINEE"
chaudron d'or fondu sur le moule : 266,106 ; i MOULE ; s
vers le laboratoire : g 195,91 @EMAJ1002
clef en or sur le cadenas : i CLEF EN OR ; 83,106 "CADENAS"
demi-statuette : p 87,84
par la trappe : g 93,102 @EMAJ1003
tibia : p 189,135 "Tibia"
flambeau : p 35,50 "Flambeau"
planches : p 35,92 "Planches"
chaudron sur le foyer : i CHAUDRON ; 116,114 "FOYER"
saindoux dans le chaudron : i SAINDOUX ; 116,114 "CHAUDRON"
flambeau sur le foyer : i FLAMBEAU ; 116,114 ; s
chaudron d'huile : p 116,114
porte derrière les planches : g 35,92 @EMAJ1004
corde : p 132,87 "Corde"
corde sur les planches : i CORDE ; i PLANCHES ; s
crâne : 57,34 "Crâne"
fermer le crâne : 29,9
huile dans l'écuelle : i CHAUDRON ; 170,77 "ECUELLE" ; s
bague sur le chaudron : i BAGUE ; i CHAUDRON ; s
boule dans l'orbite du crâne : i BOULE CUIVRE ; 57,34 ; 45,36 "ORBITE"
pierre de lune (gros plan) : p 58,76 "Pierre"
pierre de lune : p 115,94
tibia dans l'orifice : i TIBIA ; 65,70 "ORIFICE"
huile sur le tibia : 170,77 "Ecuelle" ; 56,58 "TIBIA" ; s
levier : 58,76 "Levier"
boule de cuivre : p 45,36 "Boule de cuivre"
fermer le crâne : 29,9
retour au précipice : g 304,52 @EMAJ1003
planches liées sur la pierre : i PLANCH.LIEES ; 141,88 "PIERRE"
vers la stèle : g 154,49 @EMAJ1005
flambeau sur le support : i FLAMBEAU ; 139,107 "PORTE-FLAMME"
crâne : 32,57 "Crâne"
pierre de soleil (gros plan) : p 30,59 "Pierre"
pierre de soleil : p 26,63
tibia : p 98,139 "Tibia"
lance : p 218,113 "Lance"
tibia sur la lance : i TIBIA ; i LANCE ; s
tibia et lance sur le rideau : i TIBIA LANCE ; 94,45 "RIDEAU" ; s
tibia et lance sur les mûres : i TIBIA LANCE ; 94,45 "MURES" ; s
flûte (Urm) : i FLUTE ; c WEEN ; s
mûres à Urm : i MURES ; 151,74 "URM"
pouvoirs d'Urm sur le trou : 259,57 ; 259,57 "TROU"
message : 160,170
clef : p 217,146 "Clef"
clef dans la serrure : i CLEF ; 274,93 "SERRURE"
par la porte : g 267,81 @EMAJ1006
épée scellée : 35,72 "Epée" ; ok ; ok ; ok ; ok
crochet derrière l'épée, épée sur la statue : 53,86 "Crochet" ; 35,72 "Epée" ; 218,90 "STATUE" ; ok ; s
trappe : 213,123 "Trappe"
boule et bague (chaudron) : i BOULE CUIVRE ; i BAGUE ; s
chaudron sur l'acide : i CHAUDRON ; 213,123 "ACIDE" ; ok
acide 2 : 213,123 "ACIDE" ; ok
acide 3 : 213,123 "ACIDE" ; ok ; s
mécanisme : 234,127 "Mécanisme"
soleil et lune relevés, couronne : 221,111 "Touche" ; 221,138 ; 257,112 ; ok
cache : 185,55 "Cache"
élixir : p 184,70 "Elixir"
mécanisme : 234,127 "Mécanisme"
épée et lune enfoncées, couronne : 185,112 "Touche" ; 221,138 ; 257,112 ; ok
cache : 192,73 "Cache"
effigie : p 187,65 "Effigie"
vers la stèle : g 11,123 @EMAJ1005
Borgol : 163,134 "Borgol" ; ok*
stèle (gros plan) : 168,120 "Stèle" ; ok*
pierre de soleil dans la niche : i PIERRE SOLEIL ; 162,92 "NICHE" ; ok*
pierre de lune dans la niche : i PIERRE LUNE ; 162,92 "PIERRE" ; ok*
acide sur les stalactites de la niche : i CHAUDRON ; 193,92 ; s
effigie dans la niche (premier grain de sable) : i EFFIGIE ; 193,92 "NICHE" ; ok* ; t EMAJ1007
# Chapitre 2 : pont, sous l'eau, temple, dragon, labyrinthe
pont (monstre) : 37,72 "Corniche" ; ok*
plume : p 92,139 "Plume"
plume sur le coffre : i PLUME ; 251,135 "COFFRE" ; ok*
parchemin : 243,126 "Parchemin" ; ok*
venin : p 261,130 "Venin"
pollen : p 255,139 "Pollen"
venin dans le chaudron : i VENIN ; i CHAUDRON ; ok* ; s
pollen dans le chaudron : i POLLEN ; i CHAUDRON ; ok* ; s
fermer le coffre : 233,94
potion de croissance sur les feuilles : i CHAUDRON ; 284,134 "FEUILLES" ; ok* ; s
fraisier : 284,134 "Fraisier" ; ok*
fraises : p 288,120 ; ok*
flûte (Urm) : i FLUTE ; c WEEN ; s ; ok*
fraises à Urm : i FRAISES ; 151,74 "URM" ; ok*
or : p 131,132 "Or"
or sur la demi-statuette : i OR ; i 1/2 STATUETTE ; ok* ; s
statuette sur l'eau (sous l'eau) : i STATUETTE ; 183,90 "EAU" ; ok* ; t EMAJ1011
escalier : 278,100 "Escalier" ; ok*
escalier (insecte) : 278,100 "Escalier" ; ok*
insecte : 309,49 "Insecte" ; ok*
insecte sur les algues : 75,110 "ALGUES" ; ok*
verre sur le poisson : 190,136 "Verre" ; 29,135 "POISSON" ; ok* ; s
barre d'airain : p 43,138 "Barre" ; ok*
fermer : 12,107
escalier (fissure) : 278,100 "Escalier" ; ok*
barre dans la fissure : i AIRAIN ; 294,105 "FISSURE" ; ok*
barre sur le petit trou : 239,94 "PETIT TROU" ; ok* ; s
escalier (pics coincés) : 278,100 "Escalier" ; ok*
algues : 75,110 "Algues" ; ok*
arêtes (gros plan) : 243,126 "Arêtes" ; ok*
pointe de harpon : p 244,134 "Pointe" ; ok*
pointe sur la barre (harpon) : i FER DE LANCE ; i AIRAIN ; ok* ; s
algues (poisson) : 75,110 "Algues" ; ok*
harpon sur le poisson : i HARPON ; 53,120 "POISSON" ; ok*
harpon et poisson sur les pics : 278,100 "PICS" ; ok*
sortie (Opale) : g 278,100 ; ok*
# Entrée du temple (EMAJ1012)
venin sur le serpent : i VENIN ; 108,129 "SERPENT" ; ok* ; s
flambeau sur les ronces : 192,69 "Flambeau" ; 127,97 "RONCES" ; ok* ; s
diadème : p 132,131 "Diadème" ; ok*
bague sur le chaudron : i BAGUE ; i CHAUDRON ; ok* ; s
diadème sur la boule (tuyau) : i DIADEME ; i BOULE CUIVRE ; ok* ; s
tuyau sur le piège (il tombe) : i TUYAU ; 53,7 "PIEGE" ; ok* ; s
piège : p 74,133 "Piège" ; ok*
piège sur les guêpes : i PIEGE GUEP. ; 149,62 "GUEPES" ; ok* ; s
porte du temple (dragon) : g 135,70 ; ok! ; ok*
parchemin du bas ×5 (le dragon devient guêpe) : 27,143 "Parchemin" ; ok* ; 27,143 ; ok* ; 27,143 ; ok* ; 27,143 ; ok* ; 27,143 ; ok*
piège sur la guêpe : i PIEGE GUEP. ; 222,57 "GUEPE" ; ok* ; s
cerises : p 35,82 "Cerises" ; ok*
flûte (Urm) : i FLUTE ; c WEEN ; s ; ok*
cerises à Urm : i CERISES ; 153,81 ; ok*
pouvoirs d'Urm sur le piège : 222,57 "PIEGE" ; ok*
sortie (deuxième grain de sable) : g 288,44 ; ok*
# Labyrinthe (EMAJ1014)
Borgol : 159,144 "Borgol" ; ok*
tablette près de l'inscription : i TABLETTE ; 21,126 "INSCRIPTION" ; ok* ; s
mécanisme de gauche : 40,112 "Mécanisme" ; ok*
arc, chèvre, chaudron, rôti : 36,29 "Touche" ; 56,29 ; 36,49 ; 56,49 ; ok*
levier : 46,128 "Levier" ; ok*
porte de gauche : g 84,104 ; ok*
mécanisme : 117,111 "Mécanisme" ; ok*
fiole : p 114,128 "Fiole" ; ok*
code de la porte (tiré au hasard) : code 104,29 124,29 104,49 124,49 levier 114,128 ; ok*
levier : 114,128 "Levier" ; ok*
porte (vers la Gardienne) : g 160,104 ; ok*
# Chapitre 3 : Gardienne, sanctuaire, couloirs
Gardienne : 110,117 "Gardienne" ; ok*
gargouille sur la cimaise : 85,151 "Gargouille" ; 184,96 "CIMAISE" ; ok* ; s
écu : p 208,128 "Ecu" ; ok*
marteau : p 193,140 "Marteau" ; ok*
tas de bois sur le foyer : 295,140 "Tas de bois" ; 179,118 "FOYER" ; ok* ; s
fiole dans l'enclave : i FIOLE ; 208,128 "ENCLAVE" ; ok* ; s
fontaine (gros plan) : 266,80 "Fontaine" ; ok*
lichen : p 266,88 "Lichen" ; ok*
fermer : 224,52
lichen sur le foyer : i LICHEN ; 179,118 "FOYER" ; ok* ; s
fontaine (dents) : 266,80 "Fontaine" ; ok*
dents 12, 4, 6, 3 : 290,79 "Dent" ; 289,93 ; 240,79 ; 243,92 ; ok*
feuilles : p 309,90 "Feuilles" ; ok*
loupe (reste en place) : p 246,149 "Loupe" ; ok*
marteau sur le bras : i MARTEAU ; 44,88 "BRAS" ; ok* ; s
amphore sur le foyer : 119,152 "Amphore" ; 179,118 "FOYER" ; ok* ; s
chiffon : p 54,46 "Chiffon" ; ok*
chiffon dans l'eau : i CHIFFON ; 276,107 "EAU" ; ok*
chiffon mouillé sur la tête (gros plan) : 54,46 "TETE" ; ok*
chiffon sur l'œil : 47,41 "OEIL" ; ok* ; s
pollen sur un œil (fleur) : i POLLEN ; 47,41 "QUARTZ" ; ok* ; s
venin sur l'autre (serpent) : i VENIN ; 78,40 "QUARTZ" ; ok* ; s
tuyau sur le serpent (serpentin) : i TUYAU ; 78,40 "SERPENT" ; ok* ; s
fleur : p 47,41 "Fleur" ; ok*
fermer : 14,19
fleur sur le foyer : i FLEUR ; 179,118 "FOYER" ; ok* ; s
serpentin sur les gargouilles : i SERPENTIN ; 199,84 "GARGOUILLES" ; ok* ; s
pierre (faisceau) : 136,87 "Pierre" ; ok*
feuilles sur le foyer : i FEUILLE ; 179,118 "FOYER" ; ok* ; s
chiffon mouillé sur le serpentin : i CHIF. MOUILLE ; 199,84 "SERPENTIN" ; ok* ; s
loupe sur le faisceau (philtre) : 246,149 "Loupe" ; 136,87 "FAISCEAU" ; ok* ; s
philtre sur la Gardienne : 208,128 "Philtre" ; 110,117 "GARDIENNE" ; ok*
serpentin (tuyau, troisième grain) : p 199,84 "Serpentin" ; ok*
diadème sur le tuyau (boule) : i DIADEME ; i TUYAU ; ok* ; s
boule sur la statue : i BOULE CUIVRE ; 114,109 "STATUE" ; ok*
boule reprise : 114,109 ; ok* ; s
vers le sanctuaire : g 84,89 ; ok*
# Sanctuaire (EMAJ1020)
collier : p 128,133 "Collier" ; ok*
gant : p 60,76 "Gant" ; ok*
coffre : 71,114 "Coffre" ; ok*
gant sur les mygales : i GANT ; 49,107 "MYGALES" ; ok*
gant sur le cœur : 66,119 "COEUR" ; ok* ; s
cœur dans l'emplacement : i COEUR ; 216,47 "EMPLACEMENT" ; ok* ; s
calice sur la balance : 130,135 "Calice" ; 199,95 "BALANCE" ; ok* ; s
nez : 195,30 "Nez" ; ok*
tentures : 117,108 "Tentures" ; ok*
potiche (gros plan) : 189,118 "Potiche" ; ok*
clef : p 204,113 "Clef" ; ok*
fermer : 176,83
miroirs : p 117,108 "Miroirs" ; ok*
passage (porte) : 241,95 "Passage" ; ok*
miroirs dans la fente : i MIROIRS ; 234,84 "FENTE" ; ok* ; s
clef dans la serrure : i CLEF ; 261,89 "SERRURE" ; ok* ; s
porte (Opale, couloirs) : g 253,88 ; ok*
porte de gauche : g 68,81 ; ok*
dialogue : d
collier sur la boule (épée) : i COLLIER ; i BOULE CUIVRE ; ok* ; s
épée dans l'orifice : i EPEE ; 121,22 "ORIFICE" ; ok* ; s
éclair : p 120,150 "Eclair" ; ok*
épée : p 121,22 "Epée" ; ok*
éclair sur le trou du puits (coffre) : i ECLAIR ; 213,112 "TROU" ; ok* ; s
filet : p 143,117 "Filet" ; ok*
cerclage : p 266,144 "Cerclage" ; ok*
vers la rivière : g 269,90 ; ok*
grillage (piège vide) : 88,134 "Grillage" ; ok*
filet sur la rivière : i FILET ; 182,127 "RIVIERE" ; ok* ; s
poisson dans le piège : i POISSON ; 88,134 "PIEGE" ; ok* ; s
grillage sur le cerclage (tamis) : 36,136 "Grillage" ; i CERCLAGE ; ok* ; s
tamis sur la rivière (pépites) : i TAMIS ; 182,127 "RIVIERE" ; ok* ; s
piège (crabe) : 88,134 "Piège" ; ok* ; s
retour : g 20,83 ; ok*
crabe sur le coffre (chaîne) : i CRABE ; 233,107 "COFFRE" ; ok* ; s
épée sur le coffre : i EPEE ; 233,107 "COFFRE" ; ok* ; s
clef : p 235,88 "Clef" ; ok*
fermer : 184,55
clef dans la serrure : i CLEF ; 168,120 "SERRURE" ; ok* ; s
soleil : p 168,120 "Soleil" ; ok*
pépites sur le socle : i PEPITES ; 64,145 "SOCLE" ; ok* ; s
éclair sur le socle : i ECLAIR ; 64,145 "SOCLE" ; ok* ; s
soleil sur le socle : i SOLEIL ; 64,145 "SOCLE" ; ok* ; s
# Chapitre 4 : escalier, plage, bateau
écuelle sur la résine : 144,127 "Ecuelle" ; 6,102 "RESINE"
résine sur la fleur : 139,108 "FLEUR" ; ok*
ranger l'écuelle : r 160,120
corne sur le bois : 276,108 "Corne" ; 286,92 "BOIS" ; ok*
liane sur la corne et le bois (pioche) : 183,66 "Liane" ; 286,92 "CORNE ET BOIS" ; ok*
pioche sous le rocher (source) : 286,92 "Pioche" ; 42,148 ; ok*
pot sur la source : 307,104 "Pot" ; 42,148 "SOURCE" ; ok*
eau sur les champignons (géants) : 42,100 "CHAMPIGNONS" ; ok*
ranger le pot : r 160,120
œil du crâne : 280,141 "Oeil" ; ok*
# (le moustique se prend dans la résine, puis l'oiseau vient le manger : tic des zones VAR(215), environ 200 délais d'attente)
attendre le moustique puis l'oiseau : w 1500
pierre : 93,117 "Pierre"
pierre sur l'oiseau : 139,108 ; ok*
œil (ver) : 280,141 ; ok*
ver : 257,123 "Ver" ; ok*
ver sur les champignons géants : 74,75 ; ok*
escalier dégagé : g 74,75 ; ok*
# Plage (EMAJ1026) : sans havresac, on tient un objet à la fois
monstre : 20,75 "Monstre" ; ok*
fraisier : 26,136 "Fraisier" ; ok*
fraises : 29,131 "Fraises" ; ok*
reposer les fraises : r 160,120
flûte : 137,152 "Flûte" ; ok*
flûte sur Ween (Urm) : c WEEN ; ok*
reposer la flûte : r 160,60
fraises à Urm : i FRAISES ; 151,74 "URM" ; ok*
or : 91,101 "Or" ; ok*
or sur le monstre (havresac) : 20,75 "MONSTRE" ; ok*
havresac : p 20,75 "Havresac" ; ok*
rame : p 71,107 "Rame" ; ok*
rame dans l'encoche : i RAME ; 224,112 "ENCOCHE" ; ok* ; s
filet : p 124,114 "Filet" ; ok*
filet sur la mer : i FILET ; 172,82 "MER" ; ok* ; s
collier sur la boule (épée) : i COLLIER ; i BOULE CUIVRE ; ok* ; s
épée sur le poisson (œufs) : i EPEE ; i POISSON ; ok* ; s
œufs à l'araignée (voile) : i OEUFS ; 272,137 "ARAIGNEE" ; ok*
voile : p 279,145 "Toile" ; ok*
épée sur le bambou : i EPEE ; 256,21 "BAMBOU" ; ok* ; s
bambou sur le bateau (mât) : i BAMBOU ; 172,116 "BATEAU" ; ok*
voile sur le mât : i VOILE ; 180,78 "MAT" ; ok*
arceaux : 47,66 "Arceaux" ; ok*
marteau sur les arceaux : i MARTEAU ; 47,66 "ARCEAUX" ; ok*
arceaux sur le bateau (flotteurs) : 172,116 "BATEAU" ; ok*
noix de coco : 87,27 "Cocotier" ; ok*
noix : 97,65 "Noix de coco" ; ok*
noix sur les nasses (flotteurs) : 188,138 "NASSES" ; ok* ; s
collier sur l'épée (boule) : i COLLIER ; i EPEE ; ok* ; s
diadème sur la boule (tuyau) : i DIADEME ; i BOULE CUIVRE ; ok* ; s
nasses sur les arceaux (départ) : i NASSES ; 192,118 "ARCEAUX" ; ok*
# Bateau (EMAJ1027) : la fuite
marteau sur le cadenas : i MARTEAU ; 184,94 "CADENAS" ; ok* ; s
soute : 187,85 "Soute" ; ok*
goudron : p 184,75 "Goudron" ; ok*
tuyau sur la bouteille (bouchon) : i TUYAU ; 304,116 "BOUTEILLE" ; ok* ; s
bouchon : p 286,81 "Bouchon" ; ok*
goudron sur le bouchon : i GOUDRON ; i BOUCHON ; ok* ; s
bouchon englué dans le trou : i BOUCHON ENG. ; 212,121 "TROU" ; ok* ; s
marteau sur le bouchon : i MARTEAU ; 212,121 ; ok*
# Plage de l'Ile du Volcan (EMAJ1028)
clef : p 37,142 "Clef" ; ok*
clef dans la serrure : i CLEF ; 263,110 "SERRURE" ; ok* ; s
cabane : g 264,107 ; ok*
# Cabane du vieillard (EMAJ1029)
pelle : p 79,97 "Pelle" ; ok*
sortie : g 54,66 ; ok*
# Plage : huit trous, un objet dans chacun (gros plan)
pelle sur le sable 80,134 : i PELLE ; 80,134 "SABLE" ; ok* ; s
pelle sur le sable 83,147 : i PELLE ; 83,147 "SABLE" ; ok* ; s
pelle sur le sable 113,150 : i PELLE ; 113,150 "SABLE" ; ok* ; s
pelle sur le sable 152,151 : i PELLE ; 152,151 "SABLE" ; ok* ; s
pelle sur le sable 201,127 : i PELLE ; 201,127 "SABLE" ; ok* ; s
pelle sur le sable 218,139 : i PELLE ; 218,139 "SABLE" ; ok* ; s
pelle sur le sable 205,152 : i PELLE ; 205,152 "SABLE" ; ok* ; s
pelle sur le sable 233,152 : i PELLE ; 233,152 "SABLE" ; ok* ; s
trou 1 : 80,134 "Trou" ; ok*
œil : p 81,127 "Oeil" ; ok*
trou 2 : 83,147 "Trou" ; ok*
lingot : p 81,137 "Lingot" ; ok*
trou 3 : 113,150 "Trou" ; ok*
arêtes : p 113,137 "Arêtes" ; ok*
trou 4 : 152,151 "Trou" ; ok*
diamant : p 149,140 "Diamant" ; ok*
trou 5 : 201,127 "Trou" ; ok*
sandale : p 201,115 "Sandale" ; ok*
trou 6 : 218,139 "Trou" ; ok*
bijoux : p 217,134 "Bijoux" ; ok*
diadème sur le tuyau (boule) : i DIADEME ; i TUYAU ; ok* ; s
collier sur la boule (épée) : i COLLIER ; i BOULE CUIVRE ; ok* ; s
trou 7 : 205,152 "Trou" ; ok*
épée sur l'huître : i EPEE ; 201,137 ; ok*
ranger l'épée : s
perle : p 201,137 "Perle" ; ok*
cabane : g 264,107 ; ok*
# Cabane : Urm (or), les neuf aumônes, anneau, planches
fraises : 28,103 "Fraises" ; ok*
reposer les fraises : r 160,60
flûte sur Ween (Urm) : i FLUTE ; c WEEN ; ok*
ranger la flûte : s
fraises à Urm : 28,103 "Fraises" ; 151,74 "URM" ; ok*
or : p 238,53 "Or" ; ok*
or au vieillard : i OR ; 199,102 "VIEILLARD" ; ok* ; s
œil au vieillard : i OEIL ; 199,102 "VIEILLARD" ; ok* ; s
arêtes au vieillard : i ARETES ; 199,102 "VIEILLARD" ; ok* ; s
diamant au vieillard : i DIAMANT ; 199,102 "VIEILLARD" ; ok* ; s
sandale au vieillard : i SANDALE ; 199,102 "VIEILLARD" ; ok* ; s
bijoux au vieillard : i BIJOUX ; 199,102 "VIEILLARD" ; ok* ; s
perle au vieillard : i PERLE ; 199,102 "VIEILLARD" ; ok* ; s
lingot au vieillard : i LINGOT ; 199,102 "VIEILLARD" ; ok* ; s
écu au vieillard : i ECU ; 199,102 "VIEILLARD" ; ok* ; s
anneau : 154,75 "Anneau" ; ok*
épée sur les planches : i EPEE ; 200,124 "PLANCHES" ; ok* ; s
par l'ouverture : g 200,124 ; ok*
# Chapitre 5 : Ile du Volcan. Jungle (EMAJ1030) : Orivor, pendule, arc, fée Nature
épée sur les branches : i EPEE ; 275,98 "BRANCHES" ; ok* ; s
épée sur la branche : i EPEE ; 25,119 "BRANCHE" ; ok* ; s
collier sur l'épée (boule) : i COLLIER ; i EPEE ; ok* ; s
bague sur la boule (chaudron) : i BAGUE ; i BOULE CUIVRE ; ok* ; s
chaudron sur un trou : i CHAUDRON ; 84,140 "TROU" ; ok* ; s
autre trou (Orivor) : 260,137 "Trou" ; ok*
pendule : 173,134 "Pendule" ; ok*
pendule au centre : !m 143,121 ; w 20
ranger le pendule : s
chaudron : 84,140 "Chaudron" ; ok*
ranger le chaudron : s
bague sur le chaudron (boule) : i BAGUE ; i CHAUDRON ; ok* ; s
collier sur la boule (épée) : i COLLIER ; i BOULE CUIVRE ; ok* ; s
épée sur l'herbe (or) : i EPEE ; 143,121 ; ok* ; s
or : 143,121 "Or" ; ok*
or à l'Orivor : 260,137 ; ok*
corde : 103,142 "Corde" ; ok*
corde sur la branche (arc) : 25,119 "BRANCHE" ; ok*
arc : 25,119 ; ok*
arc sur la noix (l'oiseau) : 100,8 ; ok*
ranger l'arc : s
collier sur l'épée (boule) : i COLLIER ; i EPEE ; ok* ; s
diadème sur la boule (tuyau) : i DIADEME ; i BOULE CUIVRE ; ok* ; s
tuyau sur les plumes : i TUYAU ; 198,133 "PLUMES" ; ok*
plumes sur les flèches : 296,126 "FLECHES" ; ok*
arc : 25,119 "Branche" ; ok*
arc sur la noix : 100,8 ; ok*
ranger l'arc : s
diadème sur le tuyau (boule) : i DIADEME ; i TUYAU ; ok* ; s
collier sur la boule (épée) : i COLLIER ; i BOULE CUIVRE ; ok* ; s
épée sur la noix (fée) : i EPEE ; 102,120 "NOIX D'YX" ; ok*
# Entrée du volcan (EMAJ1031) : vieillard pétrifié par Urm, potions du chaudron
canne sur l'œil de verre : 148,146 "Canne" ; 201,147 "OEIL" ; ok*
vieillard : 204,99 "Vieillard" ; ok*
fraises : 269,100 "Fraises" ; ok*
reposer les fraises : r 160,60
flûte sur Ween (Urm) : i FLUTE ; c WEEN ; ok*
ranger la flûte : s
fraises à Urm : i FRAISES ; 151,74 "URM" ; ok*
or : p 170,106 "Or" ; ok*
or au vieillard : i OR ; 204,99 "VIEILLARD" ; ok* ; s
canne sur l'œil de verre : 148,146 "Canne" ; 201,147 "OEIL" ; ok*
myrtilles : p 7,147 "Myrtilles" ; ok*
flûte sur Ween (Urm) : i FLUTE ; c WEEN ; ok* ; s
myrtilles à Urm : i MYRTILLES ; 151,74 "URM" ; ok*
Urm sur le vieillard : 204,99 "VIEILLARD" ; ok*
plume : p 260,152 "Plume" ; ok*
plume sur le coffre : i PLUME ; 96,138 "COFFRE" ; ok*
fioles : 96,138 "Fioles" ; ok*
ranger le pollen : s
venin : p 96,138 "Fiole" ; ok*
collier sur l'épée (boule) : i COLLIER ; i EPEE ; ok* ; s
bague sur la boule (chaudron) : i BAGUE ; i BOULE CUIVRE ; ok* ; s
pollen dans le chaudron : i POLLEN ; i CHAUDRON ; ok* ; s
venin dans le chaudron (croissance) : i VENIN ; i CHAUDRON ; ok* ; s
potion sur les champignons : i CHAUDRON ; 38,138 "CHAMPIGNONS" ; ok* ; s
truffes : p 150,120 "Truffes" ; ok*
pollen dans le chaudron : i POLLEN ; i CHAUDRON ; ok* ; s
venin dans le chaudron (croissance) : i VENIN ; i CHAUDRON ; ok* ; s
potion sur l'herbe : i CHAUDRON ; 128,106 "HERBE" ; ok* ; s
camomille : p 128,106 "Camomille" ; ok*
truffe dans le chaudron : i TRUFFE ; i CHAUDRON ; ok* ; s
venin dans le chaudron (luciferys) : i VENIN ; i CHAUDRON ; ok* ; s
luciferys sur le rubis : i CHAUDRON ; 89,109 "RUBIS" ; ok* ; s
chaudron sur l'eau : i CHAUDRON ; 261,126 "EAU" ; ok* ; s
chaudron sur le foyer : i CHAUDRON ; 89,109 "FOYER" ; ok* ; s
camomille dans le chaudron (infusion) : i CAMOMILLE ; 89,109 ; ok* ; s
infusion : 89,109 "Chaudron" ; ok*
infusion sur le ver : 283,133 "VER" ; ok* ; s
ver : 283,133 "Ver" ; ok*
ver sur les champignons : 39,114 "CHAMPIGNONS" ; ok*
porte : g 31,82 ; ok*
# Porte cachée (EMAJ1032) : buisson, quartz, pistil, Borgol
bague sur le chaudron (boule) : i BAGUE ; i CHAUDRON ; ok* ; s
collier sur la boule (épée) : i COLLIER ; i BOULE CUIVRE ; ok* ; s
épée sur le buisson : i EPEE ; 93,95 "BUISSON" ; ok* ; s
pollen sur le quartz : i POLLEN ; 198,128 "QUARTZ" ; ok* ; s
fleur : 198,128 "Fleur" ; ok*
pistil : p 199,112 "Pistil" ; ok*
collier sur l'épée (boule) : i COLLIER ; i EPEE ; ok* ; s
bague sur la boule (chaudron) : i BAGUE ; i BOULE CUIVRE ; ok* ; s
truffe dans le chaudron : i TRUFFE ; i CHAUDRON ; ok* ; s
pollen dans le chaudron (vitalys) : i POLLEN ; i CHAUDRON ; ok* ; s
vitalys sur Borgol : i CHAUDRON ; 91,145 "BORGOL" ; ok* ; s
# Roi des fourmis (EMAJ1033 : les trois grains), mécanisme d'EMAJ1031 (clef), grille, serpents, rubis, flammes
attendre la fourmi : w 300
fourmi : 264,14 "Fourmis" ; ok*
pistil à la fourmi : i PISTIL ; 264,14 ; ok*
grain de sable : p 5,90 "Grain de sable" ; ok*
grain de sable : p 313,142 "Grain de sable" ; ok*
axe : p 61,149 "Axe" ; ok*
troisième grain : p 61,149 "Grain de sable" ; ok*
truffe dans le chaudron : i TRUFFE ; i CHAUDRON ; ok* ; s
pollen dans le chaudron (vitalys) : i POLLEN ; i CHAUDRON ; ok* ; s
vitalys sur la statue : i CHAUDRON ; 231,88 "STATUE" ; ok* ; s
levier : 231,88 "Levier" ; ok*
vers la droite : g 306,109 ; ok*
mécanisme : 153,71 "Mécanisme" ; ok*
axe dans l'orifice : i AXE ; 137,61 "ORIFICE" ; ok* ; s
levier : 144,67 "Levier" ; ok*
clef : p 167,71 "Clef" ; ok*
fermer : 130,54
vers la gauche : g 31,82 ; ok*
clef dans la serrure : i CLEF ; 111,101 "SERRURE" ; ok* ; s
pollen dans le chaudron : i POLLEN ; i CHAUDRON ; ok* ; s
venin dans le chaudron : i VENIN ; i CHAUDRON ; ok* ; s
truffe dans le chaudron (morphosys) : i TRUFFE ; i CHAUDRON ; ok* ; s
morphosys sur la grille : i CHAUDRON ; 93,95 "GRILLE" ; ok* ; s
venin sur les serpents : i VENIN ; 93,95 "SERPENTS" ; ok* ; s
venin dans le chaudron : i VENIN ; i CHAUDRON ; ok* ; s
truffe dans le chaudron (luciferys) : i TRUFFE ; i CHAUDRON ; ok* ; s
luciferys sur les rubis : i CHAUDRON ; 93,95 "RUBIS" ; ok* ; s
vers la droite : g 306,109 ; ok*
chaudron sur l'eau : i CHAUDRON ; 261,126 "EAU" ; ok* ; s
vers la gauche : g 31,82 ; ok*
eau sur les flammes : i CHAUDRON ; 93,95 "FLAMMES" ; ok* ; s
porte : g 93,95 ; ok*
# Intérieur du volcan (EMAJ1034) : ornement et rubis de la statue, glu, lucioles dans les cinq niches
écuelle : p 261,149 "Ecuelle" ; ok*
ornement : 239,52 "Ornement" ; ok*
bague sur le chaudron (boule) : i BAGUE ; i CHAUDRON ; ok* ; s
collier sur la boule (épée) : i COLLIER ; i BOULE CUIVRE ; ok* ; s
épée sur l'ornement : i EPEE ; 239,52 "ORNEMENT" ; ok* ; s
bijou cassé : p 144,151 "Bijou cassé" ; ok*
épée sur le trou (1) : i EPEE ; 239,52 "TROU" ; ok* ; s
épée sur le trou (2) : i EPEE ; 239,52 "TROU" ; ok* ; s
épée sur le trou (3) : i EPEE ; 239,52 "TROU" ; ok* ; s
épée sur le trou (4) : i EPEE ; 239,52 "TROU" ; ok* ; s
collier sur l'épée (boule) : i COLLIER ; i EPEE ; ok* ; s
bague sur la boule (chaudron) : i BAGUE ; i BOULE CUIVRE ; ok* ; s
venin dans le chaudron : i VENIN ; i CHAUDRON ; ok* ; s
truffe dans le chaudron (luciferys) : i TRUFFE ; i CHAUDRON ; ok* ; s
luciferys (gros plan du trou) : 239,52 "Trou" ; ok*
luciferys sur le rubis : i CHAUDRON ; 242,54 "RUBIS" ; ok* ; s
bijou : p 242,54 "Bijou" ; ok*
niche de droite (1) : 246,96 "Niche" ; ok*
niche de droite (2) : 246,96 "Niche" ; ok*
niche de droite (3) : 246,96 "Niche" ; ok*
niche de droite (4) : 246,96 "Niche" ; ok*
niche (gros plan) : 242,93 "Niche" ; ok*
écuelle sur la glu : i ECUELLE ; 240,117 "GLU" ; ok* ; s
pollen dans le chaudron : i POLLEN ; i CHAUDRON ; ok* ; s
truffe dans le chaudron (vitalys) : i TRUFFE ; i CHAUDRON ; ok* ; s
trou (gros plan) : 239,52 "Trou" ; ok*
bijou (gros plan) : 242,54 "Bijou" ; ok*
vitalys sur le bijou (luciole) : i CHAUDRON ; 242,61 ; ok*
ranger le chaudron : s
bague sur le chaudron (boule) : i BAGUE ; i CHAUDRON ; ok* ; s
collier sur la boule (épée) : i COLLIER ; i BOULE CUIVRE ; ok* ; s
épée sur la fissure : i EPEE ; 12,127 "FISSURE" ; ok* ; s
luciole : p 18,135 "Luciole" ; ok*
glu sur la luciole : i GLU ; i LUCIOLE ; ok* ; s
niche (gros plan) : 193,96 "Niche" ; ok*
luciole engluée dans la niche : i LUCIOLE/GLU ; 187,92 "NICHE" ; ok* ; s
niche (gros plan) : 193,96 "Niche" ; ok*
collier sur l'épée (boule) : i COLLIER ; i EPEE ; ok* ; s
niche (gros plan) : 193,96 "Niche" ; ok*
boule dans le trou : i BOULE CUIVRE ; 204,87 "TROU" ; ok*
boule (bijou) : 204,87 "Boule de cuivre" ; ok*
ranger la boule : s
niche (gros plan) : 193,96 ; ok*
bijou : 197,107 "Bijou" ; ok*
bague sur la boule (chaudron) : i BAGUE ; i BOULE CUIVRE ; ok* ; s
pollen dans le chaudron : i POLLEN ; i CHAUDRON ; ok* ; s
truffe dans le chaudron (vitalys) : i TRUFFE ; i CHAUDRON ; ok* ; s
niche (gros plan) : 193,96 "Niche" ; ok*
bijou (gros plan) : 197,107 "Bijou" ; ok*
vitalys sur le bijou (luciole) : i CHAUDRON ; 194,96 ; ok* ; s
luciole : p 18,135 "Luciole" ; ok*
glu sur la luciole : i GLU ; i LUCIOLE ; ok* ; s
niche de droite : 246,96 "Niche" ; ok*
luciole engluée dans la niche : i LUCIOLE/GLU ; 242,93 "NICHE" ; ok* ; s
niche de droite : 246,96 "Niche" ; ok*
brindille : 226,105 "Brindille" ; ok*
fermer : 219,68 ; ok*
brindille dans l'orifice : 227,68 "ORIFICE" ; ok*
pollen dans le chaudron : i POLLEN ; i CHAUDRON ; ok* ; s
truffe dans le chaudron (vitalys) : i TRUFFE ; i CHAUDRON ; ok* ; s
bijou (gros plan) : 226,142 "Bijou" ; ok*
vitalys sur le bijou (luciole) : i CHAUDRON ; 226,137 ; ok* ; s
bague sur le chaudron (boule) : i BAGUE ; i CHAUDRON ; ok* ; s
collier sur la boule (épée) : i COLLIER ; i BOULE CUIVRE ; ok* ; s
épée sur la fissure : i EPEE ; 12,127 "FISSURE" ; ok* ; s
luciole : p 18,135 "Luciole" ; ok*
glu sur la luciole : i GLU ; i LUCIOLE ; ok* ; s
niche (pilier du fond à gauche) : 90,87 "Niche" ; ok*
luciole engluée dans la niche : i LUCIOLE/GLU ; 97,84 "NICHE" ; ok* ; s
niche (pilier du fond à gauche) : 90,87 "Niche" ; ok*
bijou brisé (gros plan) : 87,100 "Bijou brisé"
bijou brisé : p 106,115 "Bijou brisé" ; ok*
bijou cassé (gros plan) : 144,151 "Bijou cassé"
bijou cassé : p 144,140 "Bijou cassé" ; ok*
glu sur le bijou cassé : i GLU ; i BIJOU CASSE ; ok* ; s
bijou brisé sur le bijou cassé (bijou) : i BIJOU BRISE ; i BIJOU CASSE ; ok* ; s
collier sur l'épée (boule) : i COLLIER ; i EPEE ; ok* ; s
bague sur la boule (chaudron) : i BAGUE ; i BOULE CUIVRE ; ok* ; s
pollen dans le chaudron : i POLLEN ; i CHAUDRON ; ok* ; s
truffe dans le chaudron (vitalys) : i TRUFFE ; i CHAUDRON ; ok* ; s
vitalys sur le bijou (luciole) : i CHAUDRON ; i BIJOU ; w 100 ; s
luciole : p 18,135 "Luciole" ; ok*
glu sur la luciole : i GLU ; i LUCIOLE ; ok* ; s
niche (pilier du milieu à gauche) : 62,87 "Niche" ; ok*
fermer : 35,64
niche de gauche : 23,87 "Niche" ; ok*
luciole engluée dans la niche : i LUCIOLE/GLU ; 28,87 "NICHE" ; ok* ; s
niche de gauche : 23,87 "Niche" ; ok*
levier de gauche ×3 : 30,84 "Levier" ; ok* ; 30,84 ; ok* ; 30,84 ; ok*
fermer : 5,62
# Leviers : compteurs VAR(222) = 1, VAR(224) = 2, VAR(225) = 3, VAR(226) = 4, VAR(223) = 5 (niches du fond à gauche, du milieu, de gauche, de droite, du centre), puis KRAAL à l'arc
niche du milieu : 62,87 "Niche" ; ok*
levier ×2 : 58,87 "Levier" ; ok* ; 58,87 ; ok*
fermer : 35,64
niche de gauche : 23,87 "Niche" ; ok*
levier ×3 : 30,84 "Levier" ; ok* ; 30,84 ; ok* ; 30,84 ; ok*
fermer : 5,62
niche de droite : 246,96 "Niche" ; ok*
levier ×3 : 242,91 "Levier" ; ok* ; 242,91 ; ok* ; 242,91 ; ok*
fermer : 219,68
niche du centre : 193,96 "Niche" ; ok*
levier ×4 : 188,90 "Levier" ; ok* ; 188,90 ; ok* ; 188,90 ; ok* ; 188,90 ; ok*
fermer : 164,67
arc sur K : i ARC ; 122,37
arc sur R : 153,38
arc sur A : 99,22
arc sur A : 115,51
arc sur L : 106,37 ; ok*
# Chapitre 6 : prison (EMAJ1035) : cœur, clou, serrures (clou au 6e trou de droite, épingle sous le barreau, clou au 7e, épingle au 3e de gauche)
arrivée en prison : w 5
cœur : p 9,151 "Coeur" ; ok*
clou (1) : 6,103 "Clou" ; ok*
clou (a) : 26,102 "Clou" ; ok*
clou (b) : 26,102 "Clou" ; ok*
clou (c) : 26,102 "Clou" ; ok*
clou (d) : 26,102 "Clou" ; ok*
ranger le clou : s
serrure : 144,66 "Serrure" ; ok*
clou dans le 6e trou de droite : i CLOU ; 156,82 "TROU" ; ok*
aiguille de droite : 170,69 "Aiguille" ; ok*
épingle : p 126,132 "Epingle" ; ok*
clou : 156,82 "Clou" ; ok*
clou dans le 7e trou de droite : 151,70 "TROU" ; ok*
épingle dans le 3e trou de gauche : i EPINGLE ; 139,70 "TROU" ; ok*
aiguille de gauche : 118,69 "Aiguille" ; ok*
aiguille de droite : 170,69 "Aiguille" ; ok*
fermer : 97,49 ; ok*
sortie : g 107,67 ; ok*
# Revuss (EMAJ1036) : leviers de droite à gauche ×4, DJEL, cœur, flûte de bambou (Urm et la pierre), AZEULISSE, statue, grains dans le Revuss (GAGNEFX, EMAJ1END)
leviers : 102,129 "Leviers" ; ok*
levier de droite ×4 : 139,105 "Levier" ; ok* ; 139,105 ; ok* ; 139,105 ; ok* ; 139,105 ; ok*
levier du centre ×4 : 105,105 "Levier" ; ok* ; 105,105 ; ok* ; 105,105 ; ok* ; 105,105 ; ok*
levier de gauche ×4 : 61,105 "Levier" ; ok* ; 61,105 ; ok* ; 61,105 ; ok* ; 61,105 ; ok*
fermer les leviers : 55,88 ; ok*
gravure : 56,92 "Gravure" ; ok*
D : 21,115 ; ok*
J : 51,115 ; ok*
E : 29,115 ; ok*
L : 71,115 ; ok*
fermer : 15,112 ; ok*
niche : 56,82 "Niche" ; ok*
cœur dans l'orifice : i COEUR ; 61,94 "ORIFICE" ; ok* ; s
couteau : p 40,71 "Couteau" ; ok*
fermer : 17,59 ; ok*
bambou : p 132,134 "Bambou" ; ok*
couteau sur le bambou (flûte) : i COUTEAU ; i BAMBOU ; ok* ; s
couteau sur la flûte (accordée) : i COUTEAU ; i FLUTE ; w 150 ; ok* ; s
flûte sur Ween (Urm) : i FLUTE ; c WEEN ; ok*
ranger la flûte : s
pierre : 75,154 "Pierre"
pierre (gros plan) : p 72,137 ; ok*
gravure : 56,92 "Gravure" ; ok*
pierre dans le trou : i PIERRE ; 58,115 "TROU" ; ok* ; s
A : 58,115 ; ok*
Z : 83,114 ; ok*
E : 29,115 ; ok*
U : 36,115 ; ok*
L : 71,115 ; ok*
I : 64,114 ; ok*
S : 43,115 ; ok*
S : 43,115 ; ok*
E : 29,115 ; ok*
fermer : 15,112 ; ok*
statue : 298,144 "Statue" ; ok*
statue : p 273,131 "Statue" ; ok*
niche : 56,82 "Niche" ; ok*
statue dans la niche : i STATUE ; 52,84 ; ok*
grains de sable : 51,147 "3 grains de sable" ; ok*
grains dans le Revuss : 105,108 ; ok*
écran final : w 100
`;

export const STEPS: Step[] = parseSteps(SOLUTION);

/** Écran final du jeu, atteint à la fin de la solution. */
export const END_TOT = "EMAJ1END.TOT";
