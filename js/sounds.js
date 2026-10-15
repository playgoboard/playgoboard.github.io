// Stone sounds, made on the fly with the browser's Web Audio (no sound files to download).
(function () {
  const MUTE_KEY = "goboard-muted";
  let audio = null;
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch { /* private window: default on */ }

  // Browsers only allow sound after the player has clicked something, so start lazily.
  function context() {
    if (!audio) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      audio = new AudioContextClass();
    }
    if (audio.state === "suspended") audio.resume();
    return audio;
  }

  // A short burst of filtered noise sounds like a hard stone hitting wood.
  function click(when, { pitch, volume, length }) {
    const ctx = context();
    if (!ctx) return;
    const samples = Math.floor(ctx.sampleRate * length);
    const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / samples, 4);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = pitch;
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(ctx.currentTime + when);
  }

  // The low "thock" of the board underneath.
  function thump(when) {
    const ctx = context();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + when;
    osc.frequency.setValueAtTime(190, start);
    osc.frequency.exponentialRampToValueAtTime(70, start + 0.08);
    gain.gain.setValueAtTime(0.35, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.1);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.12);
  }

  function stone() {
    if (muted) return;
    click(0, { pitch: 2600, volume: 1.4, length: 0.05 });
    thump(0);
  }

  // Captured stones being picked up: a few quick light clicks, more for bigger captures.
  function capture(count) {
    if (muted) return;
    const clicks = Math.min(2 + count, 7);
    for (let k = 0; k < clicks; k++) {
      click(0.12 + k * 0.055 + Math.random() * 0.02, { pitch: 3400 + Math.random() * 800, volume: 0.6, length: 0.03 });
    }
  }

  function setMuted(value) {
    muted = value;
    try { localStorage.setItem(MUTE_KEY, value ? "1" : "0"); } catch { /* not saved, still works */ }
  }

  window.GoSounds = { stone, capture, isMuted: () => muted, setMuted };
})();
