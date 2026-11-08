import { findGame, games } from "./games/registry";
import { renderHome } from "./ui/home";

// Sur iPhone, Safari coupe le son des pages quand le téléphone est en mode silencieux (sauf pendant une vidéo) : un jeu se joue
// avec le son, comme une appli de lecture. API Audio Session de WebKit (Safari 16.4+), sans effet ailleurs.
const audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
if (audioSession) audioSession.type = "playback";

const container = document.getElementById("app")!;
// Route `#/<id>` : un jeu ; tout autre hash : la page d'accueil.
const game = findGame(location.hash.replace(/^#\/?/, ""));

// Un jeu installe ses propres écouteurs et minuteurs : changer de page recharge pour tout libérer.
window.addEventListener("hashchange", () => location.reload());

if (game) {
  document.title = game.title;
  void game.start(container);
} else {
  renderHome(container, games);
}
