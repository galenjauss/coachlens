export function pcmToWav(chunks: Uint8Array[], sampleRate = 16000): Uint8Array {
  const dataLen = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(44 + dataLen)
  const v = new DataView(out.buffer)
  const ascii = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i) }
  ascii(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); ascii(8, 'WAVE')
  ascii(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  ascii(36, 'data'); v.setUint32(40, dataLen, true)
  let o = 44
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}
export function toB64(u: Uint8Array): string {
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
export function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u
}
