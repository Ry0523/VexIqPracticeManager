/** Web Audio timer scheduler with a monotonic display clock and visual-only fallback. */
(function (root) {
  "use strict";
  let context = null;
  let gain = null;
  let buffers = null;
  let sources = [];
  let starting = false;
  let generation = 0;
  let end = null;
  let fallback = false;
  let clock = null;
  // Countdown beats, in milliseconds before the run starts, matching the recorded official timer: the beats are
  // 0.75 s apart and the start sound plays the instant the clock begins at 1:00.
  const COUNTDOWN = Object.freeze([["countdown-3", 2384], ["countdown-2", 1634], ["countdown-1", 884]]);
  const COUNTDOWN_MS = COUNTDOWN[0][1];
  const LEAD_IN = "countdown-start";
  // The number to show while counting down (3, 2, or 1), given the time left before the run starts.
  const countdownNumber = msBeforeStart => Math.min(COUNTDOWN.length, COUNTDOWN.length + 1 - COUNTDOWN.filter(([, at]) => at >= msBeforeStart).length);

  function report(error) {
    root.timerAudioError(`Timer sound could not play: ${error.message}. The visual timer remains active.`);
  }

  function prepare() {
    if (buffers) return;
    const AudioContext = root.AudioContext || root.webkitAudioContext;
    if (!AudioContext) throw new Error("Web Audio is unavailable");
    const next = context || new AudioContext({ latencyHint: "interactive" });
    context = next;
    const clips = new Map();
    for (const [name, encoded] of Object.entries(root.TimerSoundData)) {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      const view = new DataView(bytes.buffer);
      let offset = 12;
      let format, data;
      while (offset + 8 <= bytes.length) {
        const type = String.fromCharCode(...bytes.slice(offset, offset + 4));
        const size = view.getUint32(offset + 4, true);
        if (type === "fmt ") format = offset + 8;
        if (type === "data") { data = { offset: offset + 8, size }; break; }
        offset += 8 + size + size % 2;
      }
      if (!format || !data || view.getUint16(format, true) !== 1 || view.getUint16(format + 2, true) !== 1 || view.getUint16(format + 14, true) !== 16) throw new Error(`Unsupported timer audio format: ${name}`);
      const rate = view.getUint32(format + 4, true);
      const samples = new Float32Array(data.size / 2);
      for (let index = 0; index < samples.length; index++) samples[index] = view.getInt16(data.offset + index * 2, true) / 32768;
      // Remove only leading silence; retain a short onset margin to avoid clipping transients.
      let first = samples.findIndex(sample => Math.abs(sample) >= 0.01);
      first = Math.max(0, first - Math.round(rate * 0.002));
      clips.set(name, { samples: samples.subarray(first), rate });
    }
    // The clips were cut from one recording, so their edges fall mid-waveform; a 2 ms ramp keeps them from clicking.
    const toBuffer = ({ samples, rate }, fadeStart = true) => {
      const buffer = next.createBuffer(1, samples.length, rate);
      const channel = buffer.getChannelData(0);
      channel.set(samples);
      const ramp = Math.min(Math.round(rate * 0.002), Math.floor(samples.length / 2));
      for (let index = 0; index < ramp; index++) {
        if (fadeStart) channel[index] *= index / ramp;
        channel[samples.length - 1 - index] *= index / ramp;
      }
      return buffer;
    };
    const decoded = new Map([...clips].map(([name, clip]) => [name, toBuffer(clip)]));
    // In the recording the final beat runs straight into the start sound, so a fresh run plays them as one seamless clip.
    const last = clips.get(COUNTDOWN.at(-1)[0]), begin = clips.get("start");
    if (last.rate === begin.rate) {
      const joined = new Float32Array(last.samples.length + begin.samples.length);
      joined.set(last.samples);
      joined.set(begin.samples, last.samples.length);
      decoded.set(LEAD_IN, toBuffer({ samples: joined, rate: last.rate }));
    }
    decoded.set("start-from-beginning", toBuffer(clips.get("start"), false));
    buffers = decoded;
    gain = context.createGain();
    gain.connect(context.destination);
  }

  function now() {
    if (clock) return clock.audioTime + performance.now() - clock.performanceTime;
    if (!context || fallback) return performance.now();
    const output = context.getOutputTimestamp?.();
    if (output && output.performanceTime > 0) {
      return (output.contextTime + Math.max(0, performance.now() - output.performanceTime) / 1000) * 1000;
    }
    return Math.max(0, context.currentTime - (context.outputLatency || 0) - (context.baseLatency || 0)) * 1000;
  }

  function clearSources() {
    for (const source of sources) { source.stop(); source.disconnect(); }
    sources = [];
  }

  function stop() {
    generation++;
    starting = false;
    clearSources();
    end = null;
    clock = null;
  }

  function schedule(name, time, duration = Infinity, offset = 0) {
    const source = context.createBufferSource();
    source.buffer = buffers.get(name);
    source.connect(gain);
    const availableDuration = source.buffer.duration - offset;
    const playbackDuration = Math.min(availableDuration, duration);
    if (playbackDuration < availableDuration) source.start(time, offset, playbackDuration);
    else source.start(time, offset);
    sources.push(source);
  }

  async function start(remaining, fresh, driver = true) {
    stop();
    const token = generation;
    starting = true;
    const countdown = fresh && root.document.getElementById("timer-countdown").checked;
    const duration = remaining + (countdown ? COUNTDOWN_MS : 0);
    try {
      prepare();
      let timeout;
      try {
        await Promise.race([
          context.resume(),
          new Promise((resolve, reject) => {
            timeout = setTimeout(() => reject(new Error("Audio playback did not become ready; check browser audio permissions")), 3000);
          })
        ]);
      } finally { clearTimeout(timeout); }
      if (token !== generation) return null;
      if (context.state !== "running") throw new Error("Audio playback is blocked");
      fallback = false;
      // Android can stop advancing output timestamps between runs. Sample audio latency once, then keep
      // the display moving with the monotonic clock while cues stay scheduled on the audio timeline.
      clock = { audioTime: now(), performanceTime: performance.now() };
      gain.gain.value = document.getElementById("sound").checked ? 1 : 0;
      const origin = context.currentTime + 0.08;
      end = (origin + duration / 1000) * 1000;
      const { openMs: switchOpen, closeMs: switchClose } = root.EventRules.TIMING.driverSwitch || {};
      const switching = driver;
      const nextCue = switching && remaining > switchOpen ? remaining - switchOpen : switching && remaining > switchClose ? remaining - switchClose : remaining;
      const startAt = origin + (countdown ? COUNTDOWN_MS / 1000 : 0);
      const joined = countdown && buffers.has(LEAD_IN);
      const startCue = joined ? LEAD_IN : fresh && !countdown ? "start-from-beginning" : "start";
      if (countdown) for (const [name, at] of joined ? COUNTDOWN.slice(0, -1) : COUNTDOWN) schedule(name, origin + (COUNTDOWN_MS - at) / 1000);
      if (joined) {
        const lead = COUNTDOWN.at(-1)[1] / 1000;
        schedule(LEAD_IN, startAt - lead, lead + nextCue / 1000);
      } else schedule(startCue, startAt, nextCue / 1000);
      if (switching) {
        if (remaining > switchOpen) schedule("switch-open", (end - switchOpen) / 1000);
        if (remaining > switchClose) schedule("switch-close", (end - switchClose) / 1000);
      }
      schedule("end", end / 1000);
      return end;
    } catch (error) {
      if (token !== generation) return null;
      clearSources();
      report(error);
      clock = null;
      fallback = true;
      end = performance.now() + duration;
      return end;
    } finally { if (token === generation) starting = false; }
  }

  function finish() {
    clearSources();
    if (end === null) return;
    end = null;
    if (context && !fallback) schedule("end", context.currentTime);
  }

  document.getElementById("sound").addEventListener("change", () => {
    if (gain) gain.gain.value = document.getElementById("sound").checked ? 1 : 0;
  });
  root.TimerAudio = { start, now, stop, finish, countdownNumber, COUNTDOWN_MS, isStarting: () => starting };
})(globalThis);
