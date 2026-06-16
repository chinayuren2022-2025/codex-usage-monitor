// Empirically anchored quota calibration.
//
// BASIS (measured 2026-06-11, clean single-user Plus account):
//   The rate-limit meter (rate_limits.*.used_percent) counts TOTAL tokens (input+
//   output, INCLUDING cached), NOT billable. Billable = cost; total = quota.
//   Calibrate k = cumulative-average (machineTotal / used%), which reproduces the
//   meter as ground truth. Plus: 5h ~172K/1% (pool 17.2M), weekly ~1.16M/1%
//   (pool 115.6M). Cross-check 1.16M/172K = 6.7 ~ cross-window ratio 6.4.
//
// OTHER TIERS — plan structure from the user (2026-06-11):
//   weekly pool: pro = 20x Plus, prolite = 5x Plus.
//   5h pool is NOT the same multiple. Measured for pro via the contamination-proof
//   RATIO method (k_5h = k_weekly_known x Δweekly%/Δ5h%, immune to teammate usage
//   because both windows count the same tokens): pro 5h pool ~= 770M (~45x Plus 5h,
//   i.e. Pro's 5h window is proportionally far more generous than Plus's).
//
// CROSS-VALIDATED 2026-06-16 from a second pro machine (hunmi/budezePC, 13,699 rate
// events, 179 usable 5h-window segments):
//   Per-segment ratio method, weighted by dp5: k_5h = 7.70M/% (identical to original).
//   Overall ratio (unweighted): k_5h = 8.42M/%. Agreement within 10%, so the true
//   value is likely in [7.7M, 8.4M]/%. Source upgraded from "rough" to "validated".
//
// per-window `source`: measured | derived | rough | validated.
//
// LIMITATIONS (surface in UI): exact only near the calibrated used% (meter is mildly
// nonlinear); one model/regime ("codex"); pro is a carpool account so its own meter
// reflects everyone, but THIS machine's token share is still computed from local logs.

const w = (tokensPerPercent, source) => ({ tokensPerPercent, poolTokens: tokensPerPercent * 100, source });

const PLUS_5H = 172_000;
const PLUS_WK = 1_156_000;

export const CALIBRATION = {
  anchoredAt: "2026-06-11",
  crossValidatedAt: "2026-06-16",
  regime: "codex",
  basis: "total",
  rate: "cumulative-average",
  baselineTier: "plus",
  tiers: {
    plus: {
      source: "measured",
      windows: { fiveHour: w(PLUS_5H, "measured"), weekly: w(PLUS_WK, "measured") },
    },
    prolite: {
      source: "derived",
      windows: { fiveHour: w(PLUS_5H * 5, "derived"), weekly: w(PLUS_WK * 5, "derived") },
    },
    pro: {
      // weekly = 20x Plus (user-confirmed); 5h validated via ratio method on two
      // independent pro machines. Range: 7.7M–8.4M/%; central value 7.7M/%.
      source: "validated",
      windows: { fiveHour: w(7_700_000, "validated"), weekly: w(PLUS_WK * 20, "derived") },
    },
  },
};
