import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export function hashPassword (password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword (password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  let candidate
  try {
    candidate = scryptSync(String(password), salt, 64)
  } catch {
    return false
  }
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

export function newToken () {
  return randomBytes(32).toString('hex')
}

/* ── TOTP (RFC 6238) — настоящая 2FA по коду из аутентификатора ── */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode (buf) {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

function base32Decode (str) {
  const clean = String(str).toUpperCase().replace(/[\s=]/g, '')
  let bits = 0
  let value = 0
  const out = []
  for (const ch of clean) {
    const idx = B32.indexOf(ch)
    if (idx === -1) throw new Error('некорректный base32-секрет')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export function newTotpSecret () {
  return base32Encode(randomBytes(20))
}

export function totpAt (secret, unixSeconds) {
  const counter = Math.floor(unixSeconds / 30)
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const mac = createHmac('sha1', base32Decode(secret)).update(msg).digest()
  const offset = mac[19] & 0x0f
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3]
  return String(bin % 1_000_000).padStart(6, '0')
}

export function verifyTotp (secret, code) {
  const given = String(code ?? '').trim()
  if (!/^\d{6}$/.test(given)) return false
  const now = Math.floor(Date.now() / 1000)
  for (const delta of [-1, 0, 1]) {
    if (totpAt(secret, now + delta * 30) === given) return true
  }
  return false
}

/* ── Человеческое имя устройства из User-Agent ── */

export function deviceLabel (ua = '') {
  const browser =
    /obsisync-cli/i.test(ua) ? 'ObsiSync CLI'
    : /ObsiSync\//.test(ua) ? 'ObsiSync'
    : /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /obsidian/i.test(ua) ? 'Obsidian'
    : /curl|node|axios|python/i.test(ua) ? 'CLI'
    : null

  const os =
    /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iOS/.test(ua) ? 'iOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux|X11/.test(ua) ? 'Linux'
    : null

  if (browser && os) return `${browser} · ${os}`
  return browser || os || 'Неизвестное устройство'
}
