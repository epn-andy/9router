import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { decodeXaiIdTokenEmail, extractEmailFromAccessToken } from "@/lib/oauth/providerHelpers";

const GROK_PROVIDER = "grok-cli";
const MAX_IMPORT_CONNECTIONS = 100;

/**
 * POST /api/providers/import
 * Bulk import OAuth connections for a provider (e.g. grok-cli).
 *
 * Body (matches grok-bot runner `_do_import`):
 *   {
 *     "provider": "grok-cli",
 *     "connections": [
 *       {
 *         "authType": "oauth",
 *         "name": "user@example.com",
 *         "email": "user@example.com",
 *         "accessToken": "eyJ...",
 *         "refreshToken": "..." | null,
 *         "providerSpecificData": { "authMethod": "device_code", ... }
 *       }
 *     ]
 *   }
 *
 * Also accepts a bare array or single object of connections for symmetry with
 * the codex bulk-import route. Tokens are NEVER echoed back in the response.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid JSON body: ${err.message}` },
      { status: 400 }
    );
  }

  let provider;
  let connections;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    provider = body.provider;
    if (Array.isArray(body.connections)) {
      connections = body.connections;
    } else if (Array.isArray(body.accounts)) {
      connections = body.accounts;
    } else if (body.accessToken || body.name || body.email) {
      connections = [body];
    }
  } else if (Array.isArray(body)) {
    connections = body;
  }

  if (!Array.isArray(connections) || connections.length === 0) {
    return NextResponse.json(
      { error: "No connections provided" },
      { status: 400 }
    );
  }
  if (connections.length > MAX_IMPORT_CONNECTIONS) {
    return NextResponse.json(
      { error: `Too many connections (max ${MAX_IMPORT_CONNECTIONS})` },
      { status: 400 }
    );
  }

  // A bare array can use each account's provider field (the grok-bot export
  // format). Token-only arrays must use the wrapped { provider, connections }
  // form so the destination is explicit.
  if (!provider) {
    const itemProviders = [...new Set(
      connections
        .filter((item) => item && typeof item === "object" && typeof item.provider === "string")
        .map((item) => item.provider)
    )];
    if (itemProviders.length === 1) provider = itemProviders[0];
  }

  if (!provider || typeof provider !== "string") {
    return NextResponse.json(
      { error: "Missing provider (e.g. \"grok-cli\")" },
      { status: 400 }
    );
  }
  provider = provider.trim();
  if (provider !== GROK_PROVIDER) {
    return NextResponse.json(
      { error: `Only ${GROK_PROVIDER} OAuth connections are supported` },
      { status: 400 }
    );
  }

  const results = [];
  let success = 0;
  let failed = 0;

  // SERIAL loop — createProviderConnection reads max(priority) and reorders
  // inside a transaction. Parallel calls would race on priority assignment.
  for (let i = 0; i < connections.length; i++) {
    const raw = connections[i];
    try {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Item is not an object");
      }

      // Strip server-controlled fields
      const {
        id: _id,
        provider: _itemProvider,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...item
      } = raw;

      // Normalize authType (bot sends "oauth")
      if (item.authType === undefined) item.authType = "oauth";
      if (item.authType !== "oauth") {
        throw new Error("Only authType \"oauth\" connections are supported");
      }

      if (!item.accessToken || typeof item.accessToken !== "string") {
        throw new Error("Missing accessToken");
      }

      // Backfill email from xAI JWT claims when absent (best-effort)
      if (!item.email) {
        const email =
          decodeXaiIdTokenEmail(item.idToken || item.accessToken) ||
          extractEmailFromAccessToken(item.accessToken);
        if (email) item.email = email;
      }

      // Surface an absolute expiry so the proactive refresh path
      // (shouldRefreshCredentials / checkAndRefreshToken) can refresh the
      // xAI token before it silently expires (~6h TTL for grok-cli).
      if (!item.expiresAt && typeof item.expiresIn === "number" && item.expiresIn > 0) {
        item.expiresAt = new Date(Date.now() + item.expiresIn * 1000).toISOString();
      }
      if (!item.lastRefreshAt) item.lastRefreshAt = new Date().toISOString();

      // Defaults aligned with OAuth-completed flow
      if (item.isActive === undefined) item.isActive = true;

      // Default providerSpecificData matching device-code OAuth completion
      const psd = item.providerSpecificData || {};
      if (psd.authMethod === undefined) psd.authMethod = "device_code";
      item.providerSpecificData = psd;

      const created = await createProviderConnection({
        provider,
        authType: "oauth",
        ...item,
      });

      results.push({ index: i, ok: true, id: created.id });
      success++;
    } catch (e) {
      results.push({ index: i, ok: false, error: e.message || "Unknown error" });
      failed++;
    }
  }

  return NextResponse.json({ imported: success, success, failed, results });
}
