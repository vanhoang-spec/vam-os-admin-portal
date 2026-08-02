#!/usr/bin/env node
// VAM OS V5 credential-free Postgres TLS handshake probe.
//
// Tests, and only tests: TCP connect -> one PostgreSQL SSLRequest packet -> the
// server's single SSL-acceptance byte -> a TLS handshake (with SNI, no ALPN) -> an
// immediate clean close. Never sends a StartupMessage, never authenticates, never
// sends SQL. Built-in modules only: node:net, node:tls, node:process.
//
// Reads STAGING_DATABASE_URL from process.env only -- never accepted via argv. Never
// prints the URI, hostname, username, password, project ref, region, IP, certificate
// subject/issuer, a raw Node error, or raw socket data. Every output line is built
// entirely from fixed literals and booleans computed from (never containing) the input.

import net from "node:net";
import tls from "node:tls";
import process from "node:process";
import { pathToFileURL } from "node:url";

const APPROVED_REF = "ljfneyuvpxrmejpxsmpz";
const EXCLUDED_PROD_REF = "qkkroesfiazsejkzflcd";
const TOTAL_TIMEOUT_MS = 10000;
const SSLREQUEST_CODE = 80877103;
const POOLER_HOSTNAME_RE = /^[a-z0-9-]+\.pooler\.supabase\.com$/;

export function classifyConnectError(err) {
  const code = err && typeof err === "object" ? err.code : undefined;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns_resolution_failed";
  if (code === "ECONNREFUSED") return "connection_refused";
  if (code === "ECONNRESET") return "connection_reset";
  if (code === "ETIMEDOUT") return "connection_timeout";
  return "internal_failure";
}

export function classifyTlsError(err) {
  const code = err && typeof err === "object" ? err.code : undefined;
  if (code === "ECONNRESET") return "connection_reset";
  return "tls_handshake_failure";
}

export function buildSslRequestPacket() {
  const buf = Buffer.alloc(8);
  buf.writeInt32BE(8, 0);
  buf.writeInt32BE(SSLREQUEST_CODE, 4);
  return buf;
}

// Returns "accept" | "reject" | "unexpected" for the server's first response byte,
// given whether any additional bytes accompanied it in the same read. A compliant
// server sends exactly one byte ('S' or 'N') and then waits -- anything else,
// including legitimate-looking extra bytes, is not the expected shape.
export function evaluateSslResponseByte(firstByte, extraDataSeen) {
  if (firstByte === 0x53 /* 'S' */ && !extraDataSeen) return "accept";
  if (firstByte === 0x4e /* 'N' */ && !extraDataSeen) return "reject";
  return "unexpected";
}

export function parsePreflight(rawUrl) {
  const result = {
    stagingVariablePresent: typeof rawUrl === "string" && rawUrl.length > 0,
    uriShape: false,
    approvedStagingRefPresent: false,
    productionRefAbsent: false,
    sessionPoolerShape: false,
    host: null,
    port: null,
  };
  if (!result.stagingVariablePresent) return result;

  if (rawUrl.includes(APPROVED_REF)) result.approvedStagingRefPresent = true;
  result.productionRefAbsent = !rawUrl.includes(EXCLUDED_PROD_REF);

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    // Deliberately does not reference the caught error object.
    return result;
  }

  if (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") {
    result.uriShape = true;
  }

  const hostname = parsed.hostname.toLowerCase();
  const portValue = parsed.port === "" ? null : Number(parsed.port);
  const databaseOk = parsed.pathname === "/postgres";

  if (POOLER_HOSTNAME_RE.test(hostname) && portValue === 5432 && databaseOk) {
    result.sessionPoolerShape = true;
  }

  result.host = hostname;
  result.port = portValue;

  // Best-effort in-memory hygiene: overwrite the credential fields on the parsed URL
  // object once host/port have been extracted. This cannot guarantee the original
  // string content is scrubbed from the JS engine's memory (V8 offers no such
  // guarantee), but it removes the only references this script itself would
  // otherwise continue to hold.
  try {
    parsed.username = "";
    parsed.password = "";
  } catch {
    /* no-op */
  }

  return result;
}

function main() {
  let settled = false;
  let rawSocket = null;
  let tlsSocket = null;
  let overallTimer = null;
  let currentStage = "preflight";

  function destroyAll() {
    try {
      if (tlsSocket) tlsSocket.destroy();
    } catch {
      /* no-op */
    }
    try {
      if (rawSocket) rawSocket.destroy();
    } catch {
      /* no-op */
    }
    if (overallTimer) {
      clearTimeout(overallTimer);
      overallTimer = null;
    }
  }

  function finishOk() {
    if (settled) return;
    settled = true;
    destroyAll();
    // The exit is deferred to the write callback -- calling process.exit()
    // immediately after process.stdout.write() can truncate the write on some
    // platforms if stdout is a pipe; waiting for the write to be acknowledged
    // guarantees the line is fully flushed first.
    process.stdout.write(
      "TLS_PROBE_OK sslRequestAccepted=true secureConnect=true protocolPresent=true " +
        "cipherPresent=true peerCertificatePresent=true\n",
      () => process.exit(0)
    );
  }

  function finishFail(stage, category) {
    if (settled) return;
    settled = true;
    destroyAll();
    const exitCode = category === "internal_failure" ? 2 : 1;
    process.stdout.write(`TLS_PROBE_FAILED stage=${stage} category=${category}\n`, () =>
      process.exit(exitCode)
    );
  }

  for (const sig of ["SIGHUP", "SIGINT", "SIGTERM"]) {
    process.on(sig, () => finishFail("shutdown", "internal_failure"));
  }
  process.on("uncaughtException", () => finishFail("internal", "internal_failure"));

  let rawUrl = process.env.STAGING_DATABASE_URL;
  const preflight = parsePreflight(rawUrl);
  rawUrl = undefined; // drop the only reference this script holds to the raw string

  const preflightMsg =
    `TARGET_PREFLIGHT stagingVariablePresent=${preflight.stagingVariablePresent} ` +
    `uriShape=${preflight.uriShape} ` +
    `approvedStagingRefPresent=${preflight.approvedStagingRefPresent} ` +
    `productionRefAbsent=${preflight.productionRefAbsent} ` +
    `sessionPoolerShape=${preflight.sessionPoolerShape}`;
  process.stdout.write(preflightMsg + "\n");

  const preflightOk =
    preflight.stagingVariablePresent &&
    preflight.uriShape &&
    preflight.approvedStagingRefPresent &&
    preflight.productionRefAbsent &&
    preflight.sessionPoolerShape;

  if (!preflightOk) {
    finishFail("preflight", "target_rejected");
    return;
  }

  const targetHost = preflight.host;
  const targetPort = preflight.port;

  overallTimer = setTimeout(() => finishFail(currentStage, "connection_timeout"), TOTAL_TIMEOUT_MS);

  currentStage = "tcp_connect";
  rawSocket = net.connect({ host: targetHost, port: targetPort });

  rawSocket.once("error", (err) => {
    finishFail(currentStage, classifyConnectError(err));
  });

  rawSocket.once("close", (hadError) => {
    if (!hadError) finishFail(currentStage, "premature_close");
  });

  rawSocket.once("connect", () => {
    currentStage = "ssl_request";
    rawSocket.write(buildSslRequestPacket());

    let respondedByteSeen = false;

    rawSocket.on("data", (chunk) => {
      if (settled) return;
      if (respondedByteSeen) {
        finishFail("ssl_request", "unexpected_ssl_response");
        return;
      }
      respondedByteSeen = true;
      const firstByte = chunk[0];
      const extraDataSeen = chunk.length > 1;
      const verdict = evaluateSslResponseByte(firstByte, extraDataSeen);

      if (verdict === "accept") {
        currentStage = "tls_handshake";
        upgradeToTls();
      } else if (verdict === "reject") {
        finishFail("ssl_request", "ssl_request_rejected");
      } else {
        finishFail("ssl_request", "unexpected_ssl_response");
      }
    });
  });

  function upgradeToTls() {
    // Hand the raw socket to the TLS layer; remove the raw socket's own listeners
    // first so the underlying connection's error/close events are never handled
    // twice (once by the raw-socket listeners, once by the TLS wrapper).
    rawSocket.removeAllListeners("data");
    rawSocket.removeAllListeners("error");
    rawSocket.removeAllListeners("close");

    tlsSocket = tls.connect({
      socket: rawSocket,
      servername: targetHost,
      rejectUnauthorized: false,
      minVersion: "TLSv1.2",
      // No ALPNProtocols set -- traditional SSLRequest negotiation only.
    });

    tlsSocket.once("secureConnect", () => {
      const protocol = tlsSocket.getProtocol();
      const cipher = tlsSocket.getCipher();
      const cert = tlsSocket.getPeerCertificate();
      const protocolPresent = !!protocol;
      const cipherPresent = !!(cipher && cipher.name);
      const peerCertificatePresent = !!(cert && Object.keys(cert).length > 0);

      if (protocolPresent && cipherPresent && peerCertificatePresent) {
        finishOk();
      } else {
        finishFail("tls_handshake", "tls_handshake_failure");
      }
    });

    tlsSocket.once("error", (err) => {
      finishFail("tls_handshake", classifyTlsError(err));
    });

    tlsSocket.once("close", (hadError) => {
      if (!hadError) finishFail("tls_handshake", "premature_close");
    });
  }
}

// Uses Node's own path-to-URL conversion (rather than hand-rolled string matching)
// because it alone correctly handles OS- and character-specific URL encoding, such as
// a literal "~" in a Windows path being percent-encoded ("%7E") in import.meta.url but
// not in process.argv[1] -- a hand-rolled comparison was found, during this script's
// own review, to silently and incorrectly evaluate false in that exact case, meaning
// the script would never run when actually invoked directly. Verified locally (no
// network) both directions: true for a direct run, false when imported.
const isMainModule =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main();
}
