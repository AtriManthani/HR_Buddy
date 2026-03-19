/**
 * lib/rag/embedding/registry.ts
 *
 * Provider registry and singleton factory.
 *
 * This is the single place that decides which EmbeddingProvider implementation
 * is active for the current process.  Everything else — embeddings.ts,
 * retriever.ts, scripts/ingest.ts — calls getEmbeddingProvider() and receives
 * the configured instance without knowing the concrete type.
 *
 * Provider selection
 * ──────────────────
 * Set EMBEDDING_PROVIDER in your environment:
 *
 *   EMBEDDING_PROVIDER=openai   (default) — OpenAI text-embedding-3-small
 *   EMBEDDING_PROVIDER=local              — LocalHashEmbeddingProvider (no API key)
 *
 * The registry reads process.env directly rather than importing lib/config/env.ts
 * to avoid the CommonJS import-hoisting trap in ts-node scripts: all `import`
 * statements are compiled to top-level `require()` calls, which execute before
 * any dotenv.config() call in the same file.  Reading process.env lazily
 * (inside getEmbeddingProvider()) ensures the dotenv-loaded variables are
 * available by the time they are needed.
 *
 * Adding a new provider
 * ─────────────────────
 * 1. Create a class that implements EmbeddingProvider in this directory.
 * 2. Add a case to the switch statement below.
 * 3. Update the EMBEDDING_PROVIDER type union.
 * 4. Document the new option in .env.example.
 */

import type { EmbeddingProvider }      from "./EmbeddingProvider";
import { OpenAIEmbeddingProvider }     from "./OpenAIEmbeddingProvider";
import { LocalHashEmbeddingProvider }  from "./LocalHashEmbeddingProvider";

// ── Supported providers ────────────────────────────────────────────────────────

export type SupportedProvider = "openai" | "local";

const SUPPORTED: SupportedProvider[] = ["openai", "local"];

// ── Singleton ──────────────────────────────────────────────────────────────────

let _provider: EmbeddingProvider | null = null;

/**
 * Returns the active EmbeddingProvider singleton.
 *
 * The provider is created on first call and reused for the lifetime of the
 * process (whether Next.js serverless function or ts-node script).  The
 * concrete type depends on the EMBEDDING_PROVIDER environment variable.
 *
 * @throws If EMBEDDING_PROVIDER is set to an unrecognised value.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (_provider) return _provider;

  const raw = process.env.EMBEDDING_PROVIDER ?? "openai";

  if (!SUPPORTED.includes(raw as SupportedProvider)) {
    throw new Error(
      `[embedding/registry] Unknown EMBEDDING_PROVIDER: "${raw}". ` +
        `Supported values: ${SUPPORTED.map((s) => `"${s}"`).join(", ")}.`
    );
  }

  const name = raw as SupportedProvider;

  switch (name) {
    case "openai":
      _provider = new OpenAIEmbeddingProvider();
      break;
    case "local":
      _provider = new LocalHashEmbeddingProvider();
      console.warn(
        "[embedding/registry] Using LocalHashEmbeddingProvider. " +
          "Vectors are NOT semantically meaningful — for development/testing only."
      );
      break;
  }

  return _provider!;
}

/**
 * Resets the singleton, forcing re-creation on the next getEmbeddingProvider()
 * call.  Intended for use in tests only — do NOT call this in production code.
 */
export function resetProviderSingleton(): void {
  _provider = null;
}
