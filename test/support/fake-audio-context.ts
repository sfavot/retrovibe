/** Faux `AudioContext` : enregistre les sources créées, sans rien jouer. */
export class FakeSource {
  buffer: { duration: number; sampleRate: number; length: number } | null = null;
  loop = false;
  started = false;
  stopped = false;
  onended: (() => void) | null = null;
  connect(): void {}
  disconnect(): void {}
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

export class FakeGain {
  gain = { value: 1 };
  connect(): void {}
}

export class FakeAudioContext {
  state: "suspended" | "running" | "closed";
  readonly destination = {};
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  resumes = 0;
  suspends = 0;
  closed = false;

  /** `autoplay` : démarre suspendu (politique des navigateurs) jusqu'à `resume()`. */
  constructor(autoplay = true) {
    this.state = autoplay ? "suspended" : "running";
  }

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createBuffer(_channels: number, length: number, sampleRate: number) {
    return { length, sampleRate, duration: length / sampleRate, getChannelData: () => new Float32Array(length) };
  }

  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  /** Octets reçus par `decodeAudioData`, et le tampon rendu (`decoded`, ou une erreur si `decodeFails`). */
  readonly decodedInputs: ArrayBuffer[] = [];
  decoded = { sampleRate: 44100, length: 4410, channels: 1 };
  decodeFails = false;

  async decodeAudioData(data: ArrayBuffer) {
    this.decodedInputs.push(data);
    if (this.decodeFails) throw new Error("EncodingError");
    const { sampleRate, length, channels } = this.decoded;
    const planes = Array.from({ length: channels }, (_, c) => new Float32Array(length).fill((c + 1) / 10));
    return { sampleRate, length, duration: length / sampleRate, numberOfChannels: channels, getChannelData: (c: number) => planes[c] };
  }

  async resume(): Promise<void> {
    this.resumes++;
    this.state = "running";
  }

  async suspend(): Promise<void> {
    this.suspends++;
    this.state = "suspended";
  }

  async close(): Promise<void> {
    this.closed = true;
    this.state = "closed";
  }

  asContext(): AudioContext {
    return this as unknown as AudioContext;
  }
}
