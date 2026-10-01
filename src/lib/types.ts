/** 共享类型定义 */

export interface Point {
  x: number;
  y: number;
}

/** 单件货物 */
export interface CargoItem {
  id: string;
  /** 登记（标称）重量，恒为正数；weightMin/weightMax 缺省时即确定重量 */
  weight: number;
  center: Point;
  /**
   * 可选的允许重量下界（正数）。省略时沿用确定重量：
   * 给定区间恒包含登记重量 weight。
   */
  weightMin?: number;
  /** 可选的允许重量上界（正数），weightMax >= weight >= weightMin */
  weightMax?: number;
}

/** 单件货物的允许重量闭区间（端点均为正数，且包含登记重量） */
export interface WeightInterval {
  /** 允许重量下界（缺省即登记重量） */
  min: number;
  /** 允许重量上界（缺省即登记重量） */
  max: number;
  /** 该件是否存在重量不确定性（min !== max） */
  uncertain: boolean;
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

/** 一条支撑边在全部允许重量组合下的鲁棒距离结论 */
export interface RobustEdgeInfo {
  edgeIndex: number;
  /**
   * 该边在整个允许重量盒域上的最小有符号距离（精确取于盒域端点组合）。
   * 线性分式极值必在端点取得，故无须抽样。
   */
  worstDistance: number;
  /** 取得该边最差距离的重量组合（每件取下界或上界，可复算） */
  worstWeights: number[];
  /** 该组合下的合成重心 */
  worstCog: Point;
  /** 该边在最差组合下是否仍满足 worstDistance >= margin */
  holds: boolean;
}

/** 鲁棒失败的见证：一组可复算的极端重量组合、对应重心及首先失守的边 */
export interface RobustFailureWitness {
  /** 与 items 顺序一一对应的极端重量（每件均为允许区间端点） */
  weights: number[];
  /** 该重量组合下的合成重心 */
  cog: Point;
  /** 首先失守的边（最差距离最小者，平局取边序号最小） */
  edgeIndex: number;
  /** 该组合下重心到失守边的有符号距离 */
  distance: number;
  /** 相对 margin 的短缺量（margin - distance，可为负之外的正量） */
  shortfall: number;
}

/**
 * 鲁棒放行分析：对支撑多边形的**每条边**证明全部允许重量组合
 * 均满足 margin，而不是只检查标称值或抽样。
 */
export interface RobustResult {
  /** 是否存在至少一件货物有非退化（min < max）重量区间 */
  hasUncertainWeights: boolean;
  /** 每条边的最差距离结论 */
  edges: RobustEdgeInfo[];
  /** 全部边的最差距离（未舍入） */
  worstMinDistance: number;
  /**
   * 鲁棒放行：每条边在所有允许重量组合下均满足距离 >= margin。
   * 边界相等（worstDistance === margin）算满足，与标称判定一致。
   */
  robustStable: boolean;
  /** 不满足时给出一组可复算见证；满足时为 null */
  failure: RobustFailureWitness | null;
  margin: number;
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
   * 放行结论：标称稳定、不存在任何“无法可靠表达”的量、
   * 且全部允许重量组合下每条边都满足 margin（鲁棒）时才为 true。
   * 无重量区间时鲁棒结论与标称结论完全一致（兼容旧数据）。
   * stable 为 true 但 releasable 为 false 表示计算上稳定、
   * 但存在不可审核的量（如合重量溢出）或极端重量组合会失守，禁止据此放行。
   */
  releasable: boolean;
  /** 无法可靠表达的量的显式反馈 */
  warnings: StabilityWarning[];
  margin: number;
  /** 不稳定时相对 margin 的短缺量，稳定时为 0 */
  shortfall: number;
  /**
   * 鲁棒放行结论（类型、导入、表单、数值面板与 SVG 共同消费）。
   * 对每条边证明所有允许重量组合均满足 margin；失败时附可复算见证。
   */
  robust: RobustResult;
}

/** 表单解析结果 */
export type FormResult =
  | { ok: true; workspace: Workspace }
  | { ok: false; errors: string[] };
