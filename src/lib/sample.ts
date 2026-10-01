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
      { id: 'A-箱', weight: 120, center: [1200, 800] },
      { id: 'B-桶', weight: 210, center: [2400, 1100] },
      { id: 'C-架', weight: 165, center: [2900, 1650] },
      { id: 'D-盘', weight: 90, center: [1600, 1700] },
      { id: 'E-件', weight: 55, center: [700, 1200] },
    ],
  },
  null,
  2,
);
