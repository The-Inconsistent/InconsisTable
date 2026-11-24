"use client";
import { useState, type ChangeEvent } from "react";

type IntInputProps = {
  id: string;
  label: string;
  min?: number;
  max?: number;
  value: number | null;
  disabled: boolean;
  onValue: (value: number | null) => void;
};

// A whole number typed by hand: the text is kept as typed ("-" on the way to "-2"), a whole number is reported, and an
// empty box clears the field.
export function IntInput({ id, label, min, max, value, disabled, onValue }: IntInputProps) {
  const [text, setText] = useState(value === null ? "" : String(value));
  // Keeps the text; reports the number once it is a whole one, or null once the box is empty.
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
    const n = Number(e.target.value);
    if (e.target.value.trim() === "") onValue(null);
    else if (Number.isInteger(n)) onValue(n);
  };
  return (
    <label className="stack">
      {label}
      <input
        id={id}
        type="number"
        inputMode="numeric"
        step={1}
        min={min}
        max={max}
        value={text}
        onChange={handleChange}
        disabled={disabled}
      />
    </label>
  );
}
