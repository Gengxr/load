/**
 * 机械臂作业指令（与具体设备无关）
 *
 * 把码放方案展开成逐件的"取 — 放"任务。所有位姿都用工具中心点（TCP，吸盘或夹具的下表面中心）表示：
 *   - 取料位姿在"取料坐标系"里：原点 = 输送线末端定位挡块与输送面中线的交点，X 指向来料方向的反向（朝货盘），Z 向上；
 *   - 放置位姿在"货盘坐标系"里：原点 = 货盘可用区域左前角（货盘上表面），X 右、Y 远离取料侧、Z 向上。
 * 机械臂控制器只要标定这两个坐标系，就可以按顺序直接执行，不需要再做装箱计算或路径规划：
 * 每件都是"取料点正上方 → 抬到安全高度 → 平移到放置点正上方 → 竖直放下"，途中不会碰到已码好的货物。
 * 人工码放用的是同一份方案、同一个顺序，只是把位姿换成动画和文字指引。
 */
import type { Cargo, CargoKind, Constraints, PlanResult, SequenceResult } from './types'

export interface RobotPose {
  /** mm */
  x: number
  y: number
  z: number
  /** 绕竖轴的转角，度 */
  rz: number
}

export interface RobotTask {
  seq: number
  cargoId: string
  rfid: string
  name: string
  kind: CargoKind
  /** 长 × 宽 × 高 mm（取料时长边沿取料坐标系 X） */
  size: [number, number, number]
  weight: number
  layer: number
  pick: RobotPose
  place: RobotPose
  /** 平移段的最低安全高度（货盘坐标系 Z，TCP）：越过已码货物并留出余量 */
  transferZ: number
  /** 放置点正上方的进入高度（货盘坐标系 Z，TCP），从这里竖直放下 */
  approachZ: number
  gripper: { type: 'vacuum' | 'clamp'; /** 吸盘分区数或夹持开口 mm */ value: number }
  /** 速度比例 0–1：重件、怕压件降速 */
  speed: number
  /** 放下之前必须已经就位的货物（它的支撑件）的序号 */
  after: number[]
  /** 估算用时 s */
  seconds: number
}

export interface RobotJob {
  schema: 'palletizing-robot-job/1.0'
  palletId: string
  units: { length: 'mm'; angle: 'deg'; mass: 'kg'; time: 's' }
  frames: { pallet: string; pick: string; tcp: string }
  envelope: { x: number; y: number; z: number }
  /** 执行这份任务所需的工作空间（货盘坐标系，TCP）与最大负载，用于核对机械臂选型 */
  requirement: { x: [number, number]; y: [number, number]; z: [number, number]; payload: number }
  summary: { count: number; weight: number; seconds: number; perHour: number }
  tasks: RobotTask[]
}

/** 平移时高出已码货物的余量、放置前的进入高度 mm */
export const ROBOT_CLEARANCE = 120
export const ROBOT_APPROACH = 150

const r1 = (v: number) => Math.round(v * 10) / 10

export function buildRobotJob(palletId: string, res: PlanResult, seq: SequenceResult, cargos: Cargo[], cons: Constraints): RobotJob {
  const pl = res.layout.placements
  const byId = new Map(cargos.map((c) => [c.id, c]))
  const seqNo = new Map(seq.order.map((i, k) => [i, k + 1]))
  const tasks: RobotTask[] = []
  let stackTop = 0
  let total = 0
  let wsum = 0
  const req = { x: [Infinity, -Infinity] as [number, number], y: [Infinity, -Infinity] as [number, number], z: [Infinity, -Infinity] as [number, number], payload: 0 }
  seq.order.forEach((i, k) => {
    const p = pl[i]
    const c = byId.get(p.cargoId)
    const kind: CargoKind = p.kind ?? 'carton'
    const L = Math.max(p.dx, p.dy)
    const W = Math.min(p.dx, p.dy)
    const place: RobotPose = { x: r1(p.x + p.dx / 2), y: r1(p.y + p.dy / 2), z: r1(p.z + p.dz), rz: p.dx >= p.dy ? 0 : 90 }
    const pick: RobotPose = { x: r1(-L / 2), y: 0, z: r1(p.dz), rz: 0 }
    const transferZ = r1(Math.max(stackTop, p.z) + ROBOT_CLEARANCE + p.dz)
    const approachZ = r1(Math.min(transferZ, place.z + ROBOT_APPROACH))
    const speed = c?.fragile ? 0.4 : p.weight > 30 ? 0.5 : p.weight > 15 ? 0.75 : 1
    // 估算：取放各约 1.2 s，其余按行程（竖直 + 水平）折算
    const travel = (transferZ - pick.z + (transferZ - place.z)) / 1000 + Math.hypot(place.x + 900, place.y - cons.footprintY / 2) / 1000
    const seconds = r1(2.4 + (travel * 2 * 0.9) / speed)
    tasks.push({
      seq: k + 1,
      cargoId: p.cargoId,
      rfid: c?.rfid ?? '',
      name: c?.name ?? '',
      kind,
      size: [L, W, p.dz],
      weight: p.weight,
      layer: p.layer + 1,
      pick,
      place,
      transferZ,
      approachZ,
      gripper: kind === 'carton' ? { type: 'vacuum', value: Math.max(1, Math.round((L * W) / 60000)) } : { type: 'clamp', value: W },
      speed,
      after: res.supporters[i].map((j) => seqNo.get(j)!).sort((a, b) => a - b),
      seconds,
    })
    stackTop = Math.max(stackTop, p.z + p.dz)
    total += seconds
    wsum += p.weight
    req.x = [Math.min(req.x[0], place.x), Math.max(req.x[1], place.x)]
    req.y = [Math.min(req.y[0], place.y), Math.max(req.y[1], place.y)]
    req.z = [Math.min(req.z[0], place.z), Math.max(req.z[1], transferZ)]
    req.payload = Math.max(req.payload, p.weight)
  })
  if (!tasks.length) req.x = req.y = req.z = [0, 0]
  return {
    schema: 'palletizing-robot-job/1.0',
    palletId,
    units: { length: 'mm', angle: 'deg', mass: 'kg', time: 's' },
    frames: {
      pallet: '货盘坐标系：原点为货盘可用区域左前角（货盘上表面），X 右、Y 远离取料侧、Z 向上',
      pick: '取料坐标系：原点为输送线末端定位挡块与输送面中线的交点，X 朝向货盘、Z 向上；货物长边沿 X，靠挡块定位',
      tcp: '工具中心点：吸盘或夹具下表面中心，对准货物顶面中心；rz 为绕竖轴的转角',
    },
    envelope: { x: cons.footprintX, y: cons.footprintY, z: cons.maxStackHeight },
    requirement: { x: req.x, y: req.y, z: req.z, payload: Math.round(req.payload * 100) / 100 },
    summary: { count: tasks.length, weight: Math.round(wsum * 100) / 100, seconds: Math.round(total), perHour: total > 0 ? Math.round((tasks.length / total) * 3600) : 0 },
    tasks,
  }
}

/** 逐行的路径点表（CSV），便于直接导入机械臂示教器或上位机 */
export function robotJobCsv(job: RobotJob): string {
  const head = ['seq', 'cargo_id', 'rfid', 'kind', 'L', 'W', 'H', 'weight_kg', 'pick_x', 'pick_y', 'pick_z', 'pick_rz', 'place_x', 'place_y', 'place_z', 'place_rz', 'transfer_z', 'approach_z', 'gripper', 'gripper_value', 'speed', 'after']
  const rows = job.tasks.map((t) =>
    [t.seq, t.cargoId, t.rfid, t.kind, ...t.size, t.weight, t.pick.x, t.pick.y, t.pick.z, t.pick.rz, t.place.x, t.place.y, t.place.z, t.place.rz, t.transferZ, t.approachZ, t.gripper.type, t.gripper.value, t.speed, t.after.join(' ')].join(','),
  )
  return [head.join(','), ...rows].join('\n')
}
