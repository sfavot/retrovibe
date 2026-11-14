/**
 * Voix de *Beneath a Steel Sky* : numéro de texte → fichier de voix → lecture sur une voie, sans jamais bloquer la réplique.
 *
 * Référence : ScummVM engines/sky/sound.cpp (`Sound::startSpeech`, `stopSpeech`, `speechFinished`) et logic.cpp (`stdSpeak`, `LogicTalk`), GPL v3
 * ou ultérieure ; lu puis réécrit. Le numéro de texte devient un identifiant de fichier par `data/speech.ts` (`speechFileOfText`).
 *
 * Écarts volontaires :
 * - les voix sont des MP3 chargés à la demande (`VoiceBank`, `docs/bass/plan.md` D3) et non des PCM lus sur le disque : `start` rend vrai
 *   dès que le fichier existe dans la liste de l'hôte, la lecture commence quand le décodage est fini ;
 * - `finished()` reste faux pendant le chargement, mais au plus `LOAD_TIMEOUT_MS` (5 s) : un fichier perdu ou en retard ne bloque pas la
 *   réplique (la voie se libère, le sous-titre déjà affiché reste le seul support) ; un décodage raté la libère tout de suite ;
 * - les voix des sections 8 à 15 (hors table de ScummVM) n'existent pas : `start` rend faux ;
 * - la durée suit l'horloge du jeu, pas le son réel (`SampleChannel`) : voix muette ou contexte bloqué, la réplique dure autant.
 * - `start` ne coupe pas la voix en cours quand le fichier de la nouvelle manque (ScummVM n'arrête le flux qu'une fois le fichier trouvé).
 */

import { SampleChannel, type SamplePlayer } from "../../../audio/sample-channel";
import type { VoiceBank } from "../../../audio/voice-bank";
import { speechFileOfText } from "../data/speech";

export class BassSpeech {
  /** Voix autorisées (`SF_ALLOW_SPEECH`, réglage « voix » du panneau de contrôle) : sinon `start` rend faux. */
  allowed = true;
  private readonly channel: SampleChannel<number>;

  constructor(
    private readonly bank: VoiceBank<number>,
    output: SamplePlayer,
  ) {
    this.channel = new SampleChannel<number>(bank, output);
  }

  /** `startSpeech(textNum)` : vrai si une voix existe pour cette réplique et part (ou va partir, une fois chargée). */
  start(textNum: number): boolean {
    if (!this.allowed) return false;
    const file = speechFileOfText(textNum & 0xffff);
    if (file === undefined || !this.bank.has(file)) return false;
    return this.channel.play(file);
  }

  /** `speechFinished()` : plus de voix en cours (ni de chargement dans le délai borné). */
  finished(): boolean {
    return !this.channel.active;
  }

  /** `stopSpeech()` : coupe la voix en cours, ou annule son chargement. */
  stop(): void {
    this.channel.stop();
  }

  /** Précharge les voix de ces numéros de texte (celles qui existent) ; rend le nombre de voix prêtes. */
  preload(textNums: Iterable<number>): Promise<number> {
    const files: number[] = [];
    for (const textNum of textNums) {
      const file = speechFileOfText(textNum & 0xffff);
      if (file !== undefined) files.push(file);
    }
    return this.bank.preload(files);
  }
}
