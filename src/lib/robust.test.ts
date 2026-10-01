import { describe, expect, it } from 'vitest';
import {
  analyzeRobustness,
  analyzeStability,
  signedDistanceToEdge,
  weightIntervals,
} from './geometry';
import { resolveForm } from './form';
import { parseWorkspace, parseWorkspaceJSON } from './parse';
import type { CargoItem, Point, WeightInterval, Workspace } from './types';

/** 边长 100 的逆时针正方形支承 */
const square100: Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

interface Spec {
  id: string;
  w: number;
  x: number;
  y: number;
  min?: number;
  max?: number;
}

function item(s: Spec): CargoItem {
  const it: CargoItem = { id: s.id, weight: s.w, center: { x: s.x, y: s.y } };
  if (s.min !== undefined) it.weightMin = s.min;
  if (s.max !== undefined) it.weightMax = s.max;
  return it;
}

function items(...specs: Spec[]): CargoItem[] {
  return specs.map(item);
}

function ws(polygon: Point[], list: CargoItem[], margin = 0): Workspace {
  return { polygon, items: list, margin };
}

/* ---------------------------------------------------------------------------
 * 独立预言机：枚举允许重量盒域的全部 2^n 端点组合（件数少时可行），
 * 直接对每个组合逐边计算距离并取最小值。
 * 该实现刻意独立于被测的分段切点算法（不共享任何鲁棒代码路径）。
 * ------------------------------------------------------------------------- */
interface OracleResult {
  /** 每条边的全局最差距离及取得它的重量组合 */
  perEdge: Array<{ edgeIndex: number; worst: number; weights: number[] }>;
  /** 全局最差：距离最小，平局取边序号最小 */
  worst: number;
  edgeIndex: number;
  weights: number[];
}

function cogOf(
  list: CargoItem[],
  weights: number[],
): Point {
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let i = 0; i < list.length; i++) {
    sx += weights[i] * list[i].center.x;
    sy += weights[i] * list[i].center.y;
    sw += weights[i];
  }
  return { x: sx / sw, y: sy / sw };
}

function bruteForce(
  polygon: Point[],
  list: CargoItem[],
  intervals: WeightInterval[],
): OracleResult {
  const n = list.length;
  const perEdge = polygon.map((_, ei) => ({
    edgeIndex: ei,
    worst: Infinity,
    weights: [] as number[],
  }));

  const total = 2 ** n;
  for (let mask = 0; mask < total; mask++) {
    const weights = intervals.map((iv, i) => ((mask >> i) & 1 ? iv.max : iv.min));
    const cog = cogOf(list, weights);
    for (let ei = 0; ei < polygon.length; ei++) {
      const a = polygon[ei];
      const b = polygon[(ei + 1) % polygon.length];
      const d = signedDistanceToEdge(cog, a, b);
      // 平局保持“先到先得”：mask 与边序号均升序
      if (d < perEdge[ei].worst) {
        perEdge[ei].worst = d;
        perEdge[ei].weights = [...weights];
      }
    }
  }

  let edgeIndex = 0;
  for (let ei = 1; ei < perEdge.length; ei++) {
    if (perEdge[ei].worst < perEdge[edgeIndex].worst) edgeIndex = ei;
  }
  return {
    perEdge,
    worst: perEdge[edgeIndex].worst,
    edgeIndex,
    weights: perEdge[edgeIndex].weights,
  };
}

/** 被测结果与独立预言机在每条边上一致（距离精确到 10 位相对容差） */
function expectMatchesOracle(
  polygon: Point[],
  list: CargoItem[],
  margin: number,
): ReturnType<typeof analyzeRobustness> {
  const intervals = weightIntervals(list);
  const robust = analyzeRobustness(polygon, list, margin);
  const oracle = bruteForce(polygon, list, intervals);

  expect(robust.edges.length).toBe(polygon.length);
  for (const re of robust.edges) {
    const o = oracle.perEdge[re.edgeIndex];
    expect(re.worstDistance).toBeCloseTo(o.worst, 10);
    // 见证重量必须真是区间端点
    re.worstWeights.forEach((w, i) => {
      expect(w === intervals[i].min || w === intervals[i].max).toBe(true);
    });
    // 见证可复算：用返回的重量组合直接重算重心与该边距离，必须与结论一致
    const cog = cogOf(list, re.worstWeights);
    const a = polygon[re.edgeIndex];
    const b = polygon[(re.edgeIndex + 1) % polygon.length];
    expect(cog.x).toBeCloseTo(re.worstCog.x, 10);
    expect(cog.y).toBeCloseTo(re.worstCog.y, 10);
    expect(signedDistanceToEdge(cog, a, b)).toBeCloseTo(re.worstDistance, 10);
    expect(re.holds).toBe(re.worstDistance >= margin);
  }
  expect(robust.worstMinDistance).toBeCloseTo(oracle.worst, 10);
  expect(robust.robustStable).toBe(oracle.worst >= margin);
  if (!robust.robustStable && robust.failure) {
    expect(robust.failure.edgeIndex).toBe(oracle.edgeIndex);
    expect(robust.failure.distance).toBeCloseTo(oracle.worst, 10);
    expect(robust.failure.shortfall).toBeCloseTo(margin - oracle.worst, 10);
    // 失败见证组合必须真的是最差组合（与预言机等距即可，平局允许不同端点）
    const fc = cogOf(list, robust.failure.weights);
    const a = polygon[oracle.edgeIndex];
    const b = polygon[(oracle.edgeIndex + 1) % polygon.length];
    expect(signedDistanceToEdge(fc, a, b)).toBeCloseTo(oracle.worst, 10);
  } else {
    expect(robust.failure).toBeNull();
  }
  return robust;
}

describe('鲁棒分析：全端点组合独立预言机', () => {
  it('两件货物 + 四边形：每条边最差距离与 2²=4 组合枚举一致', () => {
    const list = items(
      { id: 'a', w: 10, min: 5, max: 20, x: 30, y: 60 },
      { id: 'b', w: 10, min: 2, max: 30, x: 70, y: 40 },
    );
    const r = expectMatchesOracle(square100, list, 10);
    expect(r.hasUncertainWeights).toBe(true);
    expect(r.robustStable).toBe(true);
  });

  it('三件货物 + 三角形：与 2³=8 组合枚举一致', () => {
    const tri: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 100 },
    ];
    const list = items(
      { id: 'a', w: 8, min: 1, max: 50, x: 40, y: 20 },
      { id: 'b', w: 12, min: 10, max: 15, x: 60, y: 30 },
      { id: 'c', w: 5, min: 4, max: 40, x: 50, y: 70 },
    );
    expectMatchesOracle(tri, list, 5);
  });

  it('五件货物 + 六边形：与 2⁵=32 组合枚举一致', () => {
    const hex: Point[] = [
      { x: 0, y: 0 },
      { x: 4200, y: 0 },
      { x: 4200, y: 1400 },
      { x: 3200, y: 2200 },
      { x: 900, y: 2200 },
      { x: 0, y: 1500 },
    ];
    const list = items(
      { id: 'A', w: 120, min: 108, max: 132, x: 1200, y: 800 },
      { id: 'B', w: 210, min: 189, max: 231, x: 2400, y: 1100 },
      { id: 'C', w: 165, max: 182, x: 2900, y: 1650 },
      { id: 'D', w: 90, min: 81, x: 1600, y: 1700 },
      { id: 'E', w: 55, x: 700, y: 1200 },
    );
    const r = expectMatchesOracle(hex, list, 150);
    expect(r.robustStable).toBe(true);
  });

  it('标称稳定但某极端组合失守：robustStable=false 且见证与枚举一致', () => {
    // a 贴近底边、b 靠中心；a 占比拉满时重心逼近底边
    const list = items(
      { id: 'a', w: 10, min: 10, max: 100, x: 50, y: 5 },
      { id: 'b', w: 90, min: 10, max: 100, x: 50, y: 60 },
    );
    // 标称（10/90）：y≈54.5 稳定；极端 a=100,b=10：y=10，margin=15 失守
    const nominal = analyzeStability(ws(square100, list, 15));
    expect(nominal.stable).toBe(true);
    const r = expectMatchesOracle(square100, list, 15);
    expect(r.robustStable).toBe(false);
    expect(r.failure!.edgeIndex).toBe(0); // 底边
    expect(nominal.releasable).toBe(false); // 数值能裁决但鲁棒失败 → 不可放行
  });

  it('极端组合把重心推到支撑边之外：见证距离为负、短缺 > margin', () => {
    const list = items(
      { id: 'a', w: 50, min: 1, max: 100, x: 50, y: 5 },
      { id: 'b', w: 50, min: 1, max: 100, x: 50, y: 95 },
    );
    // a=100,b=1：y≈5.9 在内部；换成 y=-10 的外部点才能越界
    const list2 = items(
      { id: 'a', w: 50, min: 1, max: 100, x: 50, y: -10 },
      { id: 'b', w: 50, min: 1, max: 100, x: 50, y: 95 },
    );
    const r = expectMatchesOracle(square100, list2, 5);
    expect(r.robustStable).toBe(false);
    expect(r.failure!.distance).toBeLessThan(0);
    expect(r.failure!.shortfall).toBeCloseTo(5 - r.failure!.distance, 10);
    // 对照组：区间窄时全部组合安全
    const r2 = expectMatchesOracle(square100, list, 2);
    expect(r2.robustStable).toBe(true);
  });

  it('单边有界（仅下界 / 仅上界）同样按端点枚举验证', () => {
    const list = items(
      { id: 'a', w: 10, min: 5, x: 20, y: 20 },
      { id: 'b', w: 10, max: 30, x: 80, y: 80 },
      { id: 'c', w: 10, min: 1, max: 60, x: 50, y: 50 },
    );
    expectMatchesOracle(square100, list, 3);
  });
});

describe('鲁棒边界相等', () => {
  it('最差距离恰好等于 margin：边界算满足（无 epsilon）', () => {
    // 两件中心都在 y=1 上：无论重量如何组合，重心 y 恒为 1
    const list = items(
      { id: 'a', w: 10, min: 1, max: 100, x: 30, y: 1 },
      { id: 'b', w: 10, min: 1, max: 100, x: 70, y: 1 },
    );
    const r = analyzeRobustness(square100, list, 1);
    expect(r.worstMinDistance).toBeCloseTo(1, 12);
    expect(r.robustStable).toBe(true);
    expect(r.failure).toBeNull();
    // 完整分析也可放行
    const full = analyzeStability(ws(square100, list, 1));
    expect(full.stable).toBe(true);
    expect(full.releasable).toBe(true);
  });

  it('最差距离比 margin 小极小量（1e-9）时严格失败，不被舍入放行', () => {
    const list = items(
      { id: 'a', w: 10, min: 1, max: 100, x: 30, y: 1 - 1e-9 },
      { id: 'b', w: 10, min: 1, max: 100, x: 70, y: 1 - 1e-9 },
    );
    const r = analyzeRobustness(square100, list, 1);
    expect(r.robustStable).toBe(false);
    expect(r.failure!.shortfall).toBeCloseTo(1e-9, 8);
  });

  it('margin=0：最差距离恰为 0 时鲁棒可放行（兼容标称边界语义）', () => {
    const list = items(
      { id: 'a', w: 10, min: 1, max: 100, x: 30, y: 0 },
      { id: 'b', w: 10, min: 1, max: 100, x: 70, y: 0 },
    );
    const r = analyzeRobustness(square100, list, 0);
    expect(r.robustStable).toBe(true);
  });

  it('平局：两条边同时最差时取序号最小者作为首先失守边', () => {
    // 单件在 (0,0)：到边 0 与边 3 距离都为 0
    const list = items({ id: 'a', w: 1, min: 1, max: 2, x: 0, y: 0 });
    const r = analyzeRobustness(square100, list, 1);
    expect(r.robustStable).toBe(false);
    expect(r.failure!.edgeIndex).toBe(0);
  });
});

describe('极端重量溢出下的鲁棒结论仍可靠', () => {
  it('端点重量之和溢出 double：归一化计算的最差距离仍与“缩放预言机”一致', () => {
    const list = items(
      { id: 'a', w: 1.7e308, min: 1, max: 1.7e308, x: 50, y: 5 },
      { id: 'b', w: 1.7e308, min: 1, max: 1.7e308, x: 50, y: 60 },
    );
    const r = analyzeStability(ws(square100, list, 10));
    // a 拉满、b 取下界时 y≈5，距底边 5 < 10 → 鲁棒失败
    expect(r.robust.robustStable).toBe(false);
    expect(r.robust.failure!.edgeIndex).toBe(0);
    expect(r.robust.failure!.weights[0]).toBe(1.7e308);
    expect(r.robust.failure!.weights[1]).toBe(1);
    // 见证重心可复算且有限
    expect(Number.isFinite(r.robust.failure!.cog.y)).toBe(true);
    expect(r.robust.failure!.cog.y).toBeCloseTo(5, 8);
    // 标称重心本身（两者都 1.7e308）在 y=32.5，标称稳定但不可放行
    expect(r.stable).toBe(true);
    expect(r.releasable).toBe(false);
  });

  it('极端重量下全部组合都安全时鲁棒可放行（标称总重仍可能溢出而暂缓）', () => {
    const list = items(
      { id: 'a', w: 1.7e308, min: 1e307, max: 1.7e308, x: 45, y: 50 },
      { id: 'b', w: 1.7e308, min: 1e307, max: 1.7e308, x: 55, y: 50 },
    );
    const r = analyzeStability(ws(square100, list, 40));
    // x 恒在 [45,55]，距左右边最差 45 >= 40
    expect(r.robust.robustStable).toBe(true);
    // 但合计重量溢出 → releasable 仍为 false（数值无法可靠审核总量）
    expect(r.totalWeight).toBeNull();
    expect(r.releasable).toBe(false);
  });
});

describe('无重量范围：鲁棒退化为标称（旧数据兼容）', () => {
  it('全部确定重量时 hasUncertainWeights=false，最差距离逐边等于标称距离', () => {
    const list = items(
      { id: 'a', w: 30, x: 30, y: 60 },
      { id: 'b', w: 70, x: 70, y: 40 },
    );
    const r = analyzeStability(ws(square100, list, 8));
    expect(r.robust.hasUncertainWeights).toBe(false);
    for (const re of r.robust.edges) {
      const nominal = r.edges.find((e) => e.index === re.edgeIndex)!;
      expect(re.worstDistance).toBeCloseTo(nominal.signedDistance, 12);
      expect(re.holds).toBe(nominal.signedDistance >= 8);
    }
    expect(r.robust.robustStable).toBe(r.stable);
    expect(r.releasable).toBe(r.stable && r.warnings.length === 0);
  });

  it('旧 JSON（无 weightMin/weightMax）导入后区间即登记重量', () => {
    const r = parseWorkspace({
      polygon: square100.map((p) => [p.x, p.y]),
      margin: 0,
      items: [{ id: 'a', weight: 12, center: [50, 50] }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const iv = weightIntervals(r.workspace.items)[0];
      expect(iv).toEqual({ min: 12, max: 12, uncertain: false });
      const full = analyzeStability(r.workspace);
      expect(full.releasable).toBe(true);
    }
  });

  it('无范围编辑（旧表单形状）仍可解析，鲁棒同标称', () => {
    const r = resolveForm(square100, {
      margin: '0',
      items: [{ id: 'a', weight: '12', x: '50', y: '0' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.robust.hasUncertainWeights).toBe(false);
      expect(r.result.stable).toBe(true);
      expect(r.result.robust.robustStable).toBe(true);
    }
  });
});

describe('导入：非法范围整批拒绝', () => {
  const valid = {
    polygon: square100.map((p) => [p.x, p.y]),
    margin: 1,
    items: [{ id: 'a', weight: 10, weightMin: 5, weightMax: 20, center: [50, 50] }],
  };

  it('接受合法的完整区间、单边区间与无区间', () => {
    expect(parseWorkspace(valid).ok).toBe(true);
    expect(
      parseWorkspace({
        ...valid,
        items: [{ id: 'a', weight: 10, weightMin: 5, center: [50, 50] }],
      }).ok,
    ).toBe(true);
    expect(
      parseWorkspace({
        ...valid,
        items: [{ id: 'a', weight: 10, weightMax: 20, center: [50, 50] }],
      }).ok,
    ).toBe(true);
  });

  it('拒绝零/负/非有限的上下界', () => {
    for (const [key, val] of [
      ['weightMin', 0],
      ['weightMin', -3],
      ['weightMin', Number.NaN],
      ['weightMin', Number.POSITIVE_INFINITY],
      ['weightMin', '5'],
      ['weightMax', 0],
      ['weightMax', -1],
    ] as const) {
      const r = parseWorkspace({
        ...valid,
        items: [{ id: 'a', weight: 10, [key]: val, center: [50, 50] }],
      });
      expect(r.ok, `${key}=${String(val)} 应拒绝`).toBe(false);
    }
  });

  it('拒绝 min > max、登记重量落在区间外', () => {
    expect(
      parseWorkspace({
        ...valid,
        items: [{ id: 'a', weight: 10, weightMin: 20, weightMax: 30, center: [50, 50] }],
      }).ok,
    ).toBe(false);
    expect(
      parseWorkspace({
        ...valid,
        items: [{ id: 'a', weight: 10, weightMin: 11, weightMax: 30, center: [50, 50] }],
      }).ok,
    ).toBe(false);
    expect(
      parseWorkspace({
        ...valid,
        items: [{ id: 'a', weight: 10, weightMin: 1, weightMax: 9, center: [50, 50] }],
      }).ok,
    ).toBe(false);
    // 边界相等合法
    expect(
      parseWorkspace({
        ...valid,
        items: [{ id: 'a', weight: 10, weightMin: 10, weightMax: 10, center: [50, 50] }],
      }).ok,
    ).toBe(true);
  });

  it('拒绝未知范围字段（整批拒绝，保留未知字段策略一致性）', () => {
    expect(
      parseWorkspace({
        ...valid,
        items: [{ id: 'a', weight: 10, weightRange: [5, 20], center: [50, 50] }],
      }).ok,
    ).toBe(false);
  });

  it('任何一件范围非法都整批拒绝（不会部分导入）', () => {
    const r = parseWorkspace({
      ...valid,
      items: [
        { id: 'a', weight: 10, weightMin: 5, weightMax: 20, center: [50, 50] },
        { id: 'b', weight: 10, weightMin: -1, center: [30, 30] },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/weightMin/);
  });

  it('JSON 语法错误同样整批拒绝', () => {
    expect(parseWorkspaceJSON('{ weightMin: ').ok).toBe(false);
  });
});

describe('行内编辑：非法范围撤销结论，修正后图文同源于同一分析', () => {
  const base = {
    margin: '10',
    items: [
      { id: 'a', weight: '10', weightMin: '5', weightMax: '20', x: '50', y: '20' },
      { id: 'b', weight: '10', weightMin: '5', weightMax: '20', x: '50', y: '80' },
    ],
  };

  it('合法编辑：结论与独立枚举一致', () => {
    const r = resolveForm(square100, base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const intervals = weightIntervals(
        r.result.items.map((it) => ({ weight: it.weight, weightMin: it.weightMin, weightMax: it.weightMax })),
      );
      const oracle = bruteForce(square100, r.result.items, intervals);
      expect(r.result.robust.worstMinDistance).toBeCloseTo(oracle.worst, 10);
      expect(r.result.robust.robustStable).toBe(oracle.worst >= 10);
    }
  });

  it('下界为负/零、非数字、min>max、登记越界：ok=false 撤销全部结论', () => {
    const badEdits: Array<Record<string, string>> = [
      { weightMin: '-1' },
      { weightMin: '0' },
      { weightMin: 'abc' },
      { weightMax: '3' }, // max < min
      { weight: '30' }, // 登记重量超出 max 20
      { weightMin: '25' }, // min > 登记重量
    ];
    for (const patch of badEdits) {
      const form = {
        ...base,
        items: [{ ...base.items[0], ...patch }, { ...base.items[1] }],
      };
      const r = resolveForm(square100, form);
      expect(r.ok, JSON.stringify(patch)).toBe(false);
    }
  });

  it('撤销后无任何可放行结论；恢复合法输入后结论重新与枚举一致', () => {
    const bad = {
      ...base,
      items: [{ ...base.items[0], weightMax: '-2' }, { ...base.items[1] }],
    };
    expect(resolveForm(square100, bad).ok).toBe(false);
    const repaired = {
      ...base,
      items: [{ ...base.items[0], weightMax: '20' }, { ...base.items[1] }],
    };
    const r = resolveForm(square100, repaired);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 图（SVG 消费的字段）与数（面板消费的字段）来自同一结果：
      // 见证重心、失守边、worstMinDistance 必须自洽
      const { robust } = r.result;
      if (robust.failure) {
        const f = robust.failure;
        const a = square100[f.edgeIndex];
        const b = square100[(f.edgeIndex + 1) % square100.length];
        const d = signedDistanceToEdge(f.cog, a, b);
        expect(d).toBeCloseTo(f.distance, 10);
        expect(robust.edges[f.edgeIndex].holds).toBe(false);
      }
    }
  });

  it('清空可选范围字段即退回确定重量，鲁棒同标称', () => {
    const cleared = {
      ...base,
      items: base.items.map((it) => ({ ...it, weightMin: '', weightMax: '' })),
    };
    const r = resolveForm(square100, cleared);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.robust.hasUncertainWeights).toBe(false);
      expect(r.result.robust.robustStable).toBe(r.result.stable);
    }
  });
});
