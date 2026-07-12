// PKCS#10 CSR builder for ECDSA P-256 using the browser's Web Crypto API.
// The private key is generated here, in the browser, and NEVER leaves the device.
// Only the CSR (which carries the public key + a proof-of-possession signature)
// is sent to the CA. Verified byte-for-byte against Python's cryptography lib.

function derLen(n) {
  if (n < 0x80) return [n]
  const bytes = []; let v = n
  while (v > 0) { bytes.unshift(v & 0xff); v >>= 8 }
  return [0x80 | bytes.length, ...bytes]
}
function der(tag, content) { return [tag, ...derLen(content.length), ...content] }
function seq(...parts) { return der(0x30, parts.flat()) }
function set(...parts) { return der(0x31, parts.flat()) }
function oid(str) {
  const parts = str.split('.').map(Number)
  const body = [40 * parts[0] + parts[1]]
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i]; const stack = [v & 0x7f]; v >>= 7
    while (v > 0) { stack.unshift((v & 0x7f) | 0x80); v >>= 7 }
    body.push(...stack)
  }
  return der(0x06, body)
}
function utf8String(s) { return der(0x0c, [...new TextEncoder().encode(s)]) }
function bitString(bytes) { return der(0x03, [0x00, ...bytes]) }
function rdn(oidStr, value) { return set(seq(oid(oidStr), utf8String(value))) }

function spki(rawPubBytes) {
  const algId = seq(oid('1.2.840.10045.2.1'), oid('1.2.840.10045.3.1.7'))
  return seq(algId, bitString([...rawPubBytes]))
}
function certificationRequestInfo(subjectCN, spkiBytes) {
  const version = der(0x02, [0x00])
  const subject = seq(rdn('2.5.4.3', subjectCN))
  const attributes = [0xa0, 0x00]
  return seq(version, subject, spkiBytes, attributes)
}
function rawSigToDer(raw) {
  const r = [...raw.slice(0, 32)], s = [...raw.slice(32, 64)]
  const trim = (b) => { while (b.length > 1 && b[0] === 0) b.shift(); if (b[0] & 0x80) b.unshift(0x00); return b }
  return seq(der(0x02, trim(r)), der(0x02, trim(s)))
}

function toPem(der_bytes, label) {
  let bin = ''
  for (const b of der_bytes) bin += String.fromCharCode(b)
  const b64 = btoa(bin)
  return `-----BEGIN ${label}-----\n` + (b64.match(/.{1,64}/g) || []).join('\n') + `\n-----END ${label}-----\n`
}

// Generates a keypair + CSR. Returns { csrPem, privateKeyPem }.
// privateKeyPem is for the user to download and keep — it is never sent anywhere.
export async function generateKeyAndCSR(subjectCN) {
  if (!(window.crypto && window.crypto.subtle && window.isSecureContext)) {
    throw new Error('Key generation requires a secure context (HTTPS or localhost). '
      + 'Open this page via https:// or http://localhost instead of a bare IP address.')
  }
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
  )
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
  const cri = certificationRequestInfo(subjectCN, spki(rawPub))
  const sigRaw = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, new Uint8Array(cri)
  ))
  const csr = seq(cri, seq(oid('1.2.840.10045.4.3.2')), bitString(rawSigToDer(sigRaw)))
  const csrPem = toPem(csr, 'CERTIFICATE REQUEST')

  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey))
  const privateKeyPem = toPem([...pkcs8], 'PRIVATE KEY')
  return { csrPem, privateKeyPem }
}
