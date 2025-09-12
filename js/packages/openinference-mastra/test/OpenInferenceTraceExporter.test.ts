import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { OpenInferenceOTLPTraceExporter } from "../src/OpenInferenceTraceExporter.js";
import { isOpenInferenceSpan } from "../src/utils.js";
import weatherAgentSpans from "./__fixtures__/weatherAgentSpans.json";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { SemanticConventions } from "@arizeai/openinference-semantic-conventions";
import type { Mock } from "vitest";

vi.mock(import("@opentelemetry/exporter-trace-otlp-proto"), () => {
  const mockedClass = vi.fn();
  mockedClass.prototype.export = vi.fn();
  return {
    OTLPTraceExporter: mockedClass,
  };
});

describe("OpenInferenceTraceExporter", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should initialize without throwing an error", () => {
    new OpenInferenceOTLPTraceExporter({
      url: "http://example.com/v1/traces",
      headers: {
        Authorization: "Bearer test-api-key",
      },
    });
  });

  // Quickly capture a known working state of the instrumentation to ensure
  // we don't regress.
  // TODO: Replace with a more fine-grained test that is easier to update over
  // time with the changes in the instrumentation.
  it("(snapshot) should export spans with openinference properties", async () => {
    const exporter = new OpenInferenceOTLPTraceExporter({
      url: "http://example.com/v1/traces",
      headers: {
        Authorization: "Bearer test-api-key",
      },
    });
    exporter.export(weatherAgentSpans as unknown as ReadableSpan[], () => {});
    await expect(
      // @ts-expect-error - mock.calls is provided by vitest
      OTLPTraceExporter.prototype.export.mock.calls,
    ).toMatchFileSnapshot(
      `./__snapshots__/OpenInferenceTraceExporter.test.ts.export.json`,
    );
  });

  it("should filter spans based on the spanFilter function", async () => {
    const exporter = new OpenInferenceOTLPTraceExporter({
      url: "http://example.com/v1/traces",
      headers: {
        Authorization: "Bearer test-api-key",
      },
      spanFilter: (span) =>
        span.name === "POST /api/agents/weatherAgent/stream",
    });
    exporter.export(weatherAgentSpans as unknown as ReadableSpan[], () => {});
    expect(
      // @ts-expect-error - mock.calls is provided by vitest
      OTLPTraceExporter.prototype.export.mock.calls,
    ).toMatchInlineSnapshot(`
      [
        [
          [
            {
              "attributes": {
                "http.flavor": "1.1",
                "http.host": "localhost:4111",
                "http.method": "POST",
                "http.request_content_length_uncompressed": 251,
                "http.request_id": "98823c5f-b2ec-4a4e-a056-f22f7bcb53ae",
                "http.scheme": "http",
                "http.status_code": 200,
                "http.status_text": "OK",
                "http.target": "/api/agents/weatherAgent/stream",
                "http.url": "http://localhost:4111/api/agents/weatherAgent/stream",
                "http.user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
                "net.host.ip": "::1",
                "net.host.name": "localhost",
                "net.host.port": 4111,
                "net.peer.ip": "::1",
                "net.peer.port": 51258,
                "net.transport": "ip_tcp",
                "openinference.span.kind": undefined,
              },
              "endTime": [
                1747754797,
                193654459,
              ],
              "kind": 1,
              "name": "POST /api/agents/weatherAgent/stream",
              "resource": {
                "attributes": {
                  "openinference.project.name": "mock",
                  "service.name": "mock",
                },
              },
              "startTime": [
                1747754793,
                713000000,
              ],
              "status": {
                "code": 0,
              },
            },
          ],
          [Function],
        ],
      ]
    `);
  });

  it("should map threadId to SESSION_ID attribute", async () => {
    const mockSpan = {
      name: "agent.test",
      attributes: {
        threadId: "test-thread-id-123",
        "other.attribute": "value",
      },
      resource: {
        attributes: {
          "service.name": "test-service",
        },
      },
    } as unknown as ReadableSpan;

    const exporter = new OpenInferenceOTLPTraceExporter({
      url: "http://example.com/v1/traces",
      headers: {
        Authorization: "Bearer test-api-key",
      },
    });

    exporter.export([mockSpan], () => {});

    // Check that the threadId was mapped to SESSION_ID
    expect(mockSpan.attributes[SemanticConventions.SESSION_ID]).toBe(
      "test-thread-id-123",
    );
    // Original threadId should still be present
    expect(mockSpan.attributes.threadId).toBe("test-thread-id-123");
    // Other attributes should remain unchanged
    expect(mockSpan.attributes["other.attribute"]).toBe("value");
  });

  it("should map numeric threadId to SESSION_ID attribute", async () => {
    const mockSpan = {
      name: "agent.test",
      attributes: {
        threadId: 123456, // numeric threadId
        "other.attribute": "value",
      },
      resource: {
        attributes: {
          "service.name": "test-service",
        },
      },
    } as unknown as ReadableSpan;

    const exporter = new OpenInferenceOTLPTraceExporter({
      url: "http://example.com/v1/traces",
      headers: {
        Authorization: "Bearer test-api-key",
      },
    });

    exporter.export([mockSpan], () => {});

    // Should have SESSION_ID with numeric threadId
    expect(mockSpan.attributes[SemanticConventions.SESSION_ID]).toBe("123456");
    // Original threadId should still be present
    expect(mockSpan.attributes.threadId).toBe(123456);
  });

  it("should not add SESSION_ID if threadId is not string or number", async () => {
    const mockSpan = {
      name: "agent.test",
      attributes: {
        threadId: true, // boolean instead of string/number
        "other.attribute": "value",
      },
      resource: {
        attributes: {
          "service.name": "test-service",
        },
      },
    } as unknown as ReadableSpan;

    const exporter = new OpenInferenceOTLPTraceExporter({
      url: "http://example.com/v1/traces",
      headers: {
        Authorization: "Bearer test-api-key",
      },
    });

    exporter.export([mockSpan], () => {});

    // Should not have SESSION_ID since threadId is boolean
    expect(mockSpan.attributes[SemanticConventions.SESSION_ID]).toBeUndefined();
  });

  it("should not add SESSION_ID if threadId is missing", async () => {
    const mockSpan = {
      name: "agent.test",
      attributes: {
        "other.attribute": "value",
      },
      resource: {
        attributes: {
          "service.name": "test-service",
        },
      },
    } as unknown as ReadableSpan;

    const exporter = new OpenInferenceOTLPTraceExporter({
      url: "http://example.com/v1/traces",
      headers: {
        Authorization: "Bearer test-api-key",
      },
    });

    exporter.export([mockSpan], () => {});

    // Should not have SESSION_ID since threadId is missing
    expect(mockSpan.attributes[SemanticConventions.SESSION_ID]).toBeUndefined();
  });

  it("should not overwrite existing SESSION_ID when threadId is present", async () => {
    const mockSpan = {
      name: "agent.test",
      attributes: {
        threadId: "new-thread-123",
        [SemanticConventions.SESSION_ID]: "existing-session-456", // Pre-existing SESSION_ID
      },
      resource: {
        attributes: {
          "service.name": "test-service",
        },
      },
    } as unknown as ReadableSpan;

    const exporter = new OpenInferenceOTLPTraceExporter({
      url: "http://example.com/v1/traces",
      headers: {
        Authorization: "Bearer test-api-key",
      },
    });

    exporter.export([mockSpan], () => {});

    // Should preserve existing SESSION_ID, not overwrite with threadId
    expect(mockSpan.attributes[SemanticConventions.SESSION_ID]).toBe(
      "existing-session-456",
    );
    // threadId should remain unchanged
    expect(mockSpan.attributes.threadId).toBe("new-thread-123");
  });

  it("should add missing root span when agent operations exist in trace", async () => {
    const rootSpan = {
      name: "http.request",
      parentSpanContext: undefined, // This is a root span
      spanContext: () => ({
        spanId: "root-id",
        traceId: "trace-123",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: {},
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    const agentSpan = {
      name: "agent.process",
      parentSpanContext: { spanId: "root-id" },
      spanContext: () => ({
        spanId: "agent-id",
        traceId: "trace-123",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: { threadId: "thread-1" },
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    const exporter = new OpenInferenceOTLPTraceExporter({
      url: "http://example.com/v1/traces",
      spanFilter: isOpenInferenceSpan,
    });

    exporter.export([rootSpan, agentSpan], () => {});

    const exportedSpans = (OTLPTraceExporter.prototype.export as Mock).mock
      .calls[0][0];

    // Should have 2 spans: the filtered agent span + the added root span
    expect(exportedSpans).toHaveLength(2);

    // Check that root span was added
    const addedRootSpan = exportedSpans.find(
      (s: ReadableSpan) => s.name === "http.request",
    );
    expect(addedRootSpan).toBeDefined();
    expect(
      addedRootSpan.attributes[SemanticConventions.OPENINFERENCE_SPAN_KIND],
    ).toBe("AGENT");
  });

  it("should add input and output to root spans when I/O data is available", async () => {
    const rootSpan = {
      name: "POST /copilotkit",
      parentSpanContext: undefined, // This is a root span
      spanContext: () => ({
        spanId: "root-id",
        traceId: "trace-123",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: {
        "http.method": "POST",
        "http.url": "http://localhost:4111/copilotkit",
      },
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    // Span containing user input in getMostRecentUserMessage result
    const userMessageSpan = {
      name: "agent.getMostRecentUserMessage",
      parentSpanContext: { spanId: "root-id" },
      spanContext: () => ({
        spanId: "user-msg-id",
        traceId: "trace-123",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: {
        "agent.getMostRecentUserMessage.result": JSON.stringify({
          id: "msg-123",
          role: "user",
          content: "what is the weather today?",
          createdAt: "2025-01-15T10:00:00Z",
        }),
      },
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    // Span containing agent output
    const outputSpan = {
      name: "ai.streamText",
      parentSpanContext: { spanId: "root-id" },
      spanContext: () => ({
        spanId: "output-id",
        traceId: "trace-123",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: {
        [SemanticConventions.OUTPUT_VALUE]:
          "The weather today is sunny with a high of 75°F.",
      },
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    const exporter = new OpenInferenceOTLPTraceExporter({
      url: "http://example.com/v1/traces",
    });

    exporter.export([rootSpan, userMessageSpan, outputSpan], () => {});

    // Check that input and output were added to root span
    expect(rootSpan.attributes[SemanticConventions.INPUT_VALUE]).toBe(
      "what is the weather today?",
    );
    expect(rootSpan.attributes[SemanticConventions.OUTPUT_VALUE]).toBe(
      "The weather today is sunny with a high of 75°F.",
    );
  });

  it("should successfully export when I/O data is not found", async () => {
    const rootSpan = {
      name: "POST /api/endpoint",
      parentSpanContext: undefined, // This is a root span
      spanContext: () => ({
        spanId: "root-id",
        traceId: "trace-456",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: {
        "http.method": "POST",
        "http.url": "http://localhost:3000/api/endpoint",
      },
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    // Span without I/O data - just a regular operation
    const regularSpan = {
      name: "database.query",
      parentSpanContext: { spanId: "root-id" },
      spanContext: () => ({
        spanId: "db-id",
        traceId: "trace-456",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: {
        "db.operation": "SELECT",
        "db.table": "users",
      },
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    const exporter = new OpenInferenceOTLPTraceExporter({
      url: "http://example.com/v1/traces",
    });

    // This should not throw an error
    expect(() => {
      exporter.export([rootSpan, regularSpan], () => {});
    }).not.toThrow();

    // Root span should not have I/O attributes since no I/O data was found
    expect(
      rootSpan.attributes[SemanticConventions.INPUT_VALUE],
    ).toBeUndefined();
    expect(
      rootSpan.attributes[SemanticConventions.INPUT_MIME_TYPE],
    ).toBeUndefined();
    expect(
      rootSpan.attributes[SemanticConventions.OUTPUT_VALUE],
    ).toBeUndefined();
    expect(
      rootSpan.attributes[SemanticConventions.OUTPUT_MIME_TYPE],
    ).toBeUndefined();

    // Should still call the underlying exporter
    expect(OTLPTraceExporter.prototype.export).toHaveBeenCalled();
  });

  it("should extract input from agent.stream.argument.0 when getMostRecentUserMessage is not available", async () => {
    const rootSpan = {
      name: "POST /copilotkit",
      parentSpanContext: undefined, // This is a root span
      spanContext: () => ({
        spanId: "root-id",
        traceId: "trace-789",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: {
        "http.method": "POST",
        "http.url": "http://localhost:4111/copilotkit",
      },
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    // Span containing conversation messages with the user input as the last user message
    const streamSpan = {
      name: "agent.stream",
      parentSpanContext: { spanId: "root-id" },
      spanContext: () => ({
        spanId: "stream-id",
        traceId: "trace-789",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: {
        "agent.stream.argument.0": JSON.stringify([
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Hello there!" },
          { role: "assistant", content: "Hi! How can I help you?" },
          { role: "user", content: "Tell me a joke" }, // This should be extracted as input
        ]),
      },
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    // Span containing agent output
    const outputSpan = {
      name: "ai.streamText",
      parentSpanContext: { spanId: "root-id" },
      spanContext: () => ({
        spanId: "output-id",
        traceId: "trace-789",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: {
        [SemanticConventions.OUTPUT_VALUE]:
          "Why don't scientists trust atoms? Because they make up everything!",
      },
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    const exporter = new OpenInferenceOTLPTraceExporter({
      url: "http://example.com/v1/traces",
    });

    exporter.export([rootSpan, streamSpan, outputSpan], () => {});

    // Check that input was extracted from the conversation messages (fallback method)
    expect(rootSpan.attributes[SemanticConventions.INPUT_VALUE]).toBe(
      "Tell me a joke",
    );
    expect(rootSpan.attributes[SemanticConventions.OUTPUT_VALUE]).toBe(
      "Why don't scientists trust atoms? Because they make up everything!",
    );
  });

  it("should extract input from agent.generate.argument.0 when other methods are not available", async () => {
    const rootSpan = {
      name: "POST /test",
      parentSpanContext: undefined, // This is a root span
      spanContext: () => ({
        spanId: "root-id",
        traceId: "trace-generate",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: {
        "http.method": "POST",
        "http.url": "http://localhost:4111/test",
      },
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    // Span containing direct user input via agent.generate.argument.0
    const generateSpan = {
      name: "agent.generate",
      parentSpanContext: { spanId: "root-id" },
      spanContext: () => ({
        spanId: "generate-id",
        traceId: "trace-generate",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: {
        "agent.generate.argument.0": '"What is the weather in Tokyo?"', // Quoted string as seen in actual spans
      },
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    // Span containing agent output
    const outputSpan = {
      name: "ai.generateText",
      parentSpanContext: { spanId: "root-id" },
      spanContext: () => ({
        spanId: "output-id",
        traceId: "trace-generate",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: {
        [SemanticConventions.OUTPUT_VALUE]:
          "The weather in Tokyo is currently cloudy with a temperature of 18°C.",
      },
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    const exporter = new OpenInferenceOTLPTraceExporter({
      url: "http://example.com/v1/traces",
    });

    exporter.export([rootSpan, generateSpan, outputSpan], () => {});

    // Check that input was extracted from agent.generate.argument.0 (with quote removal)
    expect(rootSpan.attributes[SemanticConventions.INPUT_VALUE]).toBe(
      "What is the weather in Tokyo?",
    );
    expect(rootSpan.attributes[SemanticConventions.OUTPUT_VALUE]).toBe(
      "The weather in Tokyo is currently cloudy with a temperature of 18°C.",
    );
  });

  it("should not overwrite existing I/O attributes on root spans", async () => {
    const rootSpan = {
      name: "POST /copilotkit",
      parentSpanContext: undefined, // This is a root span
      spanContext: () => ({
        spanId: "root-id",
        traceId: "trace-999",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: {
        "http.method": "POST",
        "http.url": "http://localhost:4111/copilotkit",
        // Pre-existing I/O attributes that should not be overwritten
        [SemanticConventions.INPUT_VALUE]: "existing input value",
        [SemanticConventions.INPUT_MIME_TYPE]: "application/json",
        [SemanticConventions.OUTPUT_VALUE]: "existing output value",
        [SemanticConventions.OUTPUT_MIME_TYPE]: "application/json",
      },
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    // Span containing new user input that should NOT overwrite existing
    const userMessageSpan = {
      name: "agent.getMostRecentUserMessage",
      parentSpanContext: { spanId: "root-id" },
      spanContext: () => ({
        spanId: "user-msg-id",
        traceId: "trace-999",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: {
        "agent.getMostRecentUserMessage.result": JSON.stringify({
          id: "msg-123",
          role: "user",
          content: "new input that should not overwrite",
          createdAt: "2025-01-15T10:00:00Z",
        }),
      },
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    // Span containing new agent output that should NOT overwrite existing
    const outputSpan = {
      name: "ai.streamText",
      parentSpanContext: { spanId: "root-id" },
      spanContext: () => ({
        spanId: "output-id",
        traceId: "trace-999",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: {
        [SemanticConventions.OUTPUT_VALUE]:
          "new output that should not overwrite",
      },
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    const exporter = new OpenInferenceOTLPTraceExporter({
      url: "http://example.com/v1/traces",
    });

    exporter.export([rootSpan, userMessageSpan, outputSpan], () => {});

    // Check that existing I/O attributes were preserved (not overwritten)
    expect(rootSpan.attributes[SemanticConventions.INPUT_VALUE]).toBe(
      "existing input value",
    );
    expect(rootSpan.attributes[SemanticConventions.INPUT_MIME_TYPE]).toBe(
      "application/json",
    );
    expect(rootSpan.attributes[SemanticConventions.OUTPUT_VALUE]).toBe(
      "existing output value",
    );
    expect(rootSpan.attributes[SemanticConventions.OUTPUT_MIME_TYPE]).toBe(
      "application/json",
    );
  });

  it("should handle spans from different traces without cross-contamination", async () => {
    // Root span from trace A
    const rootSpanA = {
      name: "POST /api/trace-a",
      parentSpanContext: undefined,
      spanContext: () => ({
        spanId: "root-a-id",
        traceId: "trace-a",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: {
        "http.method": "POST",
        "http.url": "http://localhost:4111/api/trace-a",
      },
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    // Input span from trace A
    const inputSpanA = {
      name: "agent.getMostRecentUserMessage",
      parentSpanContext: { spanId: "root-a-id" },
      spanContext: () => ({
        spanId: "input-a-id",
        traceId: "trace-a",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: {
        "agent.getMostRecentUserMessage.result": JSON.stringify({
          id: "msg-a",
          role: "user",
          content: "Input for trace A",
          createdAt: "2025-01-15T10:00:00Z",
        }),
      },
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    // Output span from trace A
    const outputSpanA = {
      name: "ai.streamText",
      parentSpanContext: { spanId: "root-a-id" },
      spanContext: () => ({
        spanId: "output-a-id",
        traceId: "trace-a",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: {
        [SemanticConventions.OUTPUT_VALUE]: "Output for trace A",
      },
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    // Root span from trace B (different trace)
    const rootSpanB = {
      name: "POST /api/trace-b",
      parentSpanContext: undefined,
      spanContext: () => ({
        spanId: "root-b-id",
        traceId: "trace-b",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: {
        "http.method": "POST",
        "http.url": "http://localhost:4111/api/trace-b",
      },
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    // Input span from trace B
    const inputSpanB = {
      name: "agent.getMostRecentUserMessage",
      parentSpanContext: { spanId: "root-b-id" },
      spanContext: () => ({
        spanId: "input-b-id",
        traceId: "trace-b",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: {
        "agent.getMostRecentUserMessage.result": JSON.stringify({
          id: "msg-b",
          role: "user",
          content: "Input for trace B",
          createdAt: "2025-01-15T10:00:00Z",
        }),
      },
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    // Output span from trace B
    const outputSpanB = {
      name: "ai.streamText",
      parentSpanContext: { spanId: "root-b-id" },
      spanContext: () => ({
        spanId: "output-b-id",
        traceId: "trace-b",
        traceFlags: 0,
        traceState: undefined,
      }),
      attributes: {
        [SemanticConventions.OUTPUT_VALUE]: "Output for trace B",
      },
      resource: { attributes: {} },
    } as unknown as ReadableSpan;

    const exporter = new OpenInferenceOTLPTraceExporter({
      url: "http://example.com/v1/traces",
    });

    // Export spans from both traces together (simulating a batch export)
    exporter.export(
      [rootSpanA, inputSpanA, outputSpanA, rootSpanB, inputSpanB, outputSpanB],
      () => {},
    );

    // Root span A should only have input/output from trace A
    expect(rootSpanA.attributes[SemanticConventions.INPUT_VALUE]).toBe(
      "Input for trace A",
    );
    expect(rootSpanA.attributes[SemanticConventions.OUTPUT_VALUE]).toBe(
      "Output for trace A",
    );

    // Root span B should only have input/output from trace B
    expect(rootSpanB.attributes[SemanticConventions.INPUT_VALUE]).toBe(
      "Input for trace B",
    );
    expect(rootSpanB.attributes[SemanticConventions.OUTPUT_VALUE]).toBe(
      "Output for trace B",
    );
  });

  describe("Span buffering for multi-batch exports", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should buffer child spans until root span arrives in subsequent batch", async () => {
      const traceId = "trace-buffering-test";
      
      // Child spans that arrive first (no root span yet)
      const childSpan1 = {
        name: "agent.process",
        parentSpanContext: { spanId: "root-id" },
        spanContext: () => ({
          spanId: "child1-id",
          traceId,
          traceFlags: 0,
          traceState: undefined,
        }),
        attributes: { threadId: "thread-1" },
        resource: { attributes: {} },
      } as unknown as ReadableSpan;

      const childSpan2 = {
        name: "ai.streamText",
        parentSpanContext: { spanId: "root-id" },
        spanContext: () => ({
          spanId: "child2-id",
          traceId,
          traceFlags: 0,
          traceState: undefined,
        }),
        attributes: { [SemanticConventions.OUTPUT_VALUE]: "Test output" },
        resource: { attributes: {} },
      } as unknown as ReadableSpan;

      // Root span that arrives later
      const rootSpan = {
        name: "POST /api/test",
        parentSpanContext: undefined, // This is a root span
        spanContext: () => ({
          spanId: "root-id",
          traceId,
          traceFlags: 0,
          traceState: undefined,
        }),
        attributes: { "http.method": "POST" },
        resource: { attributes: {} },
      } as unknown as ReadableSpan;

      const exporter = new OpenInferenceOTLPTraceExporter({
        url: "http://example.com/v1/traces",
      });

      // First batch: child spans only (should be buffered)
      exporter.export([childSpan1, childSpan2], () => {});
      
      // Should not have exported anything yet
      expect(OTLPTraceExporter.prototype.export).not.toHaveBeenCalled();

      // Second batch: root span arrives (should trigger processing of all spans)
      exporter.export([rootSpan], () => {});

      // Should have exported all 3 spans together
      expect(OTLPTraceExporter.prototype.export).toHaveBeenCalledTimes(1);
      const exportedSpans = (OTLPTraceExporter.prototype.export as Mock).mock.calls[0][0];
      expect(exportedSpans).toHaveLength(3);
      
      // Should have processed all spans with contextualization
      const exportedRootSpan = exportedSpans.find((s: ReadableSpan) => s.name === "POST /api/test");
      expect(exportedRootSpan.attributes[SemanticConventions.OUTPUT_VALUE]).toBe("Test output");
    });

    it("should flush buffered spans after timeout when no root span arrives", async () => {
      const traceId = "trace-timeout-test";
      
      const childSpan = {
        name: "agent.process",
        parentSpanContext: { spanId: "root-id" },
        spanContext: () => ({
          spanId: "child-id",
          traceId,
          traceFlags: 0,
          traceState: undefined,
        }),
        attributes: { threadId: "thread-1" },
        resource: { attributes: {} },
      } as unknown as ReadableSpan;

      const exporter = new OpenInferenceOTLPTraceExporter({
        url: "http://example.com/v1/traces",
        traceBufferTtlMs: 1000, // 1 second TTL per trace
      });

      // Export child span (should be buffered)
      exporter.export([childSpan], () => {});
      
      // Should not have exported anything yet
      expect(OTLPTraceExporter.prototype.export).not.toHaveBeenCalled();

      // Fast-forward time to trigger timeout
      vi.advanceTimersByTime(1000);

      // Should have exported the buffered span after timeout
      expect(OTLPTraceExporter.prototype.export).toHaveBeenCalledTimes(1);
      const exportedSpans = (OTLPTraceExporter.prototype.export as Mock).mock.calls[0][0];
      expect(exportedSpans).toHaveLength(1);
      expect(exportedSpans[0].name).toBe("agent.process");
    });

    it("should handle mixed batches with complete and incomplete traces", async () => {
      const completeTraceId = "complete-trace";
      const incompleteTraceId = "incomplete-trace";
      
      // Complete trace (has root span)
      const completeRootSpan = {
        name: "POST /api/complete",
        parentSpanContext: undefined,
        spanContext: () => ({
          spanId: "complete-root-id",
          traceId: completeTraceId,
          traceFlags: 0,
          traceState: undefined,
        }),
        attributes: { "http.method": "POST" },
        resource: { attributes: {} },
      } as unknown as ReadableSpan;

      const completeChildSpan = {
        name: "agent.process",
        parentSpanContext: { spanId: "complete-root-id" },
        spanContext: () => ({
          spanId: "complete-child-id",
          traceId: completeTraceId,
          traceFlags: 0,
          traceState: undefined,
        }),
        attributes: { threadId: "thread-1" },
        resource: { attributes: {} },
      } as unknown as ReadableSpan;

      // Incomplete trace (missing root span)
      const incompleteChildSpan = {
        name: "agent.process",
        parentSpanContext: { spanId: "incomplete-root-id" },
        spanContext: () => ({
          spanId: "incomplete-child-id",
          traceId: incompleteTraceId,
          traceFlags: 0,
          traceState: undefined,
        }),
        attributes: { threadId: "thread-2" },
        resource: { attributes: {} },
      } as unknown as ReadableSpan;

      const exporter = new OpenInferenceOTLPTraceExporter({
        url: "http://example.com/v1/traces",
      });

      // Export mixed batch
      exporter.export([completeRootSpan, completeChildSpan, incompleteChildSpan], () => {});

      // Should have exported the complete trace immediately
      expect(OTLPTraceExporter.prototype.export).toHaveBeenCalledTimes(1);
      const exportedSpans = (OTLPTraceExporter.prototype.export as Mock).mock.calls[0][0];
      expect(exportedSpans).toHaveLength(2); // Only complete trace spans
      
      const exportedTraceIds = new Set(exportedSpans.map((s: ReadableSpan) => s.spanContext().traceId));
      expect(exportedTraceIds.has(completeTraceId)).toBe(true);
      expect(exportedTraceIds.has(incompleteTraceId)).toBe(false);
    });

    it("should schedule efficient timeouts for multiple traces with different start times", async () => {
      const traceId1 = "trace-reset-timeout-1";
      const traceId2 = "trace-reset-timeout-2";
      
      const childSpan1 = {
        name: "agent.process1",
        parentSpanContext: { spanId: "root-id-1" },
        spanContext: () => ({
          spanId: "child1-id",
          traceId: traceId1,
          traceFlags: 0,
          traceState: undefined,
        }),
        attributes: { threadId: "thread-1" },
        resource: { attributes: {} },
      } as unknown as ReadableSpan;

      const childSpan2 = {
        name: "agent.process2",
        parentSpanContext: { spanId: "root-id-2" },
        spanContext: () => ({
          spanId: "child2-id",
          traceId: traceId2,
          traceFlags: 0,
          traceState: undefined,
        }),
        attributes: { threadId: "thread-1" },
        resource: { attributes: {} },
      } as unknown as ReadableSpan;

      const exporter = new OpenInferenceOTLPTraceExporter({
        url: "http://example.com/v1/traces",
        traceBufferTtlMs: 1000,
      });

      // First export
      exporter.export([childSpan1], () => {});
      
      // Advance time by 500ms
      vi.advanceTimersByTime(500);
      
      // Second export starts its own TTL timer
      exporter.export([childSpan2], () => {});
      
      // Advance another 600ms (total 1100ms from first export, 600ms from second)
      vi.advanceTimersByTime(600);
      
      // First trace should have expired (exceeded 1000ms TTL)
      expect(OTLPTraceExporter.prototype.export).toHaveBeenCalledTimes(1);
      const firstExportedSpans = (OTLPTraceExporter.prototype.export as Mock).mock.calls[0][0];
      expect(firstExportedSpans).toHaveLength(1);
      expect(firstExportedSpans[0].spanContext().traceId).toBe(traceId1);
      
      // Advance by remainder to flush second trace (400ms more = 1000ms total for second trace)
      vi.advanceTimersByTime(400);
      
      // Second trace should now be exported
      expect(OTLPTraceExporter.prototype.export).toHaveBeenCalledTimes(2);
      const secondExportedSpans = (OTLPTraceExporter.prototype.export as Mock).mock.calls[1][0];
      expect(secondExportedSpans).toHaveLength(1);
      expect(secondExportedSpans[0].spanContext().traceId).toBe(traceId2);
    });

    it("should preserve contextualization across multiple batches", async () => {
      const traceId = "trace-contextualization";
      
      // Agent span with agent operation
      const agentSpan = {
        name: "agent.process",
        parentSpanContext: { spanId: "root-id" },
        spanContext: () => ({
          spanId: "agent-id",
          traceId,
          traceFlags: 0,
          traceState: undefined,
        }),
        attributes: { threadId: "thread-1" },
        resource: { attributes: {} },
      } as unknown as ReadableSpan;

      // Input span
      const inputSpan = {
        name: "agent.getMostRecentUserMessage",
        parentSpanContext: { spanId: "root-id" },
        spanContext: () => ({
          spanId: "input-id",
          traceId,
          traceFlags: 0,
          traceState: undefined,
        }),
        attributes: {
          "agent.getMostRecentUserMessage.result": JSON.stringify({
            id: "msg-123",
            role: "user",
            content: "test input message",
            createdAt: "2025-01-15T10:00:00Z",
          }),
        },
        resource: { attributes: {} },
      } as unknown as ReadableSpan;

      // Root span (unlabeled, should be marked as AGENT)
      const rootSpan = {
        name: "POST /api/agent",
        parentSpanContext: undefined,
        spanContext: () => ({
          spanId: "root-id",
          traceId,
          traceFlags: 0,
          traceState: undefined,
        }),
        attributes: { "http.method": "POST" },
        resource: { attributes: {} },
      } as unknown as ReadableSpan;

      const exporter = new OpenInferenceOTLPTraceExporter({
        url: "http://example.com/v1/traces",
      });

      // First batch: child spans
      exporter.export([agentSpan, inputSpan], () => {});
      
      // Second batch: root span
      exporter.export([rootSpan], () => {});

      expect(OTLPTraceExporter.prototype.export).toHaveBeenCalledTimes(1);
      const exportedSpans = (OTLPTraceExporter.prototype.export as Mock).mock.calls[0][0];
      
      // Check that root span was marked as AGENT (contextualization worked)
      const exportedRootSpan = exportedSpans.find((s: ReadableSpan) => s.name === "POST /api/agent");
      expect(exportedRootSpan.attributes[SemanticConventions.OPENINFERENCE_SPAN_KIND]).toBe("AGENT");
      
      // Check that I/O was added to root span
      expect(exportedRootSpan.attributes[SemanticConventions.INPUT_VALUE]).toBe("test input message");
    });

    it("should only flush traces that exceed their individual TTL", async () => {
      const traceId1 = "trace-ttl-1";
      const traceId2 = "trace-ttl-2";
      
      const span1 = {
        name: "agent.process1",
        parentSpanContext: { spanId: "root-id-1" },
        spanContext: () => ({
          spanId: "span1-id",
          traceId: traceId1,
          traceFlags: 0,
          traceState: undefined,
        }),
        attributes: { threadId: "thread-1" },
        resource: { attributes: {} },
      } as unknown as ReadableSpan;

      const span2 = {
        name: "agent.process2",
        parentSpanContext: { spanId: "root-id-2" },
        spanContext: () => ({
          spanId: "span2-id",
          traceId: traceId2,
          traceFlags: 0,
          traceState: undefined,
        }),
        attributes: { threadId: "thread-2" },
        resource: { attributes: {} },
      } as unknown as ReadableSpan;

      const exporter = new OpenInferenceOTLPTraceExporter({
        url: "http://example.com/v1/traces",
        traceBufferTtlMs: 1000, // 1 second TTL
      });

      // Export first span
      exporter.export([span1], () => {});
      
      // Advance time by 500ms
      vi.advanceTimersByTime(500);
      
      // Export second span (starts its own TTL)
      exporter.export([span2], () => {});
      
      // Advance time by 600ms (total 1100ms for first span, 600ms for second)
      vi.advanceTimersByTime(600);
      
      // Only first span should be flushed (exceeded 1000ms TTL)
      expect(OTLPTraceExporter.prototype.export).toHaveBeenCalledTimes(1);
      const exportedSpans = (OTLPTraceExporter.prototype.export as Mock).mock.calls[0][0];
      expect(exportedSpans).toHaveLength(1);
      expect(exportedSpans[0].spanContext().traceId).toBe(traceId1);
      
      // Advance another 500ms to flush second span
      vi.advanceTimersByTime(500);
      
      // Second span should now be flushed
      expect(OTLPTraceExporter.prototype.export).toHaveBeenCalledTimes(2);
      const secondExportedSpans = (OTLPTraceExporter.prototype.export as Mock).mock.calls[1][0];
      expect(secondExportedSpans).toHaveLength(1);
      expect(secondExportedSpans[0].spanContext().traceId).toBe(traceId2);
    });

    it("should use global TTL as fallback when trace TTL is not reached", async () => {
      const traceId = "trace-global-ttl";
      
      const span = {
        name: "agent.process",
        parentSpanContext: { spanId: "root-id" },
        spanContext: () => ({
          spanId: "span-id",
          traceId,
          traceFlags: 0,
          traceState: undefined,
        }),
        attributes: { threadId: "thread-1" },
        resource: { attributes: {} },
      } as unknown as ReadableSpan;

      const exporter = new OpenInferenceOTLPTraceExporter({
        url: "http://example.com/v1/traces",
        traceBufferTtlMs: 5000, // 5 second trace TTL
        globalBufferTtlMs: 2000, // 2 second global TTL (shorter)
      });

      // Export span
      exporter.export([span], () => {});
      
      // Advance time to just before global TTL but after trace TTL would normally trigger
      vi.advanceTimersByTime(1500);
      
      // Should not have exported yet
      expect(OTLPTraceExporter.prototype.export).not.toHaveBeenCalled();
      
      // Advance past global TTL
      vi.advanceTimersByTime(600); // Total 2100ms > 2000ms global TTL
      
      // Should have exported due to global TTL
      expect(OTLPTraceExporter.prototype.export).toHaveBeenCalledTimes(1);
      const exportedSpans = (OTLPTraceExporter.prototype.export as Mock).mock.calls[0][0];
      expect(exportedSpans).toHaveLength(1);
      expect(exportedSpans[0].spanContext().traceId).toBe(traceId);
    });

    it("should dynamically adjust check intervals based on shortest TTL", async () => {
      const traceId1 = "trace-short-ttl";
      const traceId2 = "trace-long-ttl";
      
      const span1 = {
        name: "agent.process1",
        parentSpanContext: { spanId: "root-id-1" },
        spanContext: () => ({
          spanId: "span1-id",
          traceId: traceId1,
          traceFlags: 0,
          traceState: undefined,
        }),
        attributes: { threadId: "thread-1" },
        resource: { attributes: {} },
      } as unknown as ReadableSpan;

      const span2 = {
        name: "agent.process2",
        parentSpanContext: { spanId: "root-id-2" },
        spanContext: () => ({
          spanId: "span2-id",
          traceId: traceId2,
          traceFlags: 0,
          traceState: undefined,
        }),
        attributes: { threadId: "thread-2" },
        resource: { attributes: {} },
      } as unknown as ReadableSpan;

      const exporter = new OpenInferenceOTLPTraceExporter({
        url: "http://example.com/v1/traces",
        traceBufferTtlMs: 1000,
      });

      // Export first span
      exporter.export([span1], () => {});
      
      // Advance time by 800ms
      vi.advanceTimersByTime(800);
      
      // Export second span (200ms left for first span to expire)
      exporter.export([span2], () => {});
      
      // Advance by 250ms - should flush first span but not second
      vi.advanceTimersByTime(250);
      
      expect(OTLPTraceExporter.prototype.export).toHaveBeenCalledTimes(1);
      const firstExport = (OTLPTraceExporter.prototype.export as Mock).mock.calls[0][0];
      expect(firstExport).toHaveLength(1);
      expect(firstExport[0].spanContext().traceId).toBe(traceId1);
      
      // Advance by remainder to flush second span
      vi.advanceTimersByTime(750);
      
      expect(OTLPTraceExporter.prototype.export).toHaveBeenCalledTimes(2);
      const secondExport = (OTLPTraceExporter.prototype.export as Mock).mock.calls[1][0];
      expect(secondExport).toHaveLength(1);
      expect(secondExport[0].spanContext().traceId).toBe(traceId2);
    });
  });
});
