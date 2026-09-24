import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto'

export function hashPassword (password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword (password, stored) {
  const [salt, hash] = stored.split(':')
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

export function newToken () {
  return randomBytes(32).toString('hex')
}

export function newCode (length = 6) {
  const max = 10 ** length
  return String(randomInt(0, max)).padStart(length, '0')
}