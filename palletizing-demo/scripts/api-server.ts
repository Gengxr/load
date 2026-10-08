/**
 * RESTful 接口服务（JSON）：npm run api [-- 端口]
 *
 * 与界面使用同一套算法，供智能仓储子系统、航空货运模拟舱段子系统联调：
 *   GET  /api/v1/health                  服务状态
 *   GET  /api/v1/cabin/configs           内置舱段构型列表
 *   POST /api/v1/palletizing/plans       出库清单 → 多盘分配 + 各盘码放方案 + 散货出库顺序
 *   POST /api/v1/loading/plans           整托货物 + 构型 → 装载方案、装载 / 投放顺序、过程重心
 *   POST /api/v1/joint/plans             出库清单 + 构型 → 码盘方案与装载方案（联动）
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { DEFAULT_CONSTRAINTS, DEFAULT_PALLET, DEFAULT_SEQUENCE } from '../src/algo/defaults'
import { CABIN_CONFIGS, planLoading } from '../src/algo/cabin'
import { robotPayload, flattenImported, loadingPayload, palletizingPayload, parseCabinConfig, parseCargoJson, parsePalletUnits } from '../src/algo/io'
import { planOrder, toPalletUnit, type PlanMany } from '../src/algo/pipeline'
import { planPallet } from '../src/algo/planner'

const port = Number(process.argv[2] ?? 8787)
const planMany: PlanMany = async (inputs, onDone) =>
  inputs.map((inp, i) => {
    const r = planPallet(inp)
    onDone(i, r)
    return r
  })

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-API-Key' })
  res.end(JSON.stringify(body))
}
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 20e6) reject(new Error('报文过大'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}
const pickConfig = (body: Record<string, unknown>) => {
  if (body.config) return parseCabinConfig(JSON.stringify(body.config))
  const cfg = CABIN_CONFIGS.find((c) => c.id === body.configId)
  if (body.configId && !cfg) throw Object.assign(new Error(`未知构型 ${String(body.configId)}`), { status: 404, code: 40401 })
  return cfg ?? CABIN_CONFIGS[0]
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const requestId = (req.headers['x-request-id'] as string) ?? 'REQ-' + Date.now().toString(36)
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {})
    if (req.method === 'GET' && url.pathname === '/api/v1/health') return send(res, 200, { code: 0, status: 'UP', version: '0.3.0', time: new Date().toISOString() })
    if (req.method === 'GET' && url.pathname === '/api/v1/cabin/configs') return send(res, 200, { code: 0, configs: CABIN_CONFIGS })
    if (req.method !== 'POST') return send(res, 404, { code: 40401, message: '资源不存在', requestId })
    const text = await readBody(req)
    const body = JSON.parse(text || '{}') as Record<string, unknown>
    const orderId = String(body.orderId ?? requestId)
    const t0 = performance.now()
    if (url.pathname === '/api/v1/palletizing/plans' || url.pathname === '/api/v1/joint/plans') {
      const cargos = flattenImported(parseCargoJson(text))
      const cons = { ...DEFAULT_CONSTRAINTS, ...((body.constraints as object) ?? {}) }
      const plan = await planOrder(cargos, DEFAULT_PALLET, cons, DEFAULT_SEQUENCE, (body.allocation as object) ?? {}, planMany)
      const palletizing = palletizingPayload(orderId, plan.pallets, DEFAULT_PALLET, cons)
      // 两种落地方式用同一份方案：plan 供人工引导与仓储出库，robotJobs 供机械臂直接执行
      if (url.pathname.endsWith('palletizing/plans')) return send(res, 200, { code: 0, requestId, elapsedMs: Math.round(performance.now() - t0), plan: palletizing, robotJobs: robotPayload(orderId, plan.pallets, cons).jobs })
      const cfg = pickConfig(body)
      const units = plan.pallets.map((p) => toPalletUnit(p, DEFAULT_PALLET, cons))
      const loading = planLoading(cfg, units, { dropMode: body.dropMode as string | undefined })
      return send(res, 200, { code: 0, requestId, elapsedMs: Math.round(performance.now() - t0), palletizingPlan: palletizing, loadingPlan: loadingPayload(orderId, cfg, units, loading) })
    }
    if (url.pathname === '/api/v1/loading/plans') {
      const cfg = pickConfig(body)
      const units = parsePalletUnits(text)
      const loading = planLoading(cfg, units, { dropMode: body.dropMode as string | undefined })
      return send(res, 200, { code: 0, requestId, elapsedMs: +(performance.now() - t0).toFixed(2), plan: loadingPayload(orderId, cfg, units, loading) })
    }
    send(res, 404, { code: 40401, message: '资源不存在', requestId })
  } catch (e) {
    const err = e as Error & { status?: number; code?: number }
    const bad = err instanceof SyntaxError || /无效|未找到|缺少/.test(err.message)
    send(res, err.status ?? (bad ? 400 : 500), { code: err.code ?? (bad ? 40001 : 50001), message: err.message, requestId })
  }
}).listen(port, () => console.log(`码盘与装载方案规划接口服务已启动：http://localhost:${port}/api/v1/health`))
