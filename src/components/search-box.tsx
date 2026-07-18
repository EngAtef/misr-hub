"use client";

import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared search input with a clear (X) button.
 * `onCommit` fires on Enter/submit and when the X is pressed (with ""),
 * so pages that only apply the search on submit reset their results too.
 */
export function SearchBox({
  value,
  onChange,
  onCommit,
  placeholder,
  className,
  active = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit?: (v: string) => void;
  placeholder?: string;
  className?: string;
  /** true when a committed search is applied even if the input box is empty */
  active?: boolean;
}) {
  return (
    <form
      className={cn("relative", className)}
      onSubmit={(e) => {
        e.preventDefault();
        onCommit?.(value.trim());
      }}
    >
      <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        className="input ps-9 pe-9"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {(value || active) && (
        <button
          type="button"
          aria-label="clear search"
          className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          onClick={() => {
            onChange("");
            onCommit?.("");
          }}
        >
          <X size={14} />
        </button>
      )}
    </form>
  );
}
