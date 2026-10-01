export const SAMPLE_INPUT = JSON.stringify(
  {
    polygon: [
      [0, 0],
      [4200, 0],
      [4200, 1400],
      [3200, 2200],
      [900, 2200],
      [0, 1500],
    ],
    margin: 150,
    items: [
      // 散装货称重存在误差：weightMin/weightMax 为可选的允许重量范围
      // （省略即沿用确定重量；登记重量 weight 必须落在范围内）
      { id: 'A-箱', weight: 120, weightMin: 108, weightMax: 132, center: [1200, 800] },
      { id: 'B-桶', weight: 210, weightMin: 189, weightMax: 231, center: [2400, 1100] },
      { id: 'C-架', weight: 165, weightMax: 182, center: [2900, 1650] },
      { id: 'D-盘', weight: 90, weightMin: 81, center: [1600, 1700] },
      { id: 'E-件', weight: 55, center: [700, 1200] },
    ],
  },
  null,
  2,
);
