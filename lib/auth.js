import crypto from 'node:crypto';
import { parseCookie, stringifySetCookie } from 'cookie';

const COOKIE_NAME = 'session';
const COOKIE_PATH = '/gba';

function secret() {
  return process.env.SESSION_SECRET || '';
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function hmac(payload) {
  return b64url(crypto.createHmac('sha256', secret()).update(payload).digest());
}

export function signSession(data) {
  const payload = b64url(JSON.stringify(data));
  return `${payload}.${hmac(payload)}`;
}

export function readSession(header) {
  if (!header || !secret()) return null;
  const parsed = parseCookie(header);
  const raw = parsed[COOKIE_NAME];
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = hmac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(fromB64url(payload).toString('utf8'));
    if (!data || typeof data.sub !== 'string') return null;
    return data;
  } catch {
    return null;
  }
}

export function requireUser(req, res) {
  const session = readSession(req.headers.cookie);
  if (!session) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return session;
}

export function isLocalHost(req) {
  const host = String(req.headers.host || '');
  return host.startsWith('localhost') || host.startsWith('127.0.0.1');
}

export function oauthRedirectUri(req) {
  if (isLocalHost(req)) {
    return 'http://localhost:3000/gba/api/auth/callback/google';
  }
  return 'https://yoshik.xyz/gba/api/auth/callback/google';
}

export function sessionCookie(value, req, maxAge = 60 * 60 * 24 * 30) {
  return stringifySetCookie({
    name: COOKIE_NAME,
    value,
    httpOnly: true,
    secure: !isLocalHost(req),
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge,
  });
}

export function clearSessionCookie(req) {
  return stringifySetCookie({
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: !isLocalHost(req),
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: 0,
  });
}
