import type { Point, StabilityResult } from '../lib/types';
import { fmt } from '../lib/form';

const VIEW_W = 820;
const VIEW_H = 620;
const PAD = 70;

interface Props {
  result: StabilityResult;
}

/**
 * 俯视图。所有图元（支撑区、安全余量区、货物、合成重心、危险边及其垂线）
 * 均取自同一个 StabilityResult——图与数永远对同一次判断负责。
 */
export default function PlanView({ result }: Props) {
  const {
    polygon,
    safeRegion,
    edges,
    criticalEdge,
    cog,
    stable,
    releasable,
    warnings,
    margin,
    items,
    robust,
  } = result;
  const marginUnresolvable = warnings.some(
    (w) => w.code === 'margin-below-resolution',
  );
  const failure = robust.failure;
  // 失败见证边（与标称最危险边可能不是同一条），取自同一分析结果
  const witnessEdge = failure ? edges[failure.edgeIndex] : null;

  // 统一包围盒：支撑多边形、标称重心、失败见证重心
  const points: Point[] = [...polygon, cog];
  const maxWeight = Math.max(...items.map((i) => i.weight));
  if (failure) points.push(failure.cog);
  // safeRegion 为空（余量过大导致塌缩）时不参与包围盒
  if (safeRegion.length >= 3) points.push(...safeRegion);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  // 货物中心也纳入包围盒
  for (const it of items) {
    minX = Math.min(minX, it.center.x);
    minY = Math.min(minY, it.center.y);
    maxX = Math.max(maxX, it.center.x);
    maxY = Math.max(maxY, it.center.y);
  }

  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  const scale = Math.min((VIEW_W - 2 * PAD) / spanX, (VIEW_H - 2 * PAD) / spanY);

  // 世界坐标 → SVG 坐标（y 轴翻转，居中）
  const usedW = spanX * scale;
  const usedH = spanY * scale;
  const ox = (VIEW_W - usedW) / 2;
  const oy = (VIEW_H - usedH) / 2;
  const sx = (x: number) => ox + (x - minX) * scale;
  const sy = (y: number) => VIEW_H - (oy + (y - minY) * scale);

  const polyPoints = polygon.map((p) => `${fmt(sx(p.x), 3)},${fmt(sy(p.y), 3)}`).join(' ');
  const safePoints = safeRegion
    .map((p) => `${fmt(sx(p.x), 3)},${fmt(sy(p.y), 3)}`)
    .join(' ');

  // 重心到危险边的垂足
  const dx = criticalEdge.b.x - criticalEdge.a.x;
  const dy = criticalEdge.b.y - criticalEdge.a.y;
  const t =
    ((cog.x - criticalEdge.a.x) * dx + (cog.y - criticalEdge.a.y) * dy) /
    (dx * dx + dy * dy);
  const foot: Point = {
    x: criticalEdge.a.x + t * dx,
    y: criticalEdge.a.y + t * dy,
  };

  // 放行状态决定图形着色：可放行=绿；不稳定=红；稳定但存在不可表达量=琥珀（暂缓放行）
  const supportStroke = !stable ? '#dc2626' : releasable ? '#16a34a' : '#d97706';
  const supportFill = !stable
    ? 'rgba(239,68,68,0.10)'
    : releasable
      ? 'rgba(34,197,94,0.12)'
      : 'rgba(217,119,6,0.12)';

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="planview"
      role="img"
      aria-label="支撑区与合成重心俯视图"
    >
      <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="#0f172a" rx={10} />

      {/*
        安全余量内缩区域。
        只有能与原支撑边可靠区分的内缩才会绘制：
        margin=0 时本就没有安全区，也不画，绝不把原边冒充成“内缩安全区”；
        余量低于分辨极限时 safeRegion 为空，并在图面下方显式告警。
      */}
      {margin > 0 && safeRegion.length >= 3 && (
        <polygon
          points={safePoints}
          fill="rgba(59,130,246,0.14)"
          stroke="#3b82f6"
          strokeWidth={1.5}
          strokeDasharray="7 5"
        />
      )}
      {margin > 0 && safeRegion.length < 3 && (
        <g className="safe-missing-note">
          <text x={VIEW_W / 2} y={34} textAnchor="middle" fontSize={14} fill="#fbbf24">
            {marginUnresolvable
              ? `余量 ${margin} 低于当前坐标尺度的图形分辨极限：无可绘制的内缩安全区（见数值面板告警）`
              : 'margin 内缩安全区已塌缩为空'}
          </text>
        </g>
      )}

      {/* 支撑多边形 */}
      <polygon
        points={polyPoints}
        fill={supportFill}
        stroke={supportStroke}
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* 普通边 */}
      {edges.map((e) => {
        const isCritical = e.index === criticalEdge.index;
        return (
          <line
            key={`edge-${e.index}`}
            x1={sx(e.a.x)}
            y1={sy(e.a.y)}
            x2={sx(e.b.x)}
            y2={sy(e.b.y)}
            stroke={isCritical ? '#ef4444' : '#64748b'}
            strokeWidth={isCritical ? 4.5 : 1.5}
          />
        );
      })}

      {/* 支撑顶点 */}
      {polygon.map((p, i) => (
        <circle key={`v-${i}`} cx={sx(p.x)} cy={sy(p.y)} r={3.5} fill="#cbd5e1" />
      ))}

      {/* 重心到危险边的垂线（实际余量） */}
      <line
        x1={sx(cog.x)}
        y1={sy(cog.y)}
        x2={sx(foot.x)}
        y2={sy(foot.y)}
        stroke="#f87171"
        strokeWidth={1.8}
        strokeDasharray="5 4"
      />
      <circle cx={sx(foot.x)} cy={sy(foot.y)} r={3} fill="#f87171" />

      {/* 货物 */}
      {items.map((it) => {
        const r = 5 + 11 * Math.sqrt(it.weight / maxWeight);
        return (
          <g key={it.id}>
            <circle
              cx={sx(it.center.x)}
              cy={sy(it.center.y)}
              r={r}
              fill="rgba(245,158,11,0.35)"
              stroke="#f59e0b"
              strokeWidth={1.5}
            />
            <text
              x={sx(it.center.x)}
              y={sy(it.center.y) - r - 3}
              textAnchor="middle"
              fontSize={12}
              fill="#fbbf24"
            >
              {it.id}
            </text>
          </g>
        );
      })}

      {/*
        鲁棒失败见证：一组可复算的极端重量组合。
        失守边用橙色粗边（与标称最危险边的红色相区分），
        见证重心用橙色实心三角 + 虚线垂线（与青色标称十字相区分）。
      */}
      {failure && witnessEdge && (
        <g>
          <line
            x1={sx(witnessEdge.a.x)}
            y1={sy(witnessEdge.a.y)}
            x2={sx(witnessEdge.b.x)}
            y2={sy(witnessEdge.b.y)}
            stroke="#f97316"
            strokeWidth={5}
            strokeLinecap="round"
          />
          {(() => {
            const wdx = witnessEdge.b.x - witnessEdge.a.x;
            const wdy = witnessEdge.b.y - witnessEdge.a.y;
            const wt =
              ((failure.cog.x - witnessEdge.a.x) * wdx +
                (failure.cog.y - witnessEdge.a.y) * wdy) /
              (wdx * wdx + wdy * wdy);
            const wfoot: Point = {
              x: witnessEdge.a.x + wt * wdx,
              y: witnessEdge.a.y + wt * wdy,
            };
            const tx = sx(failure.cog.x);
            const ty = sy(failure.cog.y);
            return (
              <g>
                <line
                  x1={tx}
                  y1={ty}
                  x2={sx(wfoot.x)}
                  y2={sy(wfoot.y)}
                  stroke="#fb923c"
                  strokeWidth={1.8}
                  strokeDasharray="6 4"
                />
                <circle cx={sx(wfoot.x)} cy={sy(wfoot.y)} r={3} fill="#fb923c" />
                <polygon
                  points={`${tx},${ty - 9} ${tx - 8},${ty + 6} ${tx + 8},${ty + 6}`}
                  fill="#f97316"
                  stroke="#fed7aa"
                  strokeWidth={1.5}
                />
                <text
                  x={tx + 12}
                  y={ty + 16}
                  fontSize={13}
                  fontWeight={700}
                  fill="#fdba74"
                >
                  失败见证重心
                </text>
              </g>
            );
          })()}
        </g>
      )}

      {/* 合成重心（标称登记重量） */}
      <g>
        <circle cx={sx(cog.x)} cy={sy(cog.y)} r={9} fill="none" stroke="#22d3ee" strokeWidth={2} />
        <line
          x1={sx(cog.x) - 13}
          y1={sy(cog.y)}
          x2={sx(cog.x) + 13}
          y2={sy(cog.y)}
          stroke="#22d3ee"
          strokeWidth={2.5}
        />
        <line
          x1={sx(cog.x)}
          y1={sy(cog.y) - 13}
          x2={sx(cog.x)}
          y2={sy(cog.y) + 13}
          stroke="#22d3ee"
          strokeWidth={2.5}
        />
        <text
          x={sx(cog.x) + 14}
          y={sy(cog.y) - 12}
          fontSize={14}
          fontWeight={700}
          fill="#67e8f9"
        >
          重心
        </text>
      </g>

      {/* 无法可靠表达的量在图面底部同样显式反馈，图与数一致 */}
      {warnings.length > 0 && (
        <g>
          {warnings.map((w, i) => (
            <text
              key={w.code}
              x={VIEW_W / 2}
              y={VIEW_H - 26 - (failure ? 18 : 0) + i * 18}
              textAnchor="middle"
              fontSize={13}
              fontWeight={600}
              fill="#fbbf24"
            >
              ⚠ {w.code === 'total-weight-overflow' ? '合计重量溢出缺失：不可作为正常载荷放行' : w.message}
            </text>
          ))}
        </g>
      )}

      {/* 鲁棒失败与数值面板同一结论：橙色三角为可复算极端组合的见证重心 */}
      {failure && (
        <text
          x={VIEW_W / 2}
          y={VIEW_H - 8}
          textAnchor="middle"
          fontSize={13}
          fontWeight={700}
          fill="#fb923c"
        >
          ⚠ 鲁棒不放行：存在允许重量组合使边 #{failure.edgeIndex} 失守（橙色三角为见证重心，
          极端重量见数值面板）
        </text>
      )}
    </svg>
  );
}
