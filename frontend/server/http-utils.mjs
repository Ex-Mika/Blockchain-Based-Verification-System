/**
 * http-utils.mjs — Shared HTTP helpers for the frontend server.
 */

import { BYTES32_PATTERN } from "../merkle-core.js";

/**
 * Create an `Error` with an attached HTTP status code.
 */
export function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * Write a JSON response and end the stream.
 */
export function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

/**
 * Read the full request body, parse it as JSON, and reject if the body
 * exceeds `maxBytes`.
 */
export function readJsonBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    request.on("data", (chunk) => {
      if (settled) {
        return;
      }

      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        settled = true;
        reject(createHttpError(413, "QR archive request is too large."));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      if (settled) {
        return;
      }

      try {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(rawBody || "{}"));
      } catch {
        reject(createHttpError(400, "QR archive request body must be valid JSON."));
      }
    });

    request.on("error", (error) => {
      if (settled) {
        return;
      }

      reject(error);
    });
  });
}

/**
 * Format a Unix timestamp (seconds since epoch) as an ISO 8601 string,
 * or return `null` for missing / invalid values.
 */
export function formatUnixTimestamp(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return new Date(seconds * 1000).toISOString();
}

/**
 * Trim a string and return `null` when empty.
 */
export function normalizeOptionalString(value) {
  const normalizedValue = String(value || "").trim();
  return normalizedValue || null;
}

/**
 * Trim a string and throw when empty.
 */
export function normalizeRequiredString(value, label) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    throw createHttpError(400, `${label} is required.`);
  }

  return normalizedValue;
}

/**
 * Validate that a value matches the `0x` + 64-hex-char pattern.
 * Throws an HTTP 400 error on failure.
 */
export function validateBytes32(value, label) {
  if (!BYTES32_PATTERN.test(value)) {
    throw createHttpError(400, `${label} must be a 32-byte hex value.`);
  }

  return value;
}
