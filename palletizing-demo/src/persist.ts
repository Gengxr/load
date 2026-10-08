/** 本地持久化（演示版用浏览器本地存储充当数据库；正式版对应服务端数据库） */
const PREFIX = 'pld.'

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function remove(key: string) {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    /* 忽略 */
  }
}

export function download(name: string, data: unknown) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export const uid = (p: string) => p + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, '0')
