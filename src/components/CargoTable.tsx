import type { FormState, ItemDraft } from '../lib/form';

interface Props {
  form: FormState;
  onChange: (next: FormState) => void;
}

/**
 * 货物编辑表。输入即修改：每次按键都会更新表单，
 * 由父组件立即重新解析；非法输入时旧结论被撤销（见 App 中的 resolveForm）。
 */
export default function CargoTable({ form, onChange }: Props) {
  const updateItem = (i: number, patch: Partial<ItemDraft>) => {
    const items = form.items.map((it, j) => (j === i ? { ...it, ...patch } : it));
    onChange({ ...form, items });
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>货物明细（{form.items.length} 件）</h2>
        <label className="margin-edit">
          安全余量 margin
          <input
            type="number"
            min={0}
            step="any"
            value={form.margin}
            onChange={(e) => onChange({ ...form, margin: e.target.value })}
          />
        </label>
      </div>
      <div className="table-wrap">
        <table className="cargo-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>重量 weight</th>
              <th>中心 X</th>
              <th>中心 Y</th>
            </tr>
          </thead>
          <tbody>
            {form.items.map((it, i) => (
              <tr key={it.id}>
                <td className="id-cell">{it.id}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={it.weight}
                    aria-label={`${it.id} 重量`}
                    onChange={(e) => updateItem(i, { weight: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="any"
                    value={it.x}
                    aria-label={`${it.id} 中心 X`}
                    onChange={(e) => updateItem(i, { x: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="any"
                    value={it.y}
                    aria-label={`${it.id} 中心 Y`}
                    onChange={(e) => updateItem(i, { y: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
