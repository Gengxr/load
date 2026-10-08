/**
 * 码垛机械臂（演示用的通用四轴构型）
 *
 * 四个关节：J1 底座回转、J2 大臂俯仰、J3 小臂俯仰、J4 末端回转；末端法兰始终保持水平，
 * 工具（吸盘）竖直向下。给定工具中心点（TCP）的位置与货物转角，用解析法求出各关节角。
 * 作业指令里的位姿与设备无关；这里的臂长、底座位置只用于把同一份指令演示出来。
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

/** 大臂、小臂长度，肩关节相对回转轴的前伸量，工具长度（腕心到 TCP），米 */
const L1 = 1.15
const L2 = 1.7
const A1 = 0.14
const TOOL = 0.3

export interface RobotState {
  /** J1–J4，度 */
  joints: [number, number, number, number]
  /** TCP 是否在可达范围内 */
  reachable: boolean
  gripping: boolean
}

export class RobotArm {
  readonly group = new THREE.Group()
  private yawG = new THREE.Group()
  private shoulderG = new THREE.Group()
  private elbowG = new THREE.Group()
  private wristG = new THREE.Group()
  private toolG = new THREE.Group()
  private plate!: THREE.Mesh
  private cups: THREE.Mesh[] = []
  private led!: THREE.MeshBasicMaterial
  private shoulderY: number
  readonly tcp = new THREE.Vector3()
  state: RobotState = { joints: [0, 0, 0, 0], reachable: true, gripping: false }

  /** base：底座中心在地面上的位置；shoulderY：肩关节的世界高度 */
  constructor(base: THREE.Vector3, shoulderY: number, accent: string) {
    this.shoulderY = shoulderY
    this.group.position.copy(base)
    const body = new THREE.MeshStandardMaterial({ color: 0xe8ecf1, metalness: 0.35, roughness: 0.42 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a323e, metalness: 0.7, roughness: 0.4 })
    const steel = new THREE.MeshStandardMaterial({ color: 0xb8c2cf, metalness: 0.9, roughness: 0.28 })
    this.led = new THREE.MeshBasicMaterial({ color: new THREE.Color(accent) })
    const add = (parent: THREE.Object3D, mesh: THREE.Mesh, x = 0, y = 0, z = 0) => {
      mesh.position.set(x, y, z)
      mesh.castShadow = true
      mesh.receiveShadow = true
      parent.add(mesh)
      return mesh
    }
    const sH = shoulderY - base.y

    // 底座
    add(this.group, new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.05, 48), dark), 0, 0.025, 0)
    add(this.group, new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, sH * 0.45, 48), body), 0, 0.05 + sH * 0.225, 0)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.262, 0.008, 10, 64), this.led)
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.05 + sH * 0.45
    this.group.add(ring)

    // J1 回转座
    this.yawG.position.y = 0.05 + sH * 0.45
    this.group.add(this.yawG)
    const colH = sH - (0.05 + sH * 0.45)
    add(this.yawG, new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.07, 48), dark), 0, 0.035, 0)
    add(this.yawG, new THREE.Mesh(new RoundedBoxGeometry(0.34, colH + 0.1, 0.3, 3, 0.04), body), A1 * 0.5, colH / 2 + 0.02, 0)
    const sj = add(this.yawG, new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.4, 40), dark), A1, colH, 0)
    sj.rotation.x = Math.PI / 2

    // J2 大臂
    this.shoulderG.position.set(A1, colH, 0)
    this.yawG.add(this.shoulderG)
    add(this.shoulderG, new THREE.Mesh(new RoundedBoxGeometry(L1 + 0.2, 0.2, 0.17, 3, 0.07), body), L1 / 2, 0, 0)
    add(this.shoulderG, new THREE.Mesh(new RoundedBoxGeometry(L1 * 0.5, 0.06, 0.19, 2, 0.02), dark), L1 * 0.5, 0, 0)
    // 平衡缸（装饰）
    const cyl = add(this.shoulderG, new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, L1 * 0.55, 20), steel), L1 * 0.3, 0.13, 0)
    cyl.rotation.z = Math.PI / 2

    // J3 小臂
    this.elbowG.position.set(L1, 0, 0)
    this.shoulderG.add(this.elbowG)
    const ej = add(this.elbowG, new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.3, 40), dark), 0, 0, 0)
    ej.rotation.x = Math.PI / 2
    add(this.elbowG, new THREE.Mesh(new RoundedBoxGeometry(L2 + 0.14, 0.15, 0.13, 3, 0.055), body), L2 / 2, 0, 0)
    add(this.elbowG, new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.22, 0.2, 3, 0.05), body), -0.14, 0.02, 0)

    // 腕部：保持水平
    this.wristG.position.set(L2, 0, 0)
    this.elbowG.add(this.wristG)
    const wj = add(this.wristG, new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.22, 32), dark), 0, 0, 0)
    wj.rotation.x = Math.PI / 2
    add(this.wristG, new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.16, 28), body), 0, -0.11, 0)
    const wring = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.006, 8, 40), this.led)
    wring.rotation.x = Math.PI / 2
    wring.position.y = -0.19
    this.wristG.add(wring)

    // J4 工具：吸盘架
    this.toolG.position.y = -0.19
    this.wristG.add(this.toolG)
    add(this.toolG, new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, TOOL - 0.19 - 0.045, 20), steel), 0, -(TOOL - 0.19 - 0.045) / 2, 0)
    this.plate = add(this.toolG, new THREE.Mesh(new RoundedBoxGeometry(1, 0.03, 1, 2, 0.012), dark), 0, -(TOOL - 0.19) + 0.03, 0)
    const cupGeo = new THREE.CylinderGeometry(0.022, 0.03, 0.03, 18)
    const cupMat = new THREE.MeshStandardMaterial({ color: 0x151a21, roughness: 0.9 })
    for (let i = 0; i < 6; i++) {
      const cup = new THREE.Mesh(cupGeo, cupMat)
      cup.position.y = -(TOOL - 0.19) + 0.015
      this.toolG.add(cup)
      this.cups.push(cup)
    }
    this.setTool(0.4, 0.3)
  }

  /** 吸盘架按货物顶面大小调整（米） */
  setTool(w: number, d: number) {
    const pw = Math.max(0.16, Math.min(0.62, w * 0.78))
    const pd = Math.max(0.14, Math.min(0.46, d * 0.78))
    this.plate.scale.set(pw, 1, pd)
    this.cups.forEach((c, i) => {
      const col = i % 3
      const row = Math.floor(i / 3)
      c.position.x = (col - 1) * pw * 0.34
      c.position.z = (row - 0.5) * pd * 0.5
    })
  }

  setGrip(on: boolean) {
    this.state.gripping = on
    this.led.color.set(on ? '#34d399' : '#22d3ee')
  }

  /** 把 TCP 移到世界坐标 p，toolYaw 为货物绕竖轴的转角（弧度） */
  setTcp(p: THREE.Vector3, toolYaw = 0) {
    this.tcp.copy(p)
    const bx = this.group.position.x
    const bz = this.group.position.z
    const dx = p.x - bx
    const dz = p.z - bz
    const yaw = Math.atan2(-dz, dx)
    const r = Math.hypot(dx, dz) - A1
    const h = p.y + TOOL - this.shoulderY
    const raw = Math.hypot(r, h)
    const D = Math.max(Math.abs(L1 - L2) + 0.06, Math.min(L1 + L2 - 0.01, raw))
    const reachable = Math.abs(D - raw) < 1e-6
    const a = Math.atan2(h, r) + Math.acos(THREE.MathUtils.clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1))
    const e = Math.acos(THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2), -1, 1))
    const b = a - (Math.PI - e)
    this.yawG.rotation.y = yaw
    this.shoulderG.rotation.z = a
    this.elbowG.rotation.z = e - Math.PI
    this.wristG.rotation.z = -b
    this.toolG.rotation.y = toolYaw - yaw
    const deg = THREE.MathUtils.radToDeg
    let j4 = deg(toolYaw - yaw) % 360
    if (j4 > 180) j4 -= 360
    if (j4 < -180) j4 += 360
    this.state = { joints: [deg(yaw), deg(a), deg(b), j4], reachable, gripping: this.state.gripping }
  }
}
