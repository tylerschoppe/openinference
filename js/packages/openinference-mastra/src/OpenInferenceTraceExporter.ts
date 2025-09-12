import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { ExportResult } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";

import {
  processMastraSpanAttributes,
  markUnlabeledRootSpansInAgentTraces,
  addIOToRootSpans,
  getTraceId,
} from "./attributes.js";

type ConstructorArgs = {
  /**
   * A function that filters the spans to be exported.
   * If provided, the span will be exported if the function returns `true`.
   *
   * @example
   * ```ts
   * import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
   * import { isOpenInferenceSpan, OpenInferenceOTLPTraceExporter } from "@arizeai/openinference-mastra";
   * const spanFilter = (span: ReadableSpan) => {
   *   // add more span filtering logic here if desired
   *   // or just use the default isOpenInferenceSpan filter directly
   *   return isOpenInferenceSpan(span);
   * };
   * const exporter = new OpenInferenceOTLPTraceExporter({
   *   url: "...",
   *   headers: "...",
   *   spanFilter,
   * });
   * ```
   */
  spanFilter?: (span: ReadableSpan) => boolean;
  /**
   * TTL in milliseconds for individual traces in the buffer before they are flushed.
   * Each trace starts its own TTL timer when first buffered.
   * Default: 5000ms (5 seconds)
   */
  traceBufferTtlMs?: number;
  /**
   * Global fallback TTL in milliseconds to prevent spans from getting stuck indefinitely.
   * This acts as a safety net if root spans never arrive.
   * Default: 30000ms (30 seconds)
   */
  globalBufferTtlMs?: number;
} & NonNullable<ConstructorParameters<typeof OTLPTraceExporter>[0]>;

/**
 * A custom OpenTelemetry trace exporter that appends OpenInference semantic conventions to spans prior to export
 *
 * This class extends the `OTLPTraceExporter` and adds additional logic to the `export` method to augment the spans with OpenInference attributes.
 *
 * @example
 * ```ts
 * import { Mastra } from "@mastra/core/mastra";
 * import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
 * import { isOpenInferenceSpan, OpenInferenceOTLPTraceExporter } from "@arizeai/openinference-mastra";
 * const spanFilter = (span: ReadableSpan) => {
 *   // add more span filtering logic here if desired
 *   // or just use the default isOpenInferenceSpan filter directly
 *   return isOpenInferenceSpan(span);
 * };
 * const exporter = new OpenInferenceOTLPTraceExporter({
 *   apiKey: "api-key",
 *   collectorEndpoint: "http://localhost:6006/v1/traces",
 *   spanFilter,
 * });
 * const mastra = new Mastra({
 *   // ... other config
 *   telemetry: {
 *     export: {
 *       type: "custom",
 *       exporter,
 *     },
 *   },
 * })
 * ```
 */
export class OpenInferenceOTLPTraceExporter extends OTLPTraceExporter {
  private readonly spanFilter?: (span: ReadableSpan) => boolean;
  private readonly traceBufferTtlMs: number;
  private readonly globalBufferTtlMs: number;
  private readonly spanBuffer = new Map<string, ReadableSpan[]>();
  private readonly traceBufferTimestamps = new Map<string, number>();
  private flushTimeoutHandle?: NodeJS.Timeout;

  constructor({ 
    spanFilter, 
    traceBufferTtlMs = 5000, 
    globalBufferTtlMs = 30000, 
    ...args 
  }: ConstructorArgs) {
    super({
      ...args,
    });
    this.spanFilter = spanFilter;
    this.traceBufferTtlMs = traceBufferTtlMs;
    this.globalBufferTtlMs = globalBufferTtlMs;
  }

  private hasRootSpan(spans: ReadableSpan[]): boolean {
    return spans.some(span => span.parentSpanContext === undefined);
  }

  private processSpansForExport(spans: ReadableSpan[]): ReadableSpan[] {
    let processedSpans = spans.map((span) => {
      processMastraSpanAttributes(span);
      return span;
    });
    markUnlabeledRootSpansInAgentTraces(processedSpans);
    addIOToRootSpans(processedSpans);

    if (this.spanFilter) {
      processedSpans = processedSpans.filter(this.spanFilter);
    }

    return processedSpans;
  }

  private flushExpiredTraces(resultCallback: (result: ExportResult) => void): void {
    const now = Date.now();
    const expiredTraces: string[] = [];
    const spansToFlush: ReadableSpan[] = [];

    for (const [traceId, timestamp] of this.traceBufferTimestamps.entries()) {
      const traceAge = now - timestamp;
      const isExpiredByTraceTtl = traceAge >= this.traceBufferTtlMs;
      const isExpiredByGlobalTtl = traceAge >= this.globalBufferTtlMs;

      if (isExpiredByTraceTtl || isExpiredByGlobalTtl) {
        expiredTraces.push(traceId);
        const spans = this.spanBuffer.get(traceId);
        if (spans) {
          spansToFlush.push(...spans);
        }
      }
    }

    // Remove expired traces from buffer and timestamps
    for (const traceId of expiredTraces) {
      this.spanBuffer.delete(traceId);
      this.traceBufferTimestamps.delete(traceId);
    }

    if (spansToFlush.length > 0) {
      const processedSpans = this.processSpansForExport(spansToFlush);
      super.export(processedSpans, resultCallback);
    }
  }

  private getNextCheckInterval(): number {
    if (this.traceBufferTimestamps.size === 0) {
      return this.traceBufferTtlMs;
    }

    const now = Date.now();
    let shortestTimeToExpiry = Math.min(this.traceBufferTtlMs, this.globalBufferTtlMs);

    for (const timestamp of this.traceBufferTimestamps.values()) {
      const age = now - timestamp;
      const timeToTraceTtlExpiry = this.traceBufferTtlMs - age;
      const timeToGlobalTtlExpiry = this.globalBufferTtlMs - age;
      
      // Consider the sooner of the two TTLs
      const timeToExpiry = Math.min(timeToTraceTtlExpiry, timeToGlobalTtlExpiry);
      
      if (timeToExpiry > 0 && timeToExpiry < shortestTimeToExpiry) {
        shortestTimeToExpiry = timeToExpiry;
      }
    }

    return Math.max(shortestTimeToExpiry, 100); // Minimum 100ms interval
  }

  private scheduleFlushTimeout(resultCallback: (result: ExportResult) => void): void {
    if (this.flushTimeoutHandle) {
      clearTimeout(this.flushTimeoutHandle);
    }

    const interval = this.getNextCheckInterval();
    this.flushTimeoutHandle = setTimeout(() => {
      this.flushExpiredTraces(resultCallback);
      
      // Reschedule if there are still buffered spans
      if (this.spanBuffer.size > 0) {
        this.scheduleFlushTimeout(resultCallback);
      } else {
        this.flushTimeoutHandle = undefined;
      }
    }, interval);
  }
  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ) {
    const spansWithoutTraceId: ReadableSpan[] = [];
    const spansByTrace = new Map<string, ReadableSpan[]>();

    // Group incoming spans by trace ID, handle spans without trace ID separately
    for (const span of spans) {
      const traceId = getTraceId(span);
      if (!traceId) {
        // Process spans without trace IDs immediately (fallback to old behavior)
        spansWithoutTraceId.push(span);
        continue;
      }

      // Add to current batch
      let currentBatch = spansByTrace.get(traceId);
      if (!currentBatch) {
        currentBatch = [];
        spansByTrace.set(traceId, currentBatch);
      }
      currentBatch.push(span);

      // Add to buffer and track timestamp for new traces
      let bufferedSpans = this.spanBuffer.get(traceId);
      if (!bufferedSpans) {
        bufferedSpans = [];
        this.spanBuffer.set(traceId, bufferedSpans);
        // Record when this trace was first buffered
        this.traceBufferTimestamps.set(traceId, Date.now());
      }
      bufferedSpans.push(span);
    }

    // Process spans without trace IDs immediately
    if (spansWithoutTraceId.length > 0) {
      const processedSpans = this.processSpansForExport(spansWithoutTraceId);
      super.export(processedSpans, resultCallback);
    }

    // Check which traces are now complete (have root spans) and can be processed
    const completedTraces: string[] = [];
    const spansToProcess: ReadableSpan[] = [];

    for (const [traceId, bufferedSpans] of this.spanBuffer.entries()) {
      if (this.hasRootSpan(bufferedSpans)) {
        completedTraces.push(traceId);
        spansToProcess.push(...bufferedSpans);
      }
    }

    // Remove completed traces from buffer and timestamps
    for (const traceId of completedTraces) {
      this.spanBuffer.delete(traceId);
      this.traceBufferTimestamps.delete(traceId);
    }

    // Process and export completed traces immediately
    if (spansToProcess.length > 0) {
      const processedSpans = this.processSpansForExport(spansToProcess);
      super.export(processedSpans, resultCallback);
    }

    // Schedule timeout for any remaining buffered spans
    if (this.spanBuffer.size > 0) {
      this.scheduleFlushTimeout(resultCallback);
    }
  }

  override shutdown(): Promise<void> {
    // Clear timeout and flush any remaining spans before shutdown
    if (this.flushTimeoutHandle) {
      clearTimeout(this.flushTimeoutHandle);
      this.flushTimeoutHandle = undefined;
    }
    
    // Flush any remaining buffered spans
    if (this.spanBuffer.size > 0) {
      const allBufferedSpans: ReadableSpan[] = [];
      for (const spans of this.spanBuffer.values()) {
        allBufferedSpans.push(...spans);
      }
      this.spanBuffer.clear();
      this.traceBufferTimestamps.clear();
      
      if (allBufferedSpans.length > 0) {
        const processedSpans = this.processSpansForExport(allBufferedSpans);
        super.export(processedSpans, () => {});
      }
    }
    
    return super.shutdown();
  }
}
