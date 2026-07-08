"use client";

import type { InputHTMLAttributes } from "react";

/**
 * A number input with a leading "$". Numbers can't carry a currency symbol or
 * thousands separators inside a native number field, so this gives at least the
 * "$" affordance while editing; the formatted read view (with commas) shows the
 * value once editing is done.
 */
export function MoneyInput({
  value,
  onChange,
  ...rest
}: {
  value: number;
  onChange: (n: number) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  return (
    <div className="money-input">
      <span className="prefix">$</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        {...rest}
      />
    </div>
  );
}
