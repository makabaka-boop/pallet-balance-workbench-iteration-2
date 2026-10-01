/** 共享类型定义 */

export interface Point {
  x: number;
  y: number;
}

/** 单件货物 */
export interface CargoItem {
  id: string;
  weight: number;
  center: Point;
}

/** 已通过校验、可用于计算的工作区数据 */
export interface Workspace {
  /** 严格凸、逆时针排列的支撑多边形 */
  polygon: Point[];
  /** 1..200 件货物，id 唯一 */
  items: CargoItem[];
  /** 安全余量（非负） */
  margin: number;
}

/** 支撑多边形的一条边及其到某点的有符号距离 */
export interface EdgeInfo {
  index: number;
  a: Point;
  b: Point;
  /** 有符号距离：逆时针多边形内部为正 */
  signedDistance: number;
}

/** 无法可靠表达、必须显式反馈的量 */
export type WarningCode =
  | 'total-weight-overflow'
  | 'margin-below-resolution';

export interface StabilityWarning {
  code: WarningCode;
  /** 面板/图形上直接展示的中文说明 */
  message: string;
}

/** 稳定性计算结果（图形与数值共用同一份） */
export interface StabilityResult {
  /** 本次计算使用的支撑多边形 */
  polygon: Point[];
  /** 参与本次计算的货物（已通过校验） */
  items: CargoItem[];
  cog: Point;
  /**
   * 合计重量。两件合法大重量之和超出 double 可表达范围时为 null——
   * 未知合计量不得伪装成可审核的正常载荷。
   */
  totalWeight: number | null;
  edges: EdgeInfo[];
  /** 重心到各支撑边的最小有符号距离（未舍入） */
  minDistance: number;
  /** 取得最小距离的边 */
  criticalEdge: EdgeInfo;
  /**
   * margin 内缩后的安全区域（半平面裁剪结果）。
   * margin 大于内切余量时塌缩为空；
   * margin 小到低于当前坐标尺度的浮点分辨极限时同样为空，
   * 由 warnings 显式说明，绝不回贴到原支撑边冒充已内缩。
   */
  safeRegion: Point[];
  /**
   * 原始未舍入数值判定：minDistance >= margin。
   * margin=0 时恰在边上仍算稳定（保持兼容）。
   */
  stable: boolean;
  /**
   * 放行结论：稳定且不存在任何“无法可靠表达”的量时才为 true。
   * stable 为 true 但 releasable 为 false 表示计算上稳定、
   * 但存在不可审核的量（如合重量溢出），禁止据此放行。
   */
  releasable: boolean;
  /** 无法可靠表达的量的显式反馈 */
  warnings: StabilityWarning[];
  margin: number;
  /** 不稳定时相对 margin 的短缺量，稳定时为 0 */
  shortfall: number;
}

/** 表单解析结果 */
export type FormResult =
  | { ok: true; workspace: Workspace }
  | { ok: false; errors: string[] };
