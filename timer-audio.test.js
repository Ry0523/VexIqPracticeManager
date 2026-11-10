"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const names = ["countdown-3", "countdown-2", "countdown-1", "start", "switch-open", "switch-close", "end"];
const data = Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(__dirname, `timer-${name}.wav`)).toString("base64")]));

function timer(options = {}) {
  const scheduled = [], errors = [], gains = [];
  const sound = { checked: true, addEventListener(type, handler) { this.change = handler; } };
  const countdown = { checked: true };
  let performanceTime = 5000;
  const audio = {
    state: "running", currentTime: 5, baseLatency: 0.02,
    resume: options.resume || (async () => {}),
    getOutputTimestamp: () => ({ contextTime: audio.currentTime - 0.05, performanceTime }),
    createGain() { const gain = { gain: { value: 1 }, connect() {} }; gains.push(gain); return gain; },
    createBuffer(channels, length, rate) {
      const samples = new Float32Array(length);
      return { duration: length / rate, getChannelData: () => samples, length, sampleRate: rate };
    },
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, stopped: false, stop() { this.stopped = true; }, start(time, offset, duration) { this.time = time; this.offset = offset; this.duration = duration; scheduled.push(this); } };
      return source;
    }
  };
  const context = vm.createContext({
    AudioContext: function () { return audio; }, TimerSoundData: data,
    atob: value => Buffer.from(value, "base64").toString("binary"),
    setTimeout: options.setTimeout || setTimeout, clearTimeout,
    performance: { now: () => performanceTime },
    document: { getElementById: id => id === "timer-countdown" ? countdown : sound },
    timerAudioError: error => errors.push(error),
    MatchCore: require("./core.js")
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "timer-audio.js"), "utf8"), context);
  return { api: context.TimerAudio, scheduled, errors, sound, countdown, gains, audio, advance(seconds) { audio.currentTime += seconds; performanceTime += seconds * 1000; } };
}

test("all cues are scheduled before any visual timer ticks, with an exact full minute", async () => {
  const { api, scheduled } = timer();
  const end = await api.start(60000, true, true);
  assert.equal(scheduled.length, 6);
  const expected = [5.08, 5.83, 6.58, 32.464, 42.464, 67.464];
  scheduled.forEach((source, index) => assert.ok(Math.abs(source.time - expected[index]) < 1e-9));
  assert.equal(end, scheduled[5].time * 1000);
  // The countdown-1 effect ends at the start note, 0.884 s after the final cue begins.
  assert.ok(Math.abs(scheduled[5].time - (scheduled[2].time + 0.884) - 60) < 1e-9);
  assert.equal(scheduled[2].duration, undefined);
});

test("disabling the countdown starts the run immediately without countdown cues", async () => {
  const { api, countdown, scheduled } = timer();
  countdown.checked = false;
  const end = await api.start(60000, true, true);
  assert.equal(scheduled.length, 4);
  assert.equal(scheduled[0].time, 5.08);
  assert.equal(scheduled[0].duration, undefined, "the full start cue should play to its natural end");
  const startBuffer = scheduled[0].buffer.getChannelData(0);
  const startBytes = fs.readFileSync(path.join(__dirname, "timer-start.wav"));
  const startOffset = startBytes.indexOf("data") + 8;
  assert.equal(scheduled[0].offset, 0, "the start cue must play from its first sample");
  assert.equal(startBuffer.length, startBytes.readUInt32LE(startOffset - 4) / 2);
  for (const index of [0, 100, 240, 1200]) {
    const sample = startBytes.readInt16LE(startOffset + index * 2) / 32768;
    assert.ok(Math.abs(startBuffer[index] - sample) < 1e-6);
  }
  assert.equal(end, 65080);
});

test("the final beat flows into the full, unclipped start sound without a seam", async () => {
  const { api, scheduled } = timer();
  await api.start(60000, true, true);
  const samples = name => {
    const bytes = Buffer.from(data[name], "base64");
    const offset = bytes.indexOf("data") + 8;
    return Array.from({ length: bytes.readUInt32LE(offset - 4) / 2 }, (_, index) => bytes.readInt16LE(offset + index * 2) / 32768);
  };
  const beat = samples("countdown-1"), start = samples("start");
  const joined = scheduled[2].buffer.getChannelData(0);
  assert.equal(joined.length, beat.length + start.length);
  assert.equal(beat.length, 7079);
  assert.equal(start.length, 37561);
  for (const index of [-200, -1, 0, 1, 200]) {
    const expected = index < 0 ? beat.at(index) : start[index];
    assert.ok(Math.abs(joined[beat.length + index] - expected) < 1e-6);
  }
  assert.equal(Math.abs(joined[0]), 0);
  assert.equal(Math.abs(joined.at(-1)), 0);
});

test("the countdown shows 3, 2, 1 in step with the recorded beats", () => {
  const { api } = timer();
  const shown = [2384, 1635, 1634, 885, 884, 1].map(api.countdownNumber);
  assert.deepEqual([...shown], [3, 3, 2, 2, 1, 1]);
  assert.equal(api.COUNTDOWN_MS, 2384);
});

test("display clock accounts for audio output latency and ignores wall-clock adjustments", async () => {
  const { api, advance } = timer();
  const end = await api.start(60000, true);
  assert.equal(api.now(), 4950);
  advance(2.27);
  assert.ok(Math.abs(end - api.now() - 60244) < 1e-6);
  advance(25);
  assert.ok(Math.abs(end - api.now() - 35244) < 1e-6);
});

test("fallback output clock subtracts known device latency", async () => {
  const { api, audio } = timer();
  audio.getOutputTimestamp = undefined;
  await api.start(60000, true);
  assert.equal(api.now(), 4980);
  audio.outputLatency = 0.1;
  assert.equal(api.now(), 4980, "latency changes cannot move the running clock backward");
});

test("a second run counts down even when Android audio timestamps stop advancing", async () => {
  const { api, audio, advance, scheduled } = timer();
  await api.start(60000, true);
  advance(63);
  assert.ok(api.now() > scheduled[5].time * 1000);
  const end = await api.start(60000, true);
  const initial = api.now();
  const timestamp = audio.getOutputTimestamp();
  audio.getOutputTimestamp = () => ({ ...timestamp, performanceTime: timestamp.performanceTime + 7140 });
  // Model an output clock that is stuck even though sound playback and real time continue.
  const frozenAudioTime = audio.currentTime;
  advance(7.14);
  audio.currentTime = frozenAudioTime;
  assert.ok(Math.abs(api.now() - initial - 7140) < 1e-6);
  assert.ok(Math.abs((end - api.now()) - (end - initial - 7140)) < 1e-6);
  assert.equal(api.isStarting(), false);
});

test("autonomous skips driver-switch sounds and resumed timers skip countdown and past boundaries", async () => {
  const { api, scheduled } = timer();
  await api.start(40000, false, false);
  assert.equal(scheduled.length, 2);
  assert.ok(Math.abs(scheduled[1].time - scheduled[0].time - 40) < 1e-9);
  const before = scheduled.length;
  await api.start(30000, false, true);
  assert.equal(scheduled.length - before, 3);
  assert.ok(Math.abs(scheduled[before + 1].time - scheduled[before].time - 5) < 1e-9);
});

test("reset cancels every queued cue and early finish replaces future cues with one end sound", async () => {
  const { api, scheduled } = timer();
  await api.start(60000, true);
  api.stop();
  assert.ok(scheduled.every(source => source.stopped));
  await api.start(60000, true);
  const before = scheduled.length;
  api.finish();
  assert.equal(scheduled.length, before + 1);
  assert.ok(scheduled.slice(0, before).every(source => source.stopped));
  api.finish();
  assert.equal(scheduled.length, before + 1);
});

test("resuming near a boundary does not overlap the start signal with the next cue", async () => {
  const { api, scheduled } = timer();
  await api.start(35010, false, true);
  assert.equal(scheduled[0].duration, 0.01);
  await api.start(500, false, false);
  assert.equal(scheduled.at(-2).duration, 0.5);
});

test("mute changes gain without rescheduling or replaying past cues", async () => {
  const { api, scheduled, sound, gains } = timer();
  await api.start(60000, true);
  sound.checked = false; sound.change();
  assert.equal(gains[0].gain.value, 0);
  sound.checked = true; sound.change();
  assert.equal(gains[0].gain.value, 1);
  assert.equal(scheduled.length, 6);
});

test("timer waits for audio readiness and pending starts can be cancelled", async () => {
  let ready;
  const { api, scheduled } = timer({ resume: () => new Promise(resolve => { ready = resolve; }) });
  const pending = api.start(60000, true);
  assert.equal(api.isStarting(), true);
  assert.equal(scheduled.length, 0);
  api.stop();
  ready();
  assert.equal(await pending, null);
  assert.equal(api.isStarting(), false);
  assert.equal(scheduled.length, 0);
});

test("slow audio startup does not consume any countdown or run time", async () => {
  let ready;
  const { api, audio, advance, scheduled } = timer({ resume: () => new Promise(resolve => { ready = resolve; }) });
  audio.state = "suspended";
  const pending = api.start(60000, true);
  advance(10);
  assert.equal(scheduled.length, 0);
  audio.state = "running";
  ready();
  const end = await pending;
  assert.ok(Math.abs(scheduled[0].time - 15.08) < 1e-9);
  assert.ok(Math.abs(end - scheduled[0].time * 1000 - 62384) < 1e-9);
});

test("initially muted playback keeps the same timeline and can be unmuted", async () => {
  const { api, sound, gains, scheduled } = timer();
  sound.checked = false;
  await api.start(60000, true);
  assert.equal(gains[0].gain.value, 0);
  assert.equal(scheduled.length, 6);
  sound.checked = true; sound.change();
  assert.equal(gains[0].gain.value, 1);
});

test("audio failure explicitly warns and preserves a monotonic visual timer", async () => {
  const { api, scheduled, errors, advance } = timer({ resume: async () => { throw new Error("Playback blocked"); } });
  const end = await api.start(60000, true);
  assert.equal(end, 67384);
  assert.equal(scheduled.length, 0);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("Playback blocked"));
  advance(2.384);
  assert.equal(end - api.now(), 60000);
});

test("blocked audio readiness times out explicitly instead of leaving controls stuck", async () => {
  const { api, errors, scheduled } = timer({
    resume: () => new Promise(() => {}),
    setTimeout: callback => { queueMicrotask(callback); return undefined; }
  });
  assert.equal(await api.start(60000, true), 67384);
  assert.equal(api.isStarting(), false);
  assert.equal(scheduled.length, 0);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("browser audio permissions"));
});

test("decoded recording clips have at most 2ms of leading quiet samples plus a 2ms de-click ramp", async () => {
  const { api, scheduled } = timer();
  await api.start(60000, true);
  for (const source of scheduled) {
    const samples = source.buffer.getChannelData(0);
    const onset = samples.findIndex(sample => Math.abs(sample) >= 0.01);
    assert.ok(onset >= 0 && onset <= Math.round(source.buffer.sampleRate * 0.004));
    assert.ok(source.buffer.duration > 0.1);
  }
});
