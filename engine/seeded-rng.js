/** Small deterministic PRNG for reproducible statistical experiments. */
export function hashSeed(value) {
  const text = String(value ?? '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 0x6d2b79f5;
}

export function createSeededRng(seedText) {
  let seed = hashSeed(seedText);
  return function random() {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function deriveSeed(masterSeed, ...labels) {
  return [String(masterSeed), ...labels.map(String)].join('::');
}

