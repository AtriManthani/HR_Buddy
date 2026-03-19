/**
 * lib/observability/qualitySignal.ts — per-request AI quality record.
 *
 * Purpose
 * ───────
 * Each completed chat request (including early exits) emits exactly one
 * `chat.quality` log event.  Because it is a single, flat record with one row
 * per request, analytics tools (Datadog, Axiom, Grafana Loki, BigQuery log
 * export) can ingest it directly as a time-series table without further joins
 * or aggregations.
 *
 * Separation from operational logs
 * ─────────────────────────────────
 * The per-step operational logs (chat.rag.retrieved, chat.llm.complete, etc.)
 * in route.ts tell you *what happened at each stage* — useful for debugging
 * individual requests.  The quality signal tells you *how well the system
 * performed* — useful for trend analysis, regression detection, and KPI dashboards.
 *
 * Dashboard queries this enables (examples)
 * ──────────────────────────────────────────
 *   • % of requests with citations (hadCitations)          → grounding rate
 *   • Avg citationCount per day                             → retrieval health
 *   • % refusalTriggered                                    → policy coverage gaps
 *   • p50/p95 latencyMs / ragLatencyMs / llmLatencyMs       → latency SLOs
 *   • topScore distribution over time                       → embedding quality
 *   • usedFallback rate                                     → model reliability
 *   • hadRecommendations rate                               → feature utilisation
 *
 * Future analytics hook
 * ─────────────────────
 * // ANALYTICS HOOK: replace emitQualitySignal()'s log() call with a direct
 * // write to your analytics sink — e.g.:
 * //   await analyticsClient.track("chat_quality", signal);
 * //   await bigquery.table("chat_quality").insert([signal]);
 * //   await axiom.ingest("chat-quality", [signal]);
 * // The QualitySignal interface is the stable schema contract.
 */

import { log } from "./logger";

// ── Schema ────────────────────────────────────────────────────────────────────

/**
 * One record per completed chat request.
 *
 * All fields are plain scalars so the record can be serialised to JSON,
 * inserted into a columnar store, or shipped via a log drain without
 * any transformation.
 *
 * Naming follows snake_case-friendly conventions so the fields map cleanly
 * to SQL column names in BigQuery / Redshift exports.
 */
export interface QualitySignal {
  // ── Identity ───────────────────────────────────────────────────────────────

  /** First 8 chars of the session UUID — enough for correlation, not enough
   *  to reconstruct the full identifier from aggregate data. */
  sessionPrefix: string;

  // ── Retrieval quality ──────────────────────────────────────────────────────

  /** Number of chunks returned by the vector search.  0 when hasContext is false. */
  retrievalCount: number;

  /** Top cosine similarity score from the vector search (0–1).
   *  null when no chunks were retrieved. */
  topScore: number | null;

  /** True when at least one chunk exceeded the minimum similarity threshold.
   *  False = retrieval found nothing relevant; LLM was NOT called. */
  hasContext: boolean;

  // ── Output quality ─────────────────────────────────────────────────────────

  /** True when the response included at least one valid citation. */
  hadCitations: boolean;

  /** Number of citation objects sent in the metadata chunk. */
  citationCount: number;

  /** True when at least one recommendation banner was triggered. */
  hadRecommendations: boolean;

  /** Number of recommendation objects sent in the metadata chunk. */
  recommendationCount: number;

  // ── Control-flow signals ───────────────────────────────────────────────────

  /**
   * True when the response was a refusal rather than a grounded answer.
   * Covers: guardrail block, no-context (no matching policy), or
   * output-guard anomaly detection.
   */
  refusalTriggered: boolean;

  /**
   * True when the LLM returned an empty response and a static fallback
   * message was substituted.  Indicates a model or streaming reliability issue.
   */
  usedFallback: boolean;

  /**
   * True when the output guard detected a potential injection artefact or
   * system-prompt leak in the completed model output.
   */
  outputFlagged: boolean;

  // ── Query rewriting ────────────────────────────────────────────────────────

  /**
   * How the incoming query was handled before retrieval:
   *   "standalone"    — no back-reference detected; sent to the vector store unchanged
   *   "rewritten"     — resolved a back-reference using session history
   *   "clarification" — query was ambiguous; a clarification was returned instead
   */
  rewriteType: "standalone" | "rewritten" | "clarification";

  // ── Latency (milliseconds) ─────────────────────────────────────────────────

  /** Time spent in the RAG retrieval step (embed + nearest-neighbour search). */
  ragLatencyMs: number;

  /** Time from LLM stream open to last token received.  0 when LLM was not called. */
  llmLatencyMs: number;

  /** End-to-end wall-clock time from POST handler entry to pipeline completion. */
  latencyMs: number;
}

// ── Default factory ───────────────────────────────────────────────────────────

/**
 * Returns a QualitySignal initialised with safe zero-value defaults.
 *
 * Callers mutate the returned object as the pipeline progresses, then pass
 * the completed record to emitQualitySignal() at every exit point.
 *
 * Initialising with defaults (rather than Partial<QualitySignal>) means every
 * early-return path emits a fully-populated record — no undefined fields reach
 * the analytics sink.
 */
export function createQualitySignal(sessionPrefix: string): QualitySignal {
  return {
    sessionPrefix,
    retrievalCount:      0,
    topScore:            null,
    hasContext:          false,
    hadCitations:        false,
    citationCount:       0,
    hadRecommendations:  false,
    recommendationCount: 0,
    refusalTriggered:    false,
    usedFallback:        false,
    outputFlagged:       false,
    rewriteType:         "standalone",
    ragLatencyMs:        0,
    llmLatencyMs:        0,
    latencyMs:           0,
  };
}

// ── Emitter ───────────────────────────────────────────────────────────────────

/**
 * Emits the completed quality signal as a structured `chat.quality` log event.
 *
 * Called exactly once per request, at whichever exit point the pipeline reaches.
 * The log level is "warn" for refusals and fallbacks (signals degraded quality)
 * and "info" for successful grounded answers.
 *
 * ANALYTICS HOOK: swap the log() call here for a direct write to your
 * preferred analytics sink (Axiom, BigQuery, Segment, etc.) to populate a
 * dedicated `chat_quality` table without going through log parsing.
 */
export function emitQualitySignal(signal: QualitySignal): void {
  const level =
    signal.refusalTriggered || signal.usedFallback || signal.outputFlagged
      ? "warn"
      : "info";

  log(level, "chat.quality", {
    sessionPrefix:       signal.sessionPrefix,
    retrievalCount:      signal.retrievalCount,
    topScore:            signal.topScore,
    hasContext:          signal.hasContext,
    hadCitations:        signal.hadCitations,
    citationCount:       signal.citationCount,
    hadRecommendations:  signal.hadRecommendations,
    recommendationCount: signal.recommendationCount,
    refusalTriggered:    signal.refusalTriggered,
    usedFallback:        signal.usedFallback,
    outputFlagged:       signal.outputFlagged,
    rewriteType:         signal.rewriteType,
    ragLatencyMs:        signal.ragLatencyMs,
    llmLatencyMs:        signal.llmLatencyMs,
    latencyMs:           signal.latencyMs,
  });
}
