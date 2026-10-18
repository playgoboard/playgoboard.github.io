// One helper for the neural-network Dragon: it runs the network on positions the search
// (js/dragon-search.js, on the page) sends it, and answers with move chances and a win
// chance. Several helpers work at once, one per spare processor core.
// The network (models/dragon-b10c128.onnx) is a public-domain KataGo g170 network;
// ONNX Runtime Web (MIT, Microsoft) runs it.
self.window = self;
const version = self.location.search;
importScripts(`nn-features.js${version}`, "vendor/onnxruntime-web-1.23.2/ort.wasm.min.js");

const ORT_BASE = new URL("vendor/onnxruntime-web-1.23.2/", self.location.href).href;
ort.env.wasm.numThreads = 1; // each helper is one thread; several helpers run side by side
const GoNN = self.GoNN;
let session = null;

// The runtime's helper script must be served as JavaScript. Some servers label .mjs files
// wrongly, so load its text and hand it over with the right label ourselves.
async function load(modelUrl) {
  if (session) return;
  const text = await (await fetch(ORT_BASE + "ort-wasm-simd-threaded.mjs")).text();
  const mjs = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
  ort.env.wasm.wasmPaths = { mjs, wasm: ORT_BASE + "ort-wasm-simd-threaded.wasm" };
  session = await ort.InferenceSession.create(modelUrl, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
}

// For each position: the legal moves (pass = -1, last), their chances, and the win chance
// for the player to move.
async function evaluate(positions) {
  const size = positions[0].size, n = size * size, count = positions.length;
  const bin = new Float32Array(count * GoNN.NUM_SPATIAL * n);
  const glob = new Float32Array(count * GoNN.NUM_GLOBAL);
  positions.forEach((pos, k) => {
    GoNN.encode(pos, bin.subarray(k * GoNN.NUM_SPATIAL * n, (k + 1) * GoNN.NUM_SPATIAL * n),
      glob.subarray(k * GoNN.NUM_GLOBAL, (k + 1) * GoNN.NUM_GLOBAL));
  });
  const out = await session.run({
    bin_input: new ort.Tensor("float32", bin, [count, GoNN.NUM_SPATIAL, size, size]),
    global_input: new ort.Tensor("float32", glob, [count, GoNN.NUM_GLOBAL]),
  });
  const policy = out.policy.data, value = out.value.data, misc = out.miscvalue.data;
  return positions.map((pos, k) => {
    const logits = policy.subarray(k * (n + 1), (k + 1) * (n + 1));
    const moves = [], priors = [];
    let max = -Infinity;
    for (let i = 0; i <= n; i++) {
      const at = i === n ? -1 : i;
      if (at >= 0 && (pos.board[at] !== 0 || !GoNN.isLegal(pos, at))) continue;
      moves.push(at);
      priors.push(logits[i]);
      if (logits[i] > max) max = logits[i];
    }
    let sum = 0;
    for (let j = 0; j < priors.length; j++) { priors[j] = Math.exp(priors[j] - max); sum += priors[j]; }
    for (let j = 0; j < priors.length; j++) priors[j] /= sum;
    const v = value.subarray(k * 3, k * 3 + 3);
    const vm = Math.max(v[0], v[1], v[2]);
    const ew = Math.exp(v[0] - vm), el = Math.exp(v[1] - vm), en = Math.exp(v[2] - vm);
    // lead: points ahead for the player to move (KataGo's lead output, scaled by 20).
    return { moves, priors, win: (ew + 0.5 * en) / (ew + el + en), lead: misc[k * 4 + 2] * 20 };
  });
}

self.onmessage = async (event) => {
  const { id, modelUrl, positions } = event.data;
  try {
    await load(modelUrl);
    const unpacked = positions.map((p) => ({
      size: p.size, board: Int8Array.from(p.board), toPlay: p.toPlay, ko: p.ko,
      moves: p.moves, boards: p.boards.map((b) => Int8Array.from(b)),
    }));
    self.postMessage({ id, results: await evaluate(unpacked) });
  } catch (error) {
    self.postMessage({ id, error: String((error && error.message) || error) });
  }
};
