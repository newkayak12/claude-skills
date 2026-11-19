// Per-store configuration: <store>/_knowledge/config.json. One engine serves
// every store (a general project, a personal graph); what differs between them
// lives here, never in engine code. A missing file means the defaults.
import { readStoreConfig } from './knowledge-paths.mjs';

export const STORE_CONFIG_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'knowledge store config',
  type: 'object',
  additionalProperties: true,
  properties: {
    root: { type: 'string', description: 'Move the store: a path, relative to this store, read once and never chained.' },
    notes_dir: { type: 'string', default: 'notes', description: 'Where knowledge_capture writes new notes, relative to the store.' },
    ontology: { type: ['string', 'null'], default: null, description: 'Ontology file the store follows, relative to the store (e.g. _ontology/ontology.yml).' },
    embed: {
      type: 'object',
      additionalProperties: false,
      properties: {
        provider: { type: 'string', enum: ['hash', 'ollama', 'openai'], description: 'Embedding provider; env KNOWLEDGE_EMBED_PROVIDER overrides it.' },
        url: { type: 'string', description: 'Base URL of an OpenAI-compatible endpoint (POST <url>/v1/embeddings); env KNOWLEDGE_EMBED_URL overrides it.' },
        api_key: { type: 'string', description: 'Bearer key for that endpoint; env KNOWLEDGE_EMBED_API_KEY overrides it. Never written to the index.' },
        model: { type: 'string', description: 'Embedding model name; env KNOWLEDGE_EMBED_MODEL overrides it.' },
      },
    },
    link: {
      type: 'object',
      additionalProperties: false,
      properties: {
        min_term_length: { type: 'integer', minimum: 1, default: 2, description: 'Shortest title or alias that may become a link.' },
        max_links: { type: 'integer', minimum: 0, default: 12, description: 'Most links one captured note gets; the rest are reported as skipped.' },
        moc: { type: ['string', 'null'], default: null, description: 'A map-of-content note that lists every capture.' },
        fallback_moc: { type: 'string', default: 'mocs/captures.md', description: 'Where a capture that links to nothing is listed, so it is never an orphan.' },
        search_candidates: { type: 'integer', minimum: 0, maximum: 50, default: 8, description: 'Index hits read for candidates the text does not name (reported, never linked).' },
      },
    },
  },
};

const LINK_DEFAULTS = Object.fromEntries(
  Object.entries(STORE_CONFIG_SCHEMA.properties.link.properties).map(([key, spec]) => [key, spec.default]),
);

// Embedding settings, highest first: an explicit option, KNOWLEDGE_EMBED_{PROVIDER,
// URL,API_KEY,MODEL}, the store file's `embed.*`, then the hash default. A null
// model or url means the provider's own default applies.
export function loadEmbedConfig(root, options = {}, env = process.env) {
  const file = readStoreConfig(root).embed;
  const embed = file && typeof file === 'object' ? file : {};
  return {
    provider: options.provider || env.KNOWLEDGE_EMBED_PROVIDER || embed.provider || 'hash',
    model: options.model || env.KNOWLEDGE_EMBED_MODEL || embed.model || null,
    url: options.embedUrl || env.KNOWLEDGE_EMBED_URL || embed.url || null,
    apiKey: options.embedApiKey || env.KNOWLEDGE_EMBED_API_KEY || embed.api_key || null,
  };
}

// Env overrides the file: KNOWLEDGE_NOTES_DIR, KNOWLEDGE_LINK_MOC, KNOWLEDGE_LINK_MAX.
export function loadStoreConfig(root, env = process.env) {
  const file = readStoreConfig(root);
  const link = { ...LINK_DEFAULTS, ...(file.link && typeof file.link === 'object' ? file.link : {}) };
  if (env.KNOWLEDGE_LINK_MOC) link.moc = env.KNOWLEDGE_LINK_MOC;
  if (env.KNOWLEDGE_LINK_MAX && Number.isInteger(Number(env.KNOWLEDGE_LINK_MAX))) link.max_links = Number(env.KNOWLEDGE_LINK_MAX);
  return {
    ...file,
    notes_dir: env.KNOWLEDGE_NOTES_DIR || file.notes_dir || STORE_CONFIG_SCHEMA.properties.notes_dir.default,
    ontology: file.ontology ?? null,
    link,
  };
}
