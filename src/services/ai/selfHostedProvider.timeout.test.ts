// Real loopback HTTP regression: fetch resolves at headers, not at body EOF.
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { selfHostedChat } from "./selfHostedProvider.js";
import {
  __resetProviderStatsForTests,
  dispatchSelfHostedAction,
  getAiProviderStats,
} from "./providerRouter.js";
import { geminiCircuit } from "../../server/middleware/geminiCircuit.js";

const servers: ReturnType<typeof createServer>[] = [];
const timers: ReturnType<typeof setTimeout>[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  geminiCircuit.__resetForTests();
  __resetProviderStatsForTests();
  for (const timer of timers.splice(0)) clearTimeout(timer);
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

async function upstream(
  reply: (response: ServerResponse) => void,
): Promise<string> {
  const server = createServer((request, response) => {
    request.resume();
    reply(response);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}/v1`;
}

const completion = JSON.stringify({
  choices: [{ message: { content: "synthetic completion" } }],
});

describe("selfHostedChat response deadline (real HTTP)", () => {
  it("aborts a stalled body even after fetch has delivered successful headers", async () => {
    const baseUrl = await upstream((response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
        Connection: "close",
      });
      response.write('{"choices":[');
      // Bound the RED run too: the broken client returns a late completion
      // instead of hanging the entire test worker.
      timers.push(
        setTimeout(
          () => response.end('{"message":{"content":"too late"}}]}'),
          600,
        ),
      );
    });
    let receivedHeaders = false;
    const fetchImpl: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      receivedHeaders = true;
      return response;
    };

    await expect(
      selfHostedChat(
        { prompt: "synthetic timeout probe" },
        { config: { baseUrl, model: "synthetic", timeoutMs: 100 }, fetchImpl },
      ),
    ).rejects.toMatchObject({
      name: "SelfHostedProviderError",
      code: "selfhosted_timeout",
    });
    expect(receivedHeaders).toBe(true);
  });

  it("still returns a complete response received within the deadline", async () => {
    const baseUrl = await upstream((response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
        Connection: "close",
      });
      response.end(completion);
    });
    await expect(
      selfHostedChat(
        { prompt: "synthetic success probe" },
        { config: { baseUrl, model: "synthetic", timeoutMs: 1000 } },
      ),
    ).resolves.toMatchObject({
      text: "synthetic completion",
      model: "synthetic",
    });
  });

  it("returns control to the fallback caller and records failure, not success, for a stalled body", async () => {
    const baseUrl = await upstream((response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
        Connection: "close",
      });
      response.write('{"choices":[');
      timers.push(
        setTimeout(
          () => response.end('{"message":{"content":"too late"}}]}'),
          1600,
        ),
      );
    });
    // Synthetic loopback endpoint only. Never inherit a developer's real API key.
    vi.stubEnv("AI_SELFHOSTED_BASE_URL", baseUrl);
    vi.stubEnv("AI_SELFHOSTED_MODEL", "synthetic");
    vi.stubEnv("AI_SELFHOSTED_API_KEY", "synthetic_not_a_secret");
    vi.stubEnv("AI_SELFHOSTED_TIMEOUT_MS", "1000");
    geminiCircuit.__resetForTests();
    __resetProviderStatsForTests();

    const result = await dispatchSelfHostedAction("getSafetyAdvice", [
      { temp: 30, uv: 7 },
    ]);
    expect(result).toMatchObject({ status: "failed", reason: "call_failed" });
    expect(getAiProviderStats().selfhosted).toMatchObject({
      failure: 1,
      success: 0,
    });
    expect(getAiProviderStats().gemini).toMatchObject({
      failure: 0,
      success: 0,
    });
    expect(geminiCircuit.getState("gemini")).toBe("closed");
  });
});

describe("selfHostedChat deadline and stream cleanup", () => {
  const config = {
    baseUrl: "http://synthetic.invalid/v1",
    model: "synthetic",
    timeoutMs: 100,
  };

  it("shares one deadline across the JSON-mode retry rather than starting another budget", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetchImpl: typeof fetch = (_input, init) => {
      const signal = init?.signal as AbortSignal;
      signals.push(signal);
      const attempt = signals.length;
      return new Promise<Response>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException("synthetic abort", "AbortError"));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve(
            attempt === 1
              ? new Response(null, { status: 400 })
              : new Response(completion),
          );
        }, 60);
        signal.addEventListener("abort", abort, { once: true });
      });
    };
    const pending = expect(
      selfHostedChat(
        { prompt: "synthetic retry probe", jsonMode: true },
        { config, fetchImpl },
      ),
    ).rejects.toMatchObject({ code: "selfhosted_timeout" });
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBe(signals[1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["success", "bad_json", "network_failure"] as const)(
    "clears the deadline after %s without aborting a later call",
    async (outcome) => {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      const fetchImpl: typeof fetch = async (_input, init) => {
        signal = init?.signal as AbortSignal;
        if (outcome === "network_failure")
          throw new Error("synthetic network failure");
        return new Response(outcome === "bad_json" ? "not json" : completion);
      };
      const pending = selfHostedChat(
        { prompt: "synthetic cleanup probe" },
        { config, fetchImpl },
      );
      if (outcome === "success")
        await expect(pending).resolves.toMatchObject({
          text: "synthetic completion",
        });
      else
        await expect(pending).rejects.toMatchObject({
          name: "SelfHostedProviderError",
        });
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(200);
      expect(signal?.aborted).toBe(false);
    },
  );

  it("cancels the discarded HTTP 400 body before retrying", async () => {
    const cancel = vi.fn();
    let attempt = 0;
    const fetchImpl: typeof fetch = async () => {
      if (++attempt === 1)
        return new Response(new ReadableStream({ cancel }), { status: 400 });
      expect(cancel).toHaveBeenCalledOnce();
      return new Response(completion);
    };
    await expect(
      selfHostedChat(
        { prompt: "synthetic retry probe", jsonMode: true },
        { config, fetchImpl },
      ),
    ).resolves.toMatchObject({ text: "synthetic completion" });
    expect(attempt).toBe(2);
  });

  it("cancels an unsuccessful body and preserves the sanitized HTTP status", async () => {
    const cancel = vi.fn();
    const fetchImpl: typeof fetch = async () =>
      new Response(new ReadableStream({ cancel }), { status: 503 });
    await expect(
      selfHostedChat(
        { prompt: "synthetic HTTP error probe" },
        { config, fetchImpl },
      ),
    ).rejects.toMatchObject({
      code: "selfhosted_http_error",
      message: "selfhosted_http_error",
      status: 503,
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not trust an upstream stream error that spoofs the typed-error name", async () => {
    const spoof = new Error("synthetic upstream private detail");
    spoof.name = "SelfHostedProviderError";
    const fetchImpl: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(spoof);
          },
        }),
      );
    await expect(
      selfHostedChat(
        { prompt: "synthetic spoof probe" },
        { config, fetchImpl },
      ),
    ).rejects.toMatchObject({
      name: "SelfHostedProviderError",
      message: "selfhosted_bad_response",
    });
  });

  it("sanitizes stream cancellation failures instead of leaking upstream error text", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          cancel() {
            throw new Error("synthetic upstream private detail");
          },
        }),
        { status: 503 },
      );
    await expect(
      selfHostedChat(
        { prompt: "synthetic cancellation probe" },
        { config, fetchImpl },
      ),
    ).rejects.toMatchObject({
      name: "SelfHostedProviderError",
      message: "selfhosted_bad_response",
    });
  });
});
