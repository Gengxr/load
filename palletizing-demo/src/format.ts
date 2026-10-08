export const pct = (v: number, d = 1) => (Number.isFinite(v) ? (v * 100).toFixed(d) + '%' : '—')
export const signedPct = (v: number, d = 1) => (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(d) + '%'
export const kg = (v: number, d = 1) => v.toFixed(d) + ' kg'
export const dims = (a: number, b: number, c: number) => `${a}×${b}×${c}`
export const tail = (rfid: string, n = 4) => '…' + rfid.slice(-n)
