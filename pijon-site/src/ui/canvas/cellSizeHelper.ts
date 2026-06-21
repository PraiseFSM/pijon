/**
 * §14.6 — Cell-size helpers for render density.
 *
 * Pure math helpers — no DOM, no React, no imports.
 * Exported so they can be unit-tested without any browser environment.
 *
 * Design
 * ------
 * `baseUnitPx` is the number of CSS pixels that represent ONE physical unit
 * (the "unit" defined by the teacher's layout, regardless of granularity).
 *
 * When `cellsPerUnit = G`, each fine grid cell is `baseUnitPx / G` pixels wide,
 * so a 1-unit desk at G=2 spans 2 fine cells × (baseUnitPx/2) px/cell = baseUnitPx px.
 * The board's physical pixel size is therefore:
 *
 *   (gridW_in_cells * effectiveCellSize)
 *   = (gridW_units * G) * (baseUnitPx / G)
 *   = gridW_units * baseUnitPx   ← constant across granularity changes
 */

/**
 * Derive the effective CSS pixels per fine grid cell.
 *
 * @param baseUnitPx  - CSS pixels for one physical unit (e.g. 48).
 * @param cellsPerUnit - Grid granularity (G): how many fine cells equal one unit.
 * @returns effectiveCellSize = baseUnitPx / cellsPerUnit.
 */
export function effectiveCellSize(baseUnitPx: number, cellsPerUnit: number): number {
  return baseUnitPx / cellsPerUnit;
}

/**
 * Total board width in CSS pixels.
 *
 * @param gridW       - Number of fine grid columns (already scaled by G).
 * @param baseUnitPx  - CSS pixels for one physical unit.
 * @param cellsPerUnit - Grid granularity G.
 * @returns gridW * effectiveCellSize(baseUnitPx, cellsPerUnit)
 */
export function boardWidthPx(gridW: number, baseUnitPx: number, cellsPerUnit: number): number {
  return gridW * effectiveCellSize(baseUnitPx, cellsPerUnit);
}
