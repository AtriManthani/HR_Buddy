/**
 * lib/api/validation.ts — request validation for POST /api/chat.
 *
 * Intentionally zero-dependency (no Zod, no Yup). The schema is small enough
 * that manual validation produces clearer error messages and avoids a runtime
 * dependency that would inflate the serverless bundle.
 *
 * Validation layers (in execution order inside the route handler):
 *
 *  1. checkContentType()   — must be application/json before req.json() is called
 *  2. checkBodySize()      — Content-Length must be below MAX_BODY_BYTES
 *  3. validateChatRequest()— schema shape, field types, UUID format
 *  4. sanitizeInput()      — structural cleaning (sanitize.ts)
 *  5. checkGuardrails()    — intent filtering (guardrails.ts)
 *
 * All validation errors throw a ValidationError with a 400-ready message.
 * The route catches these and returns a JSON 400 before starting the stream.
 *
 * MAX_MESSAGE_LENGTH is exported so sanitize.ts can import it — a single
 * source of truth prevents the two files drifting out of sync.
 */

import type { ChatRequest } from "@/types";

// ── Error type ────────────────────────────────────────────────────────────────

export class ValidationError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "ValidationError";
    this.statusCode = statusCode;
  }
}

// ── Shared constants ──────────────────────────────────────────────────────────

/**
 * Maximum allowed message length in characters.
 *
 * Exported and re-used by lib/security/sanitize.ts — both files enforce
 * this limit so the constant must be changed in exactly one place.
 *
 * 2 000 characters is sufficient for any reasonable policy question while
 * preventing token-stuffing attacks (~500 tokens at the gpt-4o-mini rate).
 */
export const MAX_MESSAGE_LENGTH = 2_000;

/**
 * Maximum allowed raw request body size in bytes before JSON parsing.
 *
 * A 2 000-character UTF-8 message with JSON overhead and a UUID sessionId
 * stays well under 4 KB.  50 KB gives ample room while stopping memory-
 * exhaustion attacks that send multi-megabyte bodies before validation runs.
 */
export const MAX_BODY_BYTES = 50_000;

// ── Pre-parse guards ──────────────────────────────────────────────────────────

/**
 * Verifies the request carries a JSON Content-Type before req.json() is called.
 *
 * Without this check, a request with Content-Type: text/plain still reaches
 * req.json(), which parses whatever arrives and can throw unpredictable errors
 * depending on the runtime.
 *
 * @throws ValidationError (415) when Content-Type is absent or non-JSON.
 */
export function checkContentType(req: { headers: { get(name: string): string | null } }): void {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw new ValidationError(
      "Content-Type must be application/json.",
      415
    );
  }
}

/**
 * Checks Content-Length against MAX_BODY_BYTES before the body is read.
 *
 * Rejects large requests early — before req.json() allocates a buffer —
 * to prevent memory-exhaustion via oversized request bodies.
 *
 * Note: Content-Length may be absent (chunked transfer encoding) or spoofed.
 * This is a best-effort early gate, not a guarantee.  The runtime's own body
 * size limit is the hard backstop.
 *
 * @throws ValidationError (413) when Content-Length exceeds MAX_BODY_BYTES.
 */
export function checkBodySize(req: { headers: { get(name: string): string | null } }): void {
  const raw = req.headers.get("content-length");
  if (raw === null) return; // absent → chunked, let the runtime enforce its own limit

  const bytes = parseInt(raw, 10);
  if (!Number.isFinite(bytes) || bytes < 0) return; // malformed header → ignore

  if (bytes > MAX_BODY_BYTES) {
    throw new ValidationError(
      `Request body too large. Maximum allowed size is ${MAX_BODY_BYTES} bytes.`,
      413
    );
  }
}

// ── Schema validator ──────────────────────────────────────────────────────────

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Parses and validates a raw request body against the ChatRequest schema.
 *
 * Checks (in order):
 *   1. Body is a non-null, non-array object
 *   2. `message` is present, is a string, is not whitespace-only, and is
 *      within MAX_MESSAGE_LENGTH (checked pre-trim to catch padding attacks)
 *   3. `sessionId` is either null or a valid UUID v4 string
 *
 * @param body  - The parsed JSON body (unknown type from req.json())
 * @returns       A validated ChatRequest object
 * @throws        ValidationError with a safe user-facing message on any failure
 */
export function validateChatRequest(body: unknown): ChatRequest {
  // ── 1. Shape check ────────────────────────────────────────────────────────

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;

  // ── 2. message field ──────────────────────────────────────────────────────

  if (!("message" in raw)) {
    throw new ValidationError('Missing required field: "message".');
  }

  if (typeof raw.message !== "string") {
    throw new ValidationError('"message" must be a string.');
  }

  // Check raw length before trimming — prevents padding attacks where an
  // attacker pads content to exactly the limit then trims to reach it.
  if (raw.message.length > MAX_MESSAGE_LENGTH) {
    throw new ValidationError(
      `Message is too long. Please keep your question under ${MAX_MESSAGE_LENGTH} characters.`
    );
  }

  const message = raw.message.trim();

  if (message.length === 0) {
    throw new ValidationError("Message cannot be empty. Please type a question.");
  }

  // ── 3. sessionId field ────────────────────────────────────────────────────

  if (!("sessionId" in raw)) {
    throw new ValidationError('Missing required field: "sessionId".');
  }

  const sessionId = raw.sessionId;

  if (sessionId !== null) {
    if (typeof sessionId !== "string") {
      throw new ValidationError('"sessionId" must be a string or null.');
    }
    if (!UUID_V4_RE.test(sessionId)) {
      throw new ValidationError('"sessionId" must be a valid UUID v4 or null.');
    }
  }

  return {
    message,
    sessionId: sessionId as string | null,
  };
}

// ── Error response helpers ────────────────────────────────────────────────────

/**
 * Builds a JSON error response for pre-stream validation failures.
 * Used before the NDJSON stream opens — a plain JSON body is appropriate.
 */
export function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Converts any thrown value into a safe JSON error response.
 *
 * ValidationErrors use their own statusCode and message.
 * All other errors are treated as 400 Bad Request with a generic message
 * so that internal exception text never reaches the client.
 */
export function toJsonError(err: unknown): Response {
  if (err instanceof ValidationError) {
    return jsonError(err.message, err.statusCode);
  }
  // Do not expose the real error — log server-side, return generic message.
  console.error("[validation] Unexpected error:", err);
  return jsonError("Invalid request.", 400);
}
