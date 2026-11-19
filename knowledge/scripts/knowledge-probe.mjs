// Hardware probe: what this machine can run, and which model tier that means.
// Runs on the host (the container has no GPU tooling) and records its pick in
// <store>/.knowledge/hardware-probe.json, which the graph build reads.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, freemem, totalmem } from 'node:os';
import { join } from 'node:path';

export const PROBE_FILE = '.knowledge/hardware-probe.json';
export const TIERS = ['small', 'medium', 'large'];

// Model names are defaults a store may replace in config (`llm.models`); the
// engine only decides the tier.
export const DEFAULT_TIER_MODELS = {
  small: 'qwen2.5:3b',
  medium: 'qwen2.5:7b',
  large: 'qwen2.5:14b',
};

function runNvidiaSmi() {
  const result = spawnSync('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout;
}

// sources: injectable for tests: { nvidiaSmi: () => string|null, totalMem, freeMem, cores }
export function probeHardware(sources = {}) {
  const smi = (sources.nvidiaSmi ?? runNvidiaSmi)();
  const vram = String(smi || '').split('\n').map((line) => Number.parseInt(line.trim(), 10)).filter(Number.isFinite);
  const mb = (bytes) => Math.round(bytes / 1024 / 1024);
  return {
    gpu: vram.length ? { present: true, vendor: 'nvidia', vram_mb: Math.max(...vram) } : { present: false, vendor: null, vram_mb: 0 },
    ram_mb: mb(sources.totalMem ?? totalmem()),
    ram_available_mb: mb(sources.freeMem ?? freemem()),
    cores: sources.cores ?? cpus().length,
  };
}

// small: CPU-only under 16 GB RAM; medium: 16 GB RAM or more, or 8 GB VRAM or
// more; large: 16 GB VRAM or more.
export function pickTier(facts) {
  if (facts.gpu.vram_mb >= 16 * 1024) return 'large';
  if (facts.gpu.vram_mb >= 8 * 1024 || facts.ram_mb >= 16 * 1024) return 'medium';
  return 'small';
}

// Precedence: env KNOWLEDGE_LLM_MODEL > env KNOWLEDGE_LLM_TIER > config llm.model
// > config llm.tier > probe.
export function chooseModel(facts, llmConfig = {}, env = process.env) {
  const models = { ...DEFAULT_TIER_MODELS, ...(llmConfig.models || {}) };
  const envTier = env.KNOWLEDGE_LLM_TIER;
  if (envTier && !TIERS.includes(envTier)) throw new Error(`KNOWLEDGE_LLM_TIER must be one of ${TIERS.join(', ')}`);
  if (env.KNOWLEDGE_LLM_MODEL) return { tier: envTier || null, model: env.KNOWLEDGE_LLM_MODEL, source: 'env' };
  if (envTier) return { tier: envTier, model: models[envTier], source: 'env' };
  if (llmConfig.model) return { tier: llmConfig.tier || null, model: llmConfig.model, source: 'config' };
  if (llmConfig.tier) {
    if (!TIERS.includes(llmConfig.tier)) throw new Error(`config llm.tier must be one of ${TIERS.join(', ')}`);
    return { tier: llmConfig.tier, model: models[llmConfig.tier], source: 'config' };
  }
  const tier = pickTier(facts);
  return { tier, model: models[tier], source: 'probe' };
}

export function writeProbe(root, facts, choice, now = new Date()) {
  const record = { probed_at: now.toISOString(), ...facts, ...choice };
  const path = join(root, PROBE_FILE);
  mkdirSync(join(root, '.knowledge'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  return { path, record };
}
