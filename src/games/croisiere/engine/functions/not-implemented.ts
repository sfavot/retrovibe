/** Fonction native ou routine du moteur pas encore portée (vagues F1 à F4, E, R2) : erreur explicite, jamais silencieuse. */
export class NotImplemented extends Error {
  constructor(readonly what: string) {
    super(`Croisière : ${what} n'est pas encore implémenté`);
    this.name = "NotImplemented";
  }
}
