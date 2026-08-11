import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock next/server
const jsonResponse = vi.fn((body, init) => ({
  status: init?.status || 200,
  body,
}));

vi.mock("next/server", () => ({
  NextResponse: { json: jsonResponse },
}));

// Mock @/models
const createProviderConnection = vi.fn();
vi.mock("@/models", () => ({ createProviderConnection }));

// Mock the JWT email helpers to avoid depending on real token parsing
vi.mock("@/lib/oauth/providerHelpers", () => ({
  decodeXaiIdTokenEmail: vi.fn(() => undefined),
  extractEmailFromAccessToken: vi.fn(() => undefined),
}));

const { POST } = await import("../../src/app/api/providers/import/route.js");

function makeRequest(body) {
  return new Request("http://localhost/api/providers/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/providers/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createProviderConnection.mockReset();
    createProviderConnection.mockImplementation(async (data) => ({
      id: `conn-${data.email || Math.random()}`,
      ...data,
    }));
  });

  it("imports the grok-bot bulk shape { provider, connections }", async () => {
    const res = await POST(makeRequest({
      provider: "grok-cli",
      connections: [
        {
          authType: "oauth",
          name: "nisa6600@ngecertoken.biz.id",
          email: "nisa6600@ngecertoken.biz.id",
          priority: 1,
          isActive: true,
          accessToken: "eyJaccess",
          refreshToken: "refresh-1",
          testStatus: "active",
          providerSpecificData: { authMethod: "device_code" },
        },
        {
          authType: "oauth",
          name: "second@example.com",
          email: "second@example.com",
          accessToken: "eyJaccess2",
          refreshToken: null,
          providerSpecificData: { authMethod: "device_code" },
        },
      ],
    }));

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);
    expect(res.body.success).toBe(2);
    expect(res.body.failed).toBe(0);
    expect(createProviderConnection).toHaveBeenCalledTimes(2);

    const call = createProviderConnection.mock.calls[0][0];
    expect(call.provider).toBe("grok-cli");
    expect(call.authType).toBe("oauth");
    expect(call.email).toBe("nisa6600@ngecertoken.biz.id");
    expect(call.accessToken).toBe("eyJaccess");
    expect(call.refreshToken).toBe("refresh-1");
    expect(call.isActive).toBe(true);
    expect(call.testStatus).toBe("active");
    expect(call.providerSpecificData.authMethod).toBe("device_code");
  });

  it("accepts a bare array (codex bulk-import style)", async () => {
    const res = await POST(makeRequest([
      { provider: "grok-cli", accessToken: "tok-a", email: "a@x.com" },
      { provider: "grok-cli", accessToken: "tok-b", email: "b@x.com" },
    ]));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(2);
    expect(createProviderConnection).toHaveBeenCalledTimes(2);
    expect(createProviderConnection.mock.calls[0][0].provider).toBe("grok-cli");
  });

  it("backfills missing email from xAI JWT claims when helpers return a value", async () => {
    // Re-mock helpers to return an email for the second call
    const helpers = await import("@/lib/oauth/providerHelpers");
    helpers.decodeXaiIdTokenEmail.mockReturnValue("jwt-user@x.ai");

    const res = await POST(makeRequest({
      provider: "grok-cli",
      connections: [{ accessToken: "eyJno-email" }],
    }));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(1);
    expect(createProviderConnection.mock.calls[0][0].email).toBe("jwt-user@x.ai");
    expect(createProviderConnection.mock.calls[0][0].providerSpecificData.authMethod).toBe("device_code");
  });

  it("requires a provider", async () => {
    const res = await POST(makeRequest({ connections: [{ accessToken: "t" }] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/provider/i);
  });

  it("rejects non-grok providers", async () => {
    const res = await POST(makeRequest({ provider: "codex", connections: [{ accessToken: "t" }] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/grok-cli/i);
  });

  it("requires at least one connection", async () => {
    const res = await POST(makeRequest({ provider: "grok-cli", connections: [] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/connections/i);
  });

  it("rejects oversized batches", async () => {
    const res = await POST(makeRequest({
      provider: "grok-cli",
      connections: Array.from({ length: 101 }, (_, i) => ({ accessToken: `t${i}` })),
    }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too many/i);
  });

  it("reports per-item failures without aborting the batch", async () => {
    createProviderConnection.mockImplementation(async (data) => {
      if (!data.accessToken) throw new Error("Missing accessToken");
      return { id: "ok" };
    });

    const res = await POST(makeRequest({
      provider: "grok-cli",
      connections: [
        { accessToken: "good", email: "good@x.com" },
        { accessToken: "", email: "bad@x.com" },
      ],
    }));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(1);
    expect(res.body.failed).toBe(1);
    expect(res.body.results[1].ok).toBe(false);
  });

  it("never echoes tokens back in the response", async () => {
    const res = await POST(makeRequest({
      provider: "grok-cli",
      connections: [{ accessToken: "super-secret", refreshToken: "r-secret", email: "a@x.com" }],
    }));

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("super-secret");
    expect(raw).not.toContain("r-secret");
  });

  it("accepts a single object body (one-by-one add)", async () => {
    const res = await POST(makeRequest({
      provider: "grok-cli",
      accessToken: "single-tok",
      email: "single@x.com",
    }));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(1);
    expect(createProviderConnection.mock.calls[0][0].email).toBe("single@x.com");
  });
});
