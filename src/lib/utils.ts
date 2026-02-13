import type { Env } from "../types";

// ─── ID Generation ──────────────────────────────────────────────────

export function generateId(): string {
  return crypto.randomUUID();
}

// ─── Password Hashing (PBKDF2) ─────────────────────────────────────

export async function hashPassword(password: string, existingSalt?: string): Promise<string> {
  const encoder = new TextEncoder();
  let salt: Uint8Array;
  if (existingSalt) {
    salt = Uint8Array.from(atob(existingSalt), c => c.charCodeAt(0));
  } else {
    salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
  }
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, 256);
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return `pbkdf2:${saltB64}:${hashB64}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith("pbkdf2:")) {
    const parts = stored.split(":");
    const salt = parts[1];
    const rehash = await hashPassword(password, salt);
    return rehash === stored;
  }
  // Legacy SHA-256 fallback for existing credentials
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const legacyHash = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return legacyHash === stored;
}

// ─── Access Code Generation ─────────────────────────────────────────

export function generateAccessCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const maxValid = 256 - (256 % chars.length);
  let code = "";
  while (code.length < 8) {
    const bytes = new Uint8Array(1);
    crypto.getRandomValues(bytes);
    if (bytes[0] < maxValid) code += chars[bytes[0] % chars.length];
  }
  return code.slice(0, 4) + "-" + code.slice(4);
}

export function normalizeAccessCode(input: string): string {
  const stripped = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (stripped.length === 8) {
    return stripped.slice(0, 4) + "-" + stripped.slice(4);
  }
  return input;
}

export function generateRecoveryCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const maxValid = 256 - (256 % chars.length);
  let code = "";
  while (code.length < 8) {
    const bytes = new Uint8Array(1);
    crypto.getRandomValues(bytes);
    if (bytes[0] < maxValid) code += chars[bytes[0] % chars.length];
  }
  return code.slice(0, 4) + "-" + code.slice(4);
}

export function generateReferralSuffix(length = 4): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const maxValid = 256 - (256 % chars.length);
  let result = "";
  while (result.length < length) {
    const bytes = new Uint8Array(1);
    crypto.getRandomValues(bytes);
    if (bytes[0] < maxValid) result += chars[bytes[0] % chars.length];
  }
  return result;
}

// ─── Session Tokens ─────────────────────────────────────────────────

export async function createToken(userId: string, env: Env): Promise<string> {
  const token = generateId();
  await env.SESSIONS.put(`session:${token}`, userId, {
    expirationTtl: 60 * 60 * 24 * 7, // 7 days
  });
  return token;
}

export async function verifyToken(token: string, env: Env): Promise<string | null> {
  return await env.SESSIONS.get(`session:${token}`);
}
