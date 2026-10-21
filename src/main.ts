import { findGame, games } from "./games/registry";
import { renderHome } from "./ui/home";

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
