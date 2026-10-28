import React from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

export function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  className,
}: SearchInputProps) {
  return (
    <div
      className={cn(
        "flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-secondary/70 px-3 text-muted transition focus-within:border-lime/30",
        className
      )}
    >
      <Search size={15} />

      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-xs text-text placeholder:text-muted focus:outline-none"
      />
    </div>
  );
}
