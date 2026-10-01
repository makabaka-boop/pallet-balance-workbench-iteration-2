import type { StabilityResult } from '../lib/types';
import { fmt, fmtPair } from '../lib/form';

interface Props {
  result: StabilityResult;
}

/**
 * 数值结论面板。全部数值直接来自传入的 StabilityResult，
 * 与 SVG 使用同一计算结果；边界判断使用未舍入值，
 * 展示值附带 title 提供原始精度。
 * 直接互相比较的指标成对格式化，保证舍入后仍可区分（不会出现“0 ＜ 0”）；
 * 无法可靠表达的量（合计重量溢出、余量低于分辨极限）显式列出并阻止放行。
 */
export default function ResultPanel({ result }: Props) {
  const {
    stable,
    releasable,
    warnings,
    cog,
    totalWeight,
    minDistance,
    margin,
    shortfall,
    criticalEdge,
    edges,
  } = result;

  // 实际余量 / 要求余量成对展示
  const [distText, marginText] = fmtPair(minDistance, margin);
  const surplus = minDistance - margin;
  // 富余/短缺与 0 成对展示，保证极小非零量不会被显示成 0
  const [surplusOrShortText] = fmtPair(stable ? surplus : shortfall, 0);
  const marginDisplay = marginText;

  const verdictClass = !stable ? 'unstable' : releasable ? 'stable' : 'blocked';
  const verdictText = !stable ? 'UNSTABLE' : releasable ? 'STABLE' : '暂缓放行';

  return (
    <section className={`panel verdict ${verdictClass}`}>
      <div className="verdict-badge">{verdictText}</div>

      {warnings.length > 0 && (
        <div className="warn-box" role="alert">
          <strong>存在无法可靠表达的量，禁止据此放行：</strong>
          <ul>
            {warnings.map((w) => (
              <li key={w.code} data-code={w.code}>
                {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <dl className="metric-grid">
        <div>
          <dt>合成重心 X</dt>
          <dd title={String(cog.x)}>{fmt(cog.x)}</dd>
        </div>
        <div>
          <dt>合成重心 Y</dt>
          <dd title={String(cog.y)}>{fmt(cog.y)}</dd>
        </div>
        <div>
          <dt>总重量</dt>
          {totalWeight === null ? (
            <dd className="warn-val" title="合计重量超出数值可表达范围（缺失值）">
              缺失（溢出，不可审核）
            </dd>
          ) : (
            <dd title={String(totalWeight)}>{fmt(totalWeight)}</dd>
          )}
        </div>
        <div>
          <dt>最小有符号距离（实际余量）</dt>
          <dd className={stable ? 'pos' : 'neg'} title={String(minDistance)}>
            {distText}
          </dd>
        </div>
        <div>
          <dt>要求安全余量 margin</dt>
          <dd title={String(margin)}>{marginDisplay}</dd>
        </div>
        <div>
          <dt>{stable ? '富余' : '短缺量'}</dt>
          <dd className={stable ? 'pos' : 'neg'} title={String(stable ? surplus : shortfall)}>
            {surplusOrShortText}
          </dd>
        </div>
      </dl>

      {!stable && (
        <div className="danger-box">
          <strong>最危险边：</strong>
          边 #{criticalEdge.index}（
          {`(${fmt(criticalEdge.a.x)}, ${fmt(criticalEdge.a.y)}) → (${fmt(
            criticalEdge.b.x,
          )}, ${fmt(criticalEdge.b.y)})`}
          ）
          <div className="danger-line">
            实际余量 {distText} ＜ margin {marginDisplay}，短缺 {surplusOrShortText}
          </div>
          <div className="danger-note">
            距离为{minDistance < 0 ? '负，重心已越出该支撑边' : '正但不足 margin'}，
            叉运前必须重新配载。
          </div>
        </div>
      )}

      <details className="edge-details">
        <summary>各支撑边有符号距离（未舍入判断，展示保留 6 位小数）</summary>
        <table className="edge-table">
          <thead>
            <tr>
              <th>边</th>
              <th>起点</th>
              <th>终点</th>
              <th>有符号距离</th>
            </tr>
          </thead>
          <tbody>
            {edges.map((e) => (
              <tr
                key={e.index}
                className={e.index === criticalEdge.index ? 'critical' : ''}
              >
                <td>#{e.index}</td>
                <td>
                  ({fmt(e.a.x)}, {fmt(e.a.y)})
                </td>
                <td>
                  ({fmt(e.b.x)}, {fmt(e.b.y)})
                </td>
                <td title={String(e.signedDistance)}>{fmt(e.signedDistance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
