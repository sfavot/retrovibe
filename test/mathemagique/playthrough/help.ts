import type { Robot } from "./robot";

/**
 * Session d'aide de Poly : ouvre l'aide, laisse jouer son arrivée et sa présentation, clique quelques zones, puis clique Poly jusqu'à ce
 * qu'elle parte. `active()` dit si l'aide est ouverte.
 */
export async function helpSession(
  r: Robot,
  label: string,
  open: readonly [number, number],
  active: () => boolean,
  poly: readonly [number, number],
  probes: readonly (readonly [number, number])[],
): Promise<void> {
  await r.click(open[0], open[1], 300);
  if (!(await r.tryUntil(active, 8000))) {
    r.problem("aide", `${label} : le bouton d'aide n'ouvre pas Poly`);
    return;
  }
  r.note(`${label} : aide de Poly ouverte`);
  for (const [x, y] of probes) {
    await r.run(6000);
    await r.click(x, y, 200);
    await r.run(3000);
  }
  for (let attempt = 0; attempt < 8 && active(); attempt++) {
    await r.run(8000);
    await r.click(poly[0], poly[1], 200);
    await r.tryUntil(() => !active(), 20_000);
  }
  if (active()) r.problem("bloqué", `${label} : l'aide de Poly ne se referme pas après plusieurs clics sur elle`);
  else await r.run(1500);
}
