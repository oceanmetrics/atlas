// A deliberately coarse world outline (about 80 points) for the catalog page's extent sketches: just
// enough that a bounding box reads as "the Atlantic" or "everywhere" at 120 px wide. Hand-simplified,
// lon/lat degrees; NOT survey data and never used for anything but this picture.
const LAND: readonly (readonly [number, number][])[] = [
  // North America
  [
    [-168, 66],
    [-141, 70],
    [-110, 72],
    [-82, 70],
    [-62, 60],
    [-55, 50],
    [-67, 44],
    [-76, 35],
    [-81, 25],
    [-97, 26],
    [-97, 18],
    [-87, 21],
    [-83, 10],
    [-78, 8],
    [-92, 14],
    [-105, 20],
    [-117, 32],
    [-124, 40],
    [-125, 49],
    [-140, 60],
  ],
  // South America
  [
    [-78, 8],
    [-60, 10],
    [-50, 0],
    [-35, -6],
    [-40, -22],
    [-58, -38],
    [-66, -55],
    [-74, -50],
    [-71, -30],
    [-81, -5],
  ],
  // Europe and Asia
  [
    [-10, 36],
    [-9, 43],
    [0, 50],
    [8, 58],
    [20, 70],
    [40, 68],
    [70, 73],
    [110, 77],
    [140, 72],
    [180, 68],
    [170, 60],
    [140, 52],
    [130, 40],
    [122, 30],
    [110, 20],
    [105, 10],
    [98, 15],
    [90, 22],
    [78, 8],
    [72, 20],
    [58, 25],
    [48, 30],
    [35, 36],
    [27, 36],
    [12, 38],
  ],
  // Africa
  [
    [-17, 21],
    [-5, 36],
    [10, 37],
    [32, 31],
    [43, 12],
    [51, 12],
    [40, -15],
    [33, -27],
    [20, -35],
    [12, -17],
    [8, 4],
    [-8, 4],
    [-17, 14],
  ],
  // Australia
  [
    [114, -22],
    [130, -12],
    [142, -11],
    [153, -27],
    [146, -39],
    [135, -35],
    [115, -34],
  ],
  // Greenland
  [
    [-55, 60],
    [-20, 70],
    [-20, 82],
    [-60, 82],
    [-73, 78],
  ],
  // Antarctica
  [
    [-180, -70],
    [180, -70],
    [180, -90],
    [-180, -90],
  ],
];

function pt(lon: number, lat: number): string {
  return `${round1(lon + 180)} ${round1(90 - lat)}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** the outline as one SVG path in a 360 x 180 viewBox (x = lon + 180, y = 90 - lat). */
export const WORLD_PATH: string = LAND.map(
  (ring) => `M${ring.map(([lon, lat]) => pt(lon, lat)).join("L")}Z`,
).join("");
