/**
 * lib/rag/embedding/index.ts — public surface of the embedding sub-package.
 *
 * Import from this barrel rather than from the individual files:
 *
 *   import { getEmbeddingProvider, type EmbeddingProvider } from "@/lib/rag/embedding";
 *
 * What is exported
 * ────────────────
 *   EmbeddingProvider          — the interface (type only, no runtime cost)
 *   EmbeddingResult            — { text, vector } convenience type
 *   ProviderInfo               — descriptor stored in data/index.json
 *   getEmbeddingProvider()     — returns the active singleton provider
 *   resetProviderSingleton()   — test-only: reset the cached provider
 *   SupportedProvider          — "openai" | "local" union type
 *
 * The concrete provider classes (OpenAIEmbeddingProvider, LocalHashEmbeddingProvider)
 * are NOT re-exported.  Consumers should only depend on the interface and the
 * registry function, not on the concrete types.
 */

export type { EmbeddingProvider, EmbeddingResult, ProviderInfo } from "./EmbeddingProvider";
export type { SupportedProvider }                                 from "./registry";
export { getEmbeddingProvider, resetProviderSingleton }           from "./registry";
