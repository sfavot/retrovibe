import "../../../ui/style.css";
import { mountApp } from "./app";

/** Page de développement : monte le jeu seul, hors de l'application (`/src/games/swiv3d/ui/dev.html`, niveau avec `?level=TERRAN01`). */
const level = new URLSearchParams(location.search).get("level") ?? undefined;
void mountApp(document.getElementById("app")!, { base: `${import.meta.env.BASE_URL}swiv3d`, level, debug: true });
