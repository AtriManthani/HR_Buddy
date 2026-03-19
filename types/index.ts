/**
 * types/index.ts — barrel re-export for all domain type modules.
 *
 * Every file in the codebase that imports from "@/types" continues to work
 * without change. The individual modules are also importable directly
 * (e.g. import type { PolicyChunk } from "@/types/rag") for co-location
 * of narrowly-scoped imports.
 *
 * Module map:
 *   types/chat.ts      — MessageRole, ChatMessage, SessionState, SessionSummary
 *   types/rag.ts       — ChunkMetadata, RawChunk, PolicyChunk, RetrievedChunk, IngestRecord
 *   types/citations.ts — Citation, Recommendation, RelatedPolicy
 *   types/response.ts  — ModelResponse, StructuredResponse, OutOfScopeResult
 *   types/api.ts       — ChatRequest, TokenChunk, MetadataChunk, ErrorChunk,
 *                        StreamChunk, ApiErrorResponse, PipelineContext, ChatCompletionMessage
 *   types/security.ts  — RefusalCategory, GuardrailResult, RefusalDefinition
 *   types/ui.ts        — DisplayMessage, ChatStatus, ChatState, ChatActions
 */

export type {
  MessageRole,
  ChatMessage,
  SessionState,
  SessionSummary,
} from "./chat";

export type {
  ChunkMetadata,
  RawChunk,
  PolicyChunk,
  RetrievedChunk,
  IngestRecord,
} from "./rag";

export type {
  Citation,
  Recommendation,
  RecommendationType,
  RelatedPolicy,
} from "./citations";

export type {
  ModelResponse,
  StructuredResponse,
  OutOfScopeResult,
} from "./response";

export type {
  ChatRequest,
  TokenChunk,
  MetadataChunk,
  ErrorChunk,
  StreamChunk,
  ApiErrorResponse,
  PipelineContext,
  ChatCompletionMessage,
} from "./api";

export type {
  RefusalCategory,
  GuardrailResult,
  RefusalDefinition,
} from "./security";

export type {
  DisplayMessage,
  ChatStatus,
  ChatState,
  ChatActions,
} from "./ui";
