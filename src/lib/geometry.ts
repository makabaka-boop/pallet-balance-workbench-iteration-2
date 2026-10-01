import type {
  EdgeInfo,
  Point,
  RobustEdgeInfo,
  RobustFailureWitness,
  RobustResult,
  StabilityResult,
  WeightInterval,
  Workspace,
} from './types';

/** 2D 叉积 (b-a) × (c-a)，正值表示 c 在有向边 a→b 的左侧 */
export function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export type PolygonErrorType =
  | 'too-few-points'
  | 'duplicate-vertex'
  | 'degenerate-edge'
  | 'clockwise-or-degenerate'
  | 'non-convex'
  | 'non-convex-self-intersecting';

export interface PolygonCheck {
  valid: boolean;
  error?: PolygonErrorType;
}

/**
 * 校验多边形是否为逆时针顺序的严格凸多边形。
 * 逐三元组检测重复/退化/非凸，再用全局同侧检测兜住自交星形多边形。
 */
export function checkStrictConvexCCW(polygon: Point[]): PolygonCheck {
  const n = polygon.length;
  if (n < 3) return { valid: false, error: 'too-few-points' };

  // 相邻顶点重复
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    if (a.x === b.x && a.y === b.y) {
      return { valid: false, error: 'duplicate-vertex' };
    }
  }

  // 逐相邻三元组：严格凸且逆时针要求每个叉积严格为正
  for (let i = 0; i < n; i++) {
    const a = polygon[(i - 1 + n) % n];
    const b = polygon[i];
    const c = polygon[(i + 1) % n];
    const cr = cross(a, b, c);
    if (cr === 0) return { valid: false, error: 'degenerate-edge' };
    if (cr < 0) {
      // 出现右转：可能是顺时针，也可能是局部凹陷
      const allNegative = polygon.every((p, j) => {
        const q = polygon[(j + 1) % n];
        return cross(p, q, polygon[(j + 2) % n]) < 0;
      });
      return {
        valid: false,
        error: allNegative ? 'clockwise-or-degenerate' : 'non-convex',
      };
    }
  }

  // 全局同侧检测：每条有向边，其余所有顶点都必须严格在其左侧。
  // 五角星等自交多边形局部叉积可全为正，但会在此被拦截。
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    for (let j = 0; j < n; j++) {
      if (j === i || j === (i + 1) % n) continue;
      if (cross(a, b, polygon[j]) <= 0) {
        return { valid: false, error: 'non-convex-self-intersecting' };
      }
    }
  }

  return { valid: true };
}

/**
 * 点 p 到有向边 a→b 的有符号距离。
 * 逆时针多边形内部为正，边上为 0，外部为负。不做任何舍入。
 */
export function signedDistanceToEdge(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return NaN;
  return cross(a, b, p) / length;
}

export interface WeightedCentroidResult {
  cog: Point;
  /**
   * 合计重量；两件合法大重量之和超出 double 可表达范围时为 null。
   * 重心按最大重量缩放计算，即使合计重量不可表达仍然可靠；
   * 但未知合计量不得伪装成可审核的正常载荷。
   */
  totalWeight: number | null;
  /** 合计重量是否已溢出（无法可靠表达） */
  totalWeightOverflowed: boolean;
}

/**
 * 按重量加权的合成重心。
 * 常规量级直接求和；若中间和非有限（极端输入），改用最大重量缩放，
 * 重心仍可可靠求出；缩放后乘回的合计重量若仍非有限，如实返回 null。
 */
export function weightedCentroid(
  items: { weight: number; center: Point }[],
): WeightedCentroidResult {
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (const it of items) {
    sx += it.weight * it.center.x;
    sy += it.weight * it.center.y;
    sw += it.weight;
  }

  if (Number.isFinite(sx) && Number.isFinite(sy) && Number.isFinite(sw) && sw > 0) {
    return { cog: { x: sx / sw, y: sy / sw }, totalWeight: sw, totalWeightOverflowed: false };
  }

  // 极端输入兜底：按最大重量缩放（每个归一化重量 ∈ (0,1]，件数 ≤ 200，和恒有限）
  const maxW = items.reduce((m, it) => Math.max(m, it.weight), 0);
  sx = 0;
  sy = 0;
  sw = 0;
  for (const it of items) {
    const w = it.weight / maxW;
    sx += w * it.center.x;
    sy += w * it.center.y;
    sw += w;
  }
  const rescaled = sw * maxW;
  if (Number.isFinite(sx) && Number.isFinite(sy) && Number.isFinite(sw) && sw > 0) {
    return {
      cog: { x: sx / sw, y: sy / sw },
      totalWeight: Number.isFinite(rescaled) ? rescaled : null,
      totalWeightOverflowed: !Number.isFinite(rescaled),
    };
  }
  // 理论上不可达：输入已限定为有限数、坐标 ≤ 1e6
  return { cog: { x: NaN, y: NaN }, totalWeight: null, totalWeightOverflowed: true };
}

/** 多边形坐标尺度（绝对值上界，至少为 1） */
function polygonScale(polygon: Point[]): number {
  let m = 1;
  for (const p of polygon) {
    m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
  }
  return m;
}

/**
 * 当前坐标尺度下，margin 内缩能否在浮点中与原支撑边可靠区分。
 * 小于约 8·ε·M 的余量会整体落入表示噪声；此时任何几何内缩都不可信，
 * 必须显式反馈，而不是让“安全区”静默贴回原边。
 */
export function isMarginResolvable(polygon: Point[], margin: number): boolean {
  if (margin === 0) return true;
  if (!(margin > 0)) return false;
  const scale = polygonScale(polygon);
  if (margin < 8 * Number.EPSILON * scale) return false;

  // 每条边的平移后端点至少要有一个坐标真正发生改变
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return false;
    const nx = -dy / len;
    const ny = dx / len;
    const shifted =
      a.x + nx * margin !== a.x ||
      a.y + ny * margin !== a.y ||
      b.x + nx * margin !== b.x ||
      b.y + ny * margin !== b.y;
    if (!shifted) return false;
  }
  return true;
}

/** 平移后的边（向多边形内部推进 d） */
function shiftedEdge(
  a: Point,
  b: Point,
  d: number,
): { p: Point; dir: Point; ap: Point; bp: Point } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const ap = { x: a.x + nx * d, y: a.y + ny * d };
  const bp = { x: b.x + nx * d, y: b.y + ny * d };
  return { p: ap, dir: { x: dx, y: dy }, ap, bp };
}

/** 两条直线（非平行线）的交点 */
function lineIntersection(p1: Point, d1: Point, p2: Point, d2: Point): Point | null {
  const denom = cross({ x: 0, y: 0 }, d1, d2);
  if (denom === 0) return null;
  const t = cross({ x: 0, y: 0 }, { x: p2.x - p1.x, y: p2.y - p1.y }, d2) / denom;
  return { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
}

/**
 * 直接用相邻平移边的交点构造内缩多边形（单步数值误差，不累积）。
 * 任一交点落在其它平移半平面之外（内缩区塌缩等）时返回 null，
 * 交由顺序半平面裁剪处理。
 */
function directInset(polygon: Point[], margin: number, tolDist: number): Point[] | null {
  const n = polygon.length;
  const edges = polygon.map((a, i) =>
    shiftedEdge(a, polygon[(i + 1) % n], margin),
  );
  const verts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = edges[(i - 1 + n) % n];
    const cur = edges[i];
    const p = lineIntersection(prev.p, prev.dir, cur.p, cur.dir);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    // 交点必须满足全部平移半平面（允许 tolDist 的舍入容差）
    for (const e of edges) {
      if (signedDistanceToEdge(p, e.ap, e.bp) < -tolDist) return null;
    }
    verts.push(p);
  }
  return verts;
}

/**
 * 用一条向多边形内部平移 d 的半平面裁剪凸多边形（Sutherland–Hodgman）。
 * 保留半平面 cross(ap,bp,p) >= -eps，eps 只取坐标尺度的舍入噪声，
 * 绝不随 d 放大——否则极小正余量会被容差整体吞掉、原边顶点被误留。
 */
function clipConvexPolygonByHalfPlane(
  poly: Point[],
  ap: Point,
  bp: Point,
  eps: number,
): Point[] {
  const side = (p: Point): number => cross(ap, bp, p);

  if (poly.length === 0) return poly;
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i - 1 + poly.length) % poly.length];
    const curSide = side(cur);
    const prevSide = side(prev);
    const curIn = curSide >= eps;
    const prevIn = prevSide >= eps;

    if (prevIn !== curIn) {
      // 求 prev→cur 与平移边的交点
      const denom = curSide - prevSide;
      if (denom !== 0) {
        const t = -prevSide / denom;
        out.push({
          x: prev.x + t * (cur.x - prev.x),
          y: prev.y + t * (cur.y - prev.y),
        });
      }
    }
    if (curIn) out.push(cur);
  }
  return out;
}

/** margin 内缩后的安全区域；margin 为 0 时直接返回原多边形 */
export function insetPolygon(polygon: Point[], margin: number): Point[] {
  if (margin === 0) return polygon;
  // 无法在当前坐标尺度下可靠表达的内缩：不伪造贴边的“安全区”
  if (!isMarginResolvable(polygon, margin)) return [];

  const scale = polygonScale(polygon);
  const tolDist = 8 * Number.EPSILON * scale;
  const direct = directInset(polygon, margin, tolDist);
  if (direct) return direct;

  // 顺序裁剪兜底（大余量塌缩、数值退化等）
  let region = polygon;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const { ap, bp } = shiftedEdge(a, b, margin);
    region = clipConvexPolygonByHalfPlane(region, ap, bp, -tolDist * len);
    if (region.length === 0) break;
  }
  return region;
}

/**
 * 取每件货物的允许重量闭区间。省略任一端点即沿用登记重量，
 * 因此旧数据（无区间）下每件 min === max === weight。
 */
export function weightIntervals(
  items: { weight: number; weightMin?: number; weightMax?: number }[],
): WeightInterval[] {
  return items.map((it) => {
    const min = it.weightMin ?? it.weight;
    const max = it.weightMax ?? it.weight;
    return { min, max, uncertain: min !== max };
  });
}

/**
 * 给定重量组合下的合成重心，溢出安全：按最大重量归一化后计算，
 * 与 weightedCentroid 的兜底路径同构。任何合法（正、有限）重量组合均可可靠求值。
 */
function centroidFromWeights(
  items: { weight: number; center: Point }[],
  weights: number[],
): Point {
  const maxW = weights.reduce((m, w) => Math.max(m, w), 0);
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let i = 0; i < items.length; i++) {
    const r = weights[i] / maxW; // ∈ (0,1]；跨度过大时可能下溢为 0（该件贡献可忽略）
    sx += r * items[i].center.x;
    sy += r * items[i].center.y;
    sw += r;
  }
  return { x: sx / sw, y: sy / sw };
}

/**
 * 单条有向边在整个允许重量盒域 W = ∏[min_i,max_i] 上的最小有符号距离。
 *
 * 距离为线性分式：Σ wᵢ·kᵢ / (Σ wᵢ·L)，其中
 *   kᵢ = cross(a,b,pᵢ)（第 i 件货物中心相对该边的叉积），L = 边长 > 0。
 * 其水平集 {距离 ≥ t} 等价于 Σ wᵢ(kᵢ − tL) ≥ 0，是盒域上的线性阈值，
 * 故距离为拟凹函数，**全局最小值必在盒域顶点（每件取下界或上界）取得**。
 *
 * 取 t = 最小值时的最优顶点是按 dᵢ = kᵢ/L（各件中心到该边的有符号距离）
 * 与 t 的大小分段：要最小化分式，dᵢ < t 的取**上界**（压低均值），dᵢ ≥ t 取下界。
 * 候选切点只有 n+1 个，逐一计算即可精确找到全局最小
 * （O(n² log n)，件数 ≤ 200），无须抽样。
 *
 * 全部运算以最大上界重量归一化，合计溢出时结论仍可靠。
 */
function worstEdgeDistance(
  items: { weight: number; center: Point }[],
  intervals: WeightInterval[],
  a: Point,
  b: Point,
): { value: number; weights: number[]; cog: Point } {
  const n = items.length;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);

  // 以最大上界重量归一化，避免 Σw 溢出；分式距离对公共缩放不敏感
  const maxHi = intervals.reduce((m, iv) => Math.max(m, iv.max), 0);
  const lo = intervals.map((iv) => iv.min / maxHi);
  const hi = intervals.map((iv) => iv.max / maxHi);
  // 每件中心到该边的有符号距离 d_i = cross(a,b,p_i)/len
  const d = items.map((it) => cross(a, b, it.center) / len);

  // 按 d_i 升序的下标。候选分段：前 cut 个（d 最小）取上界，其余取下界，cut = 0..n
  const order = d.map((_, i) => i).sort((i, j) => d[i] - d[j]);

  // cut = 0：全部取下界；cut = n：全部取上界；其间为各切点
  let best: { value: number; atHi: boolean[] } = {
    value: Infinity,
    atHi: [],
  };
  const evaluate = (cut: number): { value: number; atHi: boolean[] } => {
    // 按 d 升序后：前 cut 个（d 最小）取上界，其余取下界
    const atHi = new Array<boolean>(n).fill(false);
    for (let k = 0; k < cut; k++) atHi[order[k]] = true;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      const w = atHi[i] ? hi[i] : lo[i];
      num += w * d[i];
      den += w;
    }
    return { value: num / den, atHi };
  };

  for (let cut = 0; cut <= n; cut++) {
    const cand = evaluate(cut);
    // 平局保持确定性：取先评估到的更小值（cut 从小到大）
    if (cand.value < best.value) best = cand;
  }

  const weights = best.atHi.map((isHi, i) =>
    isHi ? intervals[i].max : intervals[i].min,
  );
  // 见证重心直接用未归一化重量组合复算，保证面板/SVG 可独立复核
  const cog = centroidFromWeights(items, weights);
  return { value: best.value, weights, cog };
}

/**
 * 鲁棒分析：对支撑多边形的**每条边**求全部允许重量组合下的最差距离。
 * 任一边最差距离 < margin 即存在可失守组合，返回全局最差边及其见证；
 * 边界相等（worstDistance === margin）算满足，与标称判定一致。
 */
export function analyzeRobustness(
  polygon: Point[],
  items: CargoItemLike[],
  margin: number,
): RobustResult {
  const intervals = weightIntervals(items);
  const hasUncertainWeights = intervals.some((iv) => iv.uncertain);
  const n = polygon.length;

  const edges: RobustEdgeInfo[] = [];
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const worst = worstEdgeDistance(items, intervals, a, b);
    // 以见证重心直接复算该边距离，与标称计算路径一致（可复核）
    const recomputed = signedDistanceToEdge(worst.cog, a, b);
    edges.push({
      edgeIndex: i,
      worstDistance: recomputed,
      worstWeights: worst.weights,
      worstCog: worst.cog,
      holds: recomputed >= margin,
    });
  }

  // 全局最差边：值最小，平局取序号最小（与标称 criticalEdge 的确定性一致）
  const critical = edges.reduce((m, e) =>
    e.worstDistance < m.worstDistance ? e : m,
  );

  let failure: RobustFailureWitness | null = null;
  let robustStable = true;
  if (critical.worstDistance < margin) {
    robustStable = false;
    failure = {
      weights: critical.worstWeights,
      cog: critical.worstCog,
      edgeIndex: critical.edgeIndex,
      distance: critical.worstDistance,
      shortfall: margin - critical.worstDistance,
    };
  }

  return {
    hasUncertainWeights,
    edges,
    worstMinDistance: critical.worstDistance,
    robustStable,
    failure,
    margin,
  };
}

type CargoItemLike = { weight: number; center: Point; weightMin?: number; weightMax?: number };

/**
 * 对一份合法工作区执行完整稳定性分析。
 * 距离判断、稳定性结论均使用未舍入值；返回结果同时驱动数值面板与 SVG。
 * 无法可靠表达的量（合计重量溢出、余量低于图形分辨极限）进入 warnings，
 * 并使 releasable 为 false——计算结论可以照给，但不能据此放行。
 */
export function analyzeStability(ws: Workspace): StabilityResult {
  const { polygon, items, margin } = ws;
  const { cog, totalWeight, totalWeightOverflowed } = weightedCentroid(items);
  const n = polygon.length;

  const edges: EdgeInfo[] = [];
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    edges.push({
      index: i,
      a,
      b,
      signedDistance: signedDistanceToEdge(cog, a, b),
    });
  }

  // min 天然取第一条最危险边作为平局时的稳定结果
  const criticalEdge = edges.reduce((m, e) =>
    e.signedDistance < m.signedDistance ? e : m,
  );
  const minDistance = criticalEdge.signedDistance;
  // 原始未舍入数值判定：恰在边上（距离 0 = margin 0）算稳定
  const stable = minDistance >= margin;

  const warnings: StabilityResult['warnings'] = [];
  if (totalWeightOverflowed || totalWeight === null) {
    warnings.push({
      code: 'total-weight-overflow',
      message:
        `合计重量超出数值可表达范围（两件合法大重量之和溢出），显示为缺失值；` +
        `重心几何结论仅供参考，本载荷不可作为可审核的正常载荷放行。`,
    });
  }

  let safeRegion: Point[];
  if (margin === 0) {
    safeRegion = polygon;
  } else if (!isMarginResolvable(polygon, margin)) {
    safeRegion = [];
    warnings.push({
      code: 'margin-below-resolution',
      message:
        `要求余量 ${margin} 小于当前坐标尺度下的图形分辨极限，` +
        `内缩安全区无法与原支撑边可靠区分，故不绘制；请增大余量或改用更大坐标尺度。`,
    });
  } else {
    safeRegion = insetPolygon(polygon, margin);
  }

  // 鲁棒放行：对每条边证明所有允许重量组合都满足 margin。
  // 与标称结论同源（同一 polygon/items/margin），共同驱动面板与 SVG。
  const robust = analyzeRobustness(polygon, items, margin);

  return {
    polygon,
    items,
    cog,
    totalWeight,
    edges,
    minDistance,
    criticalEdge,
    safeRegion,
    stable,
    releasable: stable && warnings.length === 0 && robust.robustStable,
    warnings,
    margin,
    shortfall: stable ? 0 : margin - minDistance,
    robust,
  };
}
