/**
 * POST /api/chat
 *
 * Primary chat endpoint.  Orchestrates the full request pipeline:
 *
 *  Step 1  — Parse request body (JSON)
 *  Step 2  — Validate schema (ChatRequest shape)
 *  Step 3  — Sanitize input (strip control chars, enforce length)
 *  Step 4  — Guardrail pre-check (block action intents & injections)
 *  Step 5  — Session resolution (get or create server-side session)
 *  Step 6  — RAG retrieval (embed question → retrieve chunks)
 *  Step 7  — No-context guard (refuse if no policy found — never hallucinate)
 *  Step 8  — LLM invocation (stream tokens to client)
 *  Step 9  — Build + send metadata chunk (citations, structuredResponse)
 *  Step 10 — Persist completed turn to session memory
 *
 * Response format: newline-delimited JSON (NDJSON).
 * Each line is a JSON-serialised StreamChunk (see types/api.ts).
 *
 * Non-agentic guarantees enforced here:
 *  - The route NEVER writes to any external system of record.
 *  - The route ONLY reads: session history (in-memory) + vector store (local file).
 *  - The LLM is ONLY called when at least one policy chunk was retrieved.
 *  - Guardrails are checked before any LLM interaction.
 */

import { NextRequest } from "next/server";

import { handleDemoRequest } from "@/lib/demo/demoHandler";
import {
  validateChatRequest,
  ValidationError,
  jsonError,
  toJsonError,
  checkContentType,
  checkBodySize,
} from "@/lib/api/validation";
import { validateStructuredResponse } from "@/lib/api/structuredResponseValidator";
import {
  createNdJsonStream,
  tokenChunk,
  metadataChunk,
  errorChunk,
  streamText,
  type ChunkWriter,
} from "@/lib/api/responseBuilder";
import { sanitizeInput }          from "@/lib/security/sanitize";
import { checkGuardrails }        from "@/lib/security/guardrails";
import { validateModelOutput }    from "@/lib/security/outputGuard";
import { getOrCreateSession }   from "@/lib/session/sessionStore";
import {
  getSessionMemory,
  appendToSessionMemory,
  trimSessionMemory,
} from "@/lib/session/memory";
import { rewriteQuery }          from "@/lib/session/queryRewriter";
import {
  retrieveRelevantChunks,
  formatContextForPrompt,
  buildCitationObjects,
} from "@/lib/rag/pipeline";
import { buildRecommendations }                       from "@/lib/rag/recommendations";
import { buildMessages }                              from "@/lib/openai/prompts";
import { openaiClient, CHAT_MODEL, classifyOpenAIError } from "@/lib/openai/client";
import { REFUSAL_MESSAGES }                           from "@/lib/openai/systemPrompt";
import { parseModelOutput }                           from "@/lib/openai/parseModelOutput";

import { log }                                    from "@/lib/observability/logger";
import { startTimer }                              from "@/lib/observability/timer";
import { createQualitySignal, emitQualitySignal } from "@/lib/observability/qualitySignal";

import type {
  ChatMessage,
  StructuredResponse,
  PipelineContext,
} from "@/types";

// ── Route config ───────────────────────────────────────────────────────────────

/** Node.js runtime required for fs access (vector store cold-start read). */
export const runtime = "nodejs";
/** Never cache — every request is a live, stateful conversation turn. */
export const dynamic = "force-dynamic";

// ── No-context message (shown when no policy matches the query) ────────────────

/**
 * Returned when retrieval finds no chunks above the similarity threshold.
 * The LLM is deliberately NOT called in this case — the message comes from
 * REFUSAL_MESSAGES so the wording is identical to what the system prompt
 * instructs the model to say, and to what the Layer 1 guardrail returns.
 */
const NO_POLICY_FOUND_MESSAGE = REFUSAL_MESSAGES.notFound;

// ── POST handler ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {

  // ── Demo mode short-circuit ────────────────────────────────────────────────
  // When DEMO_MODE=true the request is handled entirely by the demo handler,
  // which returns a pre-crafted streaming response without calling the OpenAI
  // API or the vector store.  Remove this env var (or set it to any value
  // other than "true") to restore the real pipeline.
  if (process.env.DEMO_MODE === "true") {
    return handleDemoRequest(req);
  }

  // Track total request latency from the moment the handler is entered.
  const requestTimer = startTimer();

  // ── Step 1a: Content-Type gate ─────────────────────────────────────────────
  // Must run before req.json() — a non-JSON Content-Type causes req.json()
  // to behave unpredictably depending on the runtime.

  try {
    checkContentType(req);
  } catch (err) {
    log("warn", "chat.request.rejected", {
      reason: "bad_content_type",
      latencyMs: requestTimer(),
    });
    return toJsonError(err);
  }

  // ── Step 1b: Body size gate ────────────────────────────────────────────────
  // Checked via Content-Length header before reading the body, preventing
  // memory exhaustion from multi-megabyte payloads.

  try {
    checkBodySize(req);
  } catch (err) {
    log("warn", "chat.request.rejected", {
      reason: "body_too_large",
      latencyMs: requestTimer(),
    });
    return toJsonError(err);
  }

  // ── Step 1c: Parse ────────────────────────────────────────────────────────

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    log("warn", "chat.request.rejected", {
      reason: "invalid_json",
      latencyMs: requestTimer(),
    });
    return jsonError("Request body must be valid JSON.", 400);
  }

  // ── Step 2: Validate schema ────────────────────────────────────────────────

  let validated: ReturnType<typeof validateChatRequest>;
  try {
    validated = validateChatRequest(rawBody);
  } catch (err) {
    log("warn", "chat.request.rejected", {
      reason: "schema_invalid",
      latencyMs: requestTimer(),
    });
    return toJsonError(err);
  }

  // ── Step 3: Sanitize ───────────────────────────────────────────────────────

  let message: string;
  try {
    message = sanitizeInput(validated.message);
  } catch (err) {
    log("warn", "chat.request.rejected", {
      reason: "sanitize_rejected",
      latencyMs: requestTimer(),
    });
    return jsonError(
      err instanceof Error ? err.message : "Message could not be processed.",
      400
    );
  }

  // ── Step 4: Guardrail pre-check ────────────────────────────────────────────
  // Runs BEFORE the stream opens — blocked messages become streaming refusals
  // (not hard HTTP errors) so the UI renders them uniformly as assistant turns.

  const guardrail = checkGuardrails(message);

  // Log guardrail outcome regardless of allow/block — useful for tuning false
  // positive rates and detecting abuse patterns in production log aggregators.
  //
  // ANALYTICS HOOK: pipe "chat.guardrail.blocked" events to an alerting
  // integration (e.g. Datadog monitor, PagerDuty) for spike detection.
  log(guardrail.allowed ? "info" : "warn", "chat.guardrail.checked", {
    allowed:   guardrail.allowed,
    // category is present only when blocked — reveals which rule fired, not the content
    category:  guardrail.allowed ? undefined : guardrail.category,
    messageLengthChars: message.length,
    latencyMs: requestTimer(),
  });

  if (!guardrail.allowed) {
    // Emit a quality signal for blocked requests so refusal rate is tracked
    // alongside successful requests in the same `chat.quality` event stream.
    const blockedSignal = createQualitySignal(
      (validated.sessionId ?? "unknown").slice(0, 8)
    );
    blockedSignal.refusalTriggered = true;
    blockedSignal.latencyMs        = requestTimer();
    emitQualitySignal(blockedSignal);

    return streamRefusal(guardrail.reason, validated.sessionId);
  }

  // ── Step 5: Session resolution ─────────────────────────────────────────────

  const { sessionId } = getOrCreateSession(validated.sessionId);
  const history       = await getSessionMemory(sessionId);

  // Log that a valid request entered the pipeline.
  // Session ID is truncated to 8 chars — enough for correlation, not enough
  // to reconstruct the full identifier from logs.
  log("info", "chat.request.received", {
    sessionPrefix:   sessionId.slice(0, 8),
    messageLengthChars: message.length,
    historyTurns:    history.length,
  });

  // ── Steps 6–10: Stream the response ───────────────────────────────────────

  return createNdJsonStream(async (write) => {
    await runPipeline(write, { message, sessionId, history, requestTimer });
  });
}

// ── Pipeline ───────────────────────────────────────────────────────────────────

/**
 * The core pipeline that runs inside the NDJSON stream.
 * Errors thrown here are caught by createNdJsonStream and written as a final
 * error chunk before the stream closes.
 */
async function runPipeline(
  write: ChunkWriter,
  ctx: PipelineContext
): Promise<void> {
  const { message, sessionId, history, requestTimer } = ctx;

  // Convenience: emit a log entry with full-request latency field when available.
  const totalMs = () => requestTimer?.() ?? 0;

  // ── Quality signal accumulator ─────────────────────────────────────────────
  // Initialised with zero-value defaults.  Fields are filled in as the pipeline
  // progresses.  emitQualitySignal() is called at every return point — including
  // early exits — so every request produces exactly one `chat.quality` event.

  const qs = createQualitySignal(sessionId.slice(0, 8));

  // ── Step 5b: Query rewriting ───────────────────────────────────────────────
  // Detects vague back-references ("that", "it", "this policy", "those rules")
  // and resolves them using the most recent assistant turn in history.
  //
  // The rewritten query is used ONLY for RAG retrieval (the embedding step).
  // The original `message` is unchanged everywhere else — LLM prompt, session
  // history, and logs — so the model's grounding comes exclusively from
  // retrieved policy excerpts, never from the rewrite itself.
  //
  // If the reference cannot be resolved (no history to anchor it), a
  // clarification question is streamed back as a normal assistant turn and
  // the pipeline returns early without calling RAG or the LLM.

  const rewriteResult = rewriteQuery(message, history);

  qs.rewriteType = rewriteResult.type;

  log("info", "chat.query.rewrite", {
    sessionPrefix: sessionId.slice(0, 8),
    type:          rewriteResult.type,
  });

  if (rewriteResult.type === "clarification") {
    const clarification = rewriteResult.prompt;

    await streamText(clarification, write);
    write(
      metadataChunk({
        sessionId,
        citations:          [],
        recommendations:    [],
        // refusal intentionally false — this is a helpful assistant question,
        // not a policy rejection.  The UI renders it identically to an answer.
        structuredResponse: { answer: clarification },
      })
    );

    // Persist so that if the user answers "I meant vacation leave", the model
    // has the clarification exchange in context for the next turn.
    await safelyPersistTurn(sessionId, message, clarification);
    qs.latencyMs = totalMs();
    emitQualitySignal(qs);
    return;
  }

  // Use the rewritten (or unchanged) query for embedding.
  const retrievalQuery = rewriteResult.query;

  if (process.env.NODE_ENV === "development" && rewriteResult.type === "rewritten") {
    console.debug(`[queryRewriter] rewrote query:\n  original: ${message}\n  rewritten: ${retrievalQuery}`);
  }

  // ── Step 6: RAG retrieval ──────────────────────────────────────────────────
  // Embeds the question and performs nearest-neighbour search over the vector
  // store.  initVectorStore() is called inside and is idempotent (no-op after
  // the first request in a serverless function instance).

  const ragTimer = startTimer();
  const { chunks, hasContext } = await retrieveRelevantChunks(retrievalQuery);
  const ragLatencyMs = ragTimer();

  // Log retrieval metadata for RAG quality monitoring.
  // topScore and unique doc count help detect embedding quality regressions.
  //
  // ANALYTICS HOOK: pipe "chat.rag.retrieved" events to a Datadog
  // metric (histogram on latencyMs, gauge on topScore) for SLO tracking.
  const topScore    = chunks[0]?.score ?? null;
  const uniqueDocs  = new Set(chunks.map((c) => c.metadata?.sourceFile)).size;
  log("info", "chat.rag.retrieved", {
    sessionPrefix: sessionId.slice(0, 8),
    chunkCount:    chunks.length,
    uniqueDocs,
    topScore:      topScore !== null ? Math.round(topScore * 1000) / 1000 : null,
    hasContext,
    latencyMs:     ragLatencyMs,
  });

  // Populate retrieval fields on the quality signal.
  qs.retrievalCount = chunks.length;
  qs.topScore       = topScore !== null ? Math.round(topScore * 1000) / 1000 : null;
  qs.hasContext     = hasContext;
  qs.ragLatencyMs   = ragLatencyMs;

  // ── Step 7: No-context guard ───────────────────────────────────────────────
  // If no chunks exceeded the similarity threshold, return the standard
  // "no policy found" message WITHOUT calling the LLM.
  // This is the primary guardrail ensuring the bot answers only from retrieved
  // content — it cannot hallucinate when there is nothing to ground it.

  if (!hasContext) {
    log("info", "chat.rag.no_context", {
      sessionPrefix: sessionId.slice(0, 8),
      totalMs: totalMs(),
    });

    await streamText(NO_POLICY_FOUND_MESSAGE, write);

    write(
      metadataChunk({
        sessionId,
        citations:          [],
        recommendations:    [],
        structuredResponse: {
          answer:  NO_POLICY_FOUND_MESSAGE,
          refusal: true,
        },
      })
    );

    // Persist the turn so the session history reflects the no-match response.
    await safelyPersistTurn(sessionId, message, NO_POLICY_FOUND_MESSAGE);
    qs.refusalTriggered = true;
    qs.latencyMs        = totalMs();
    emitQualitySignal(qs);
    return;
  }

  // ── Step 8: LLM invocation ─────────────────────────────────────────────────
  // Build the messages array (system prompt + session history + context + query)
  // and stream the completion.  The model sees ONLY the retrieved policy
  // excerpts — it cannot draw on general knowledge.

  const contextBlock = formatContextForPrompt(chunks);
  const messages     = buildMessages(history, contextBlock, message);

  // Errors from the OpenAI API (rate limit, auth, context overflow, etc.) are
  // caught here and converted to error chunks rather than letting them propagate
  // as unhandled throws.  classifyOpenAIError() returns a safe user-facing
  // string — no API keys or internal details leak to the client.
  // eslint-disable-next-line prefer-const
  let stream;
  const llmTimer = startTimer();
  try {
    stream = await openaiClient.chat.completions.create({
      model:    CHAT_MODEL,
      stream:   true,
      messages,
    });
    log("info", "chat.llm.stream_started", {
      sessionPrefix: sessionId.slice(0, 8),
      model:         CHAT_MODEL,
      contextChunks: chunks.length,
      // Number of messages sent to the model (system + history + user)
      messageCount:  messages.length,
    });
  } catch (err) {
    log("error", "chat.llm.error", {
      sessionPrefix: sessionId.slice(0, 8),
      stage:         "stream_create",
      latencyMs:     llmTimer(),
      totalMs:       totalMs(),
    });
    write(errorChunk(classifyOpenAIError(err)));
    return;
  }

  let fullContent = "";

  try {
    for await (const delta of stream) {
      const token = delta.choices[0]?.delta?.content ?? "";
      if (token) {
        fullContent += token;
        write(tokenChunk(token));
      }
    }
  } catch (err) {
    // Mid-stream errors are rare but possible (e.g. network drop, server reset).
    // Emit an error chunk so the UI surfaces a message instead of hanging.
    log("error", "chat.llm.error", {
      sessionPrefix: sessionId.slice(0, 8),
      stage:         "stream_read",
      latencyMs:     llmTimer(),
      totalMs:       totalMs(),
    });
    write(errorChunk(classifyOpenAIError(err)));
    return;
  }

  // Log LLM completion metadata — response length is a useful proxy for
  // token consumption when usage stats are not available in streaming mode.
  //
  // ANALYTICS HOOK: pipe "chat.llm.complete" to track p50/p95 latency
  // and response lengths in a time-series dashboard.
  const llmLatencyMs = llmTimer();
  log("info", "chat.llm.complete", {
    sessionPrefix:       sessionId.slice(0, 8),
    model:               CHAT_MODEL,
    responseLengthChars: fullContent.length,
    latencyMs:           llmLatencyMs,
    totalMs:             totalMs(),
  });

  qs.llmLatencyMs = llmLatencyMs;

  // Guard: if the model returned nothing, send a safe fallback rather than
  // letting downstream code operate on an empty string.
  if (!fullContent.trim()) {
    log("warn", "chat.llm.empty_response", {
      sessionPrefix: sessionId.slice(0, 8),
      totalMs:       totalMs(),
    });
    const fallback = "No response was generated. Please try again.";
    await streamText(fallback, write);
    write(
      metadataChunk({
        sessionId,
        citations:          [],
        recommendations:    [],
        structuredResponse: validateStructuredResponse({ answer: fallback }),
      })
    );
    await safelyPersistTurn(sessionId, message, fallback);
    qs.usedFallback = true;
    qs.latencyMs    = totalMs();
    emitQualitySignal(qs);
    return;
  }

  // ── Step 9: Build and send metadata chunk ─────────────────────────────────
  //
  // Citations and related policies are derived from the retrieved chunks —
  // not from LLM output — so every source reference points to a real chunk.
  //
  // parseModelOutput strips the model-inserted "Source: …" lines and the
  // complexity recommendation note (both rendered by dedicated UI components),
  // then splits the remaining prose into answer + explanation at paragraph
  // boundaries.  fullContent is preserved as-is for session history so the
  // model can reference its previous citations in follow-up turns.

  const citations      = buildCitationObjects(chunks);

  // Defensive: formatCitations drops chunks with invalid metadata.  If all
  // chunks failed validation the answer text is already streamed — we can't
  // un-send it, but we log loudly for ops visibility so the vector store can
  // be fixed.  An empty citations array is sent as-is; the UI hides the
  // Sources section when the array is empty.
  if (citations.length === 0) {
    log("error", "chat.citations.all_invalid", {
      sessionPrefix: sessionId.slice(0, 8),
      retrievedChunks: chunks.length,
    });
    console.error(
      `[route] All ${chunks.length} retrieved chunk(s) failed citation validation. ` +
      "Answer was streamed without verifiable sources. " +
      "Re-run 'npm run ingest' to rebuild the vector store."
    );
  }

  const recommendations = buildRecommendations(citations, fullContent);
  const parsed          = parseModelOutput(fullContent);

  const structuredResponse: StructuredResponse = validateStructuredResponse({
    answer:          parsed.answer,
    explanation:     parsed.explanation,
    // Derive related policies from chunk metadata — surfaces documents that
    // were retrieved but not the top-scoring match, giving the user
    // navigational context beyond the direct answer.
    relatedPolicies: deriveRelatedPolicies(citations),
  });

  // Populate output-quality fields on the signal before emitting.
  qs.citationCount        = citations.length;
  qs.hadCitations         = citations.length > 0;
  qs.recommendationCount  = recommendations.length;
  qs.hadRecommendations   = recommendations.length > 0;

  // Log metadata assembly stats — useful for monitoring recommendation
  // trigger rates and citation quality over time.
  log("info", "chat.metadata.assembled", {
    sessionPrefix:       sessionId.slice(0, 8),
    citationCount:       citations.length,
    recommendationCount: recommendations.length,
    hasExplanation:      Boolean(parsed.explanation),
    relatedPolicyCount:  structuredResponse.relatedPolicies?.length ?? 0,
  });

  write(
    metadataChunk({
      sessionId,
      citations,
      recommendations,
      structuredResponse,
    })
  );

  // ── Step 10: Output guard (Layer 3) ────────────────────────────────────────
  // Validates the completed model output for injection artefacts, system-prompt
  // leakage, and NDJSON fragments.  Runs after streaming so it cannot suppress
  // already-sent tokens, but it logs anomalies for ops review and ensures the
  // version persisted in session memory is the validated copy.

  const { sanitizedContent, flagged, reasons } = validateModelOutput(fullContent);

  // ANALYTICS HOOK: pipe "chat.output.guard.flagged" events to a
  // security alert channel (Slack webhook, PagerDuty, etc.) for prompt
  // injection / system-prompt leak monitoring.
  qs.outputFlagged = flagged;
  if (flagged) {
    qs.refusalTriggered = true;
    log("warn", "chat.output.guard.flagged", {
      sessionPrefix: sessionId.slice(0, 8),
      reasonCount:   reasons.length,
      // Individual reasons logged at warn level — safe strings, not content
      reasons:       reasons.join("; "),
    });
  } else {
    log("info", "chat.output.guard.clean", {
      sessionPrefix: sessionId.slice(0, 8),
    });
  }

  // ── Step 11: Persist turn ──────────────────────────────────────────────────
  // Non-fatal — a storage failure must not surface an error to the user since
  // the answer has already been streamed successfully.

  await safelyPersistTurn(sessionId, message, sanitizedContent);

  // Final end-to-end latency — recorded after persist since the pipeline is
  // not complete until history is written.
  log("info", "chat.request.complete", {
    sessionPrefix: sessionId.slice(0, 8),
    totalMs:       totalMs(),
  });

  // Emit quality signal — one record per completed request covering all fields.
  qs.latencyMs = totalMs();
  emitQualitySignal(qs);
}

// ── Refusal stream ─────────────────────────────────────────────────────────────

/**
 * Streams a guardrail refusal as a normal NDJSON response.
 * The UI renders it identically to an answer (no special error treatment),
 * but structuredResponse.refusal is set to true for optional amber styling.
 */
function streamRefusal(reason: string, sessionId: string | null): Response {
  const resolvedId = sessionId ?? crypto.randomUUID();

  return createNdJsonStream(async (write) => {
    await streamText(reason, write);

    write(
      metadataChunk({
        sessionId:          resolvedId,
        citations:          [],
        recommendations:    [],
        structuredResponse: { answer: reason, refusal: true },
      })
    );
  });
}

// ── Assembly helpers ───────────────────────────────────────────────────────────

/**
 * Extracts related-policy suggestions from retrieved chunk metadata.
 *
 * Returns the unique policyTitle + policyCategory pairs from all retrieved
 * chunks, sorted by category.  The UI can display these as navigational links
 * below the answer ("You might also want to read…").
 *
 * Excludes the top-scoring document — that one is already the main citation.
 * Capped at 3 suggestions to avoid clutter.
 */
function deriveRelatedPolicies(
  chunks: ReturnType<typeof buildCitationObjects>
) {
  if (chunks.length <= 1) return undefined;

  const topDoc = chunks[0]?.sourceFile;

  const seen = new Set<string>();
  const related: Array<{ title: string; category: string }> = [];

  for (const c of chunks.slice(1)) {
    if (c.sourceFile === topDoc) continue; // skip further chunks from primary doc
    const key = c.policyTitle;
    if (!seen.has(key)) {
      seen.add(key);
      related.push({
        title:    c.policyTitle,
        category: c.policyCategory ?? "General HR Policy",
      });
    }
    if (related.length >= 3) break;
  }

  return related.length > 0 ? related : undefined;
}

// ── Session persistence ────────────────────────────────────────────────────────

/**
 * Persists a completed conversation turn to short-term memory.
 *
 * Appends the user message and assistant reply as individual entries, then
 * trims the session to the sliding window.  Keeping the trim here (rather
 * than inside appendToSessionMemory) makes the batch atomic from the
 * caller's perspective and maps cleanly to a Redis pipeline:
 *   RPUSH key userMsg
 *   RPUSH key assistantMsg
 *   LTRIM key -WINDOW_SIZE -1
 *
 * The full raw assistant text (including inline "Source:" lines) is stored
 * so the model sees its prior citations when answering follow-up questions.
 */
async function persistTurn(
  sessionId:        string,
  userContent:      string,
  assistantContent: string
): Promise<void> {
  const userMsg: ChatMessage = {
    id:        crypto.randomUUID(),
    role:      "user",
    content:   userContent,
    createdAt: new Date(),
  };
  const assistantMsg: ChatMessage = {
    id:        crypto.randomUUID(),
    role:      "assistant",
    content:   assistantContent,
    createdAt: new Date(),
  };

  await appendToSessionMemory(sessionId, userMsg);
  await appendToSessionMemory(sessionId, assistantMsg);
  await trimSessionMemory(sessionId);
}

/**
 * Non-fatal wrapper around persistTurn.
 *
 * Session storage is a best-effort operation — the answer has already been
 * streamed to the client when this is called.  If storage throws (e.g. memory
 * pressure, future Redis timeout), we log the error and continue rather than
 * surfacing it to the user as an error chunk.
 */
async function safelyPersistTurn(
  sessionId:        string,
  userContent:      string,
  assistantContent: string
): Promise<void> {
  try {
    await persistTurn(sessionId, userContent, assistantContent);
  } catch (err) {
    console.error(
      `[route] Failed to persist turn for session ${sessionId}:`,
      err instanceof Error ? err.message : err
    );
    // Do not re-throw — the streamed answer is already with the client.
  }
}
