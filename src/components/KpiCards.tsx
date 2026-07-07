"use client";

import type { ForecastResult } from "@engine/index.js";
import { fmtMoney, fmtMoneyShort, fmtMonths } from "@/lib/format.js";

export function KpiCards({ result }: { result: ForecastResult }) {
  const final = result.periods[result.periods.length - 1];
  const excess = final ? final.reserveExcess : result.reserveExcess;

  return (
    <div className="grid kpi-row">
      <Kpi
        label="Operating cash"
        value={fmtMoney(result.startingCash)}
        hint={`${fmtMoneyShort(result.totalBankBalance)} across all accounts`}
      />
      <Kpi
        label="Runway"
        value={fmtMonths(result.runwayMonths)}
        tone={runwayTone(result.runwayMonths, result.settings.runwayAlertMonths)}
        hint={result.runwayMonths === null ? "cash stays positive" : "until cash hits $0"}
      />
      <Kpi
        label="Monthly burn"
        value={fmtMoneyShort(result.monthlyBurn)}
        hint={
          result.settings.monthlyBurnOverride !== undefined
            ? `manual · computed ${fmtMoneyShort(result.monthlyBurnComputed)}`
            : "computed from projection"
        }
      />
      <Kpi
        label="Reserve target"
        value={fmtMoneyShort(result.reserveTarget)}
        hint={`${result.settings.reserveMultiple}× burn`}
      />
      <Kpi
        label="Cash vs reserve"
        value={fmtMoney(excess)}
        tone={excess >= 0 ? "pos" : "neg"}
        hint={excess >= 0 ? "excess at horizon end" : "shortfall at horizon end"}
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className={`value mono ${tone ?? ""}`}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function runwayTone(months: number | null, alert: number): "pos" | "neg" | undefined {
  if (months === null) return "pos";
  if (months < alert) return "neg";
  return undefined;
}
