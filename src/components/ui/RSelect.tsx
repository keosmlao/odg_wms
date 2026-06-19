"use client";

import Select from "react-select";

export type ROption = { value: string; label: string; sub?: string };

/**
 * Thin react-select wrapper: searchable, Tailwind-styled (light/dark), and
 * portal-rendered so the menu is never clipped by a scrolling table. Options
 * carry a human label (a NAME, not a code) plus an optional sub-line.
 */
export default function RSelect({
  value,
  options,
  onChange,
  placeholder = "— ເລືອກ —",
  isDisabled,
  size = "md",
}: {
  value: string;
  options: ROption[];
  onChange: (value: string) => void;
  placeholder?: string;
  isDisabled?: boolean;
  size?: "sm" | "md";
}) {
  const selected = options.find((o) => o.value === value) ?? null;
  const sm = size === "sm";
  const ctrl = sm
    ? "min-h-[28px] rounded-md bg-white text-xs ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800"
    : "min-h-[38px] rounded-lg bg-white text-sm ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800";
  return (
    <Select<ROption>
      unstyled
      isClearable
      isDisabled={isDisabled}
      value={selected}
      options={options}
      onChange={(o) => onChange(o?.value ?? "")}
      placeholder={placeholder}
      noOptionsMessage={() => "ບໍ່ພົບ"}
      menuPortalTarget={typeof document !== "undefined" ? document.body : null}
      menuPlacement="auto"
      formatOptionLabel={(o) => (
        <div className="leading-tight">
          <div className={`truncate ${sm ? "text-xs" : "text-sm"}`}>{o.label}</div>
          {o.sub && <div className="truncate text-[9px] text-zinc-400">{o.sub}</div>}
        </div>
      )}
      classNames={{
        control: ({ isFocused }) =>
          `${ctrl} ${sm ? "px-0.5" : "px-1"} transition ${isFocused ? "ring-2 ring-emerald-500" : ""} ${isDisabled ? "opacity-50" : ""}`,
        valueContainer: () => (sm ? "gap-0.5 px-1.5 py-0.5" : "gap-1 px-2 py-1"),
        placeholder: () => "text-zinc-400",
        singleValue: () => "text-zinc-900 dark:text-zinc-100",
        input: () => "text-zinc-900 dark:text-zinc-100",
        indicatorSeparator: () => "hidden",
        dropdownIndicator: () => `${sm ? "px-0.5" : "px-1"} text-zinc-400`,
        clearIndicator: () => `${sm ? "px-0.5" : "px-1"} text-zinc-400 hover:text-rose-500`,
        menuPortal: () => "z-[9999]",
        menu: () =>
          "mt-1 overflow-hidden rounded-lg bg-white text-sm shadow-xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800",
        menuList: () => "max-h-56 overflow-auto py-0.5",
        option: ({ isFocused, isSelected }) =>
          `cursor-pointer px-2.5 py-1 ${
            isSelected
              ? "bg-emerald-500 text-white"
              : isFocused
                ? "bg-emerald-50 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                : "text-zinc-700 dark:text-zinc-200"
          }`,
        noOptionsMessage: () => "px-2.5 py-1.5 text-xs text-zinc-400",
      }}
    />
  );
}
