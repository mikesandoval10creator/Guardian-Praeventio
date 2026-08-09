import { afterEach, describe, expect, it, vi } from "vitest";
import { newRequestId } from "./slmRuntimeWorkerProtocol";

describe("newRequestId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses Web Crypto entropy when available", () => {
    const getRandomValues = vi.fn((buffer: Uint32Array) => {
      buffer[0] = 123;
      return buffer;
    });
    vi.stubGlobal("crypto", { getRandomValues });

    const requestId = newRequestId("infer");

    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(requestId).toMatch(/^infer-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/);
  });

  it("keeps IDs unique when Web Crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);

    const first = newRequestId("load");
    const second = newRequestId("load");

    expect(first).not.toBe(second);
    expect(first).toMatch(/^load-[a-z0-9]+-[a-z0-9]+-fallback$/);
    expect(second).toMatch(/^load-[a-z0-9]+-[a-z0-9]+-fallback$/);
  });
});
