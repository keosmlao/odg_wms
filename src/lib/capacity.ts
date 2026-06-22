/** Exact pallet-space usage for stock that can share a location/pallet position. */
export function calculatePalletUsage(qty: number, unitsPerPallet: number) {
  if (!(qty > 0) || !(unitsPerPallet > 0)) return 0;
  return qty / unitsPerPallet;
}

/** Full pallet positions required for inbound/outbound logistics planning. */
export function estimatePalletPositions(qty: number, unitsPerPallet: number) {
  const usage = calculatePalletUsage(qty, unitsPerPallet);
  return usage > 0 ? Math.ceil(usage) : 0;
}
