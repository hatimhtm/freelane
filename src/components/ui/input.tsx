import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, inputMode, onChange, onKeyDown, ...props }: React.ComponentProps<"input">) {
  // Numpad-comma support: when the input takes decimal numbers, convert "," to
  // "." at the keypress so the user's controlled state always sees a parsable
  // string. Native <input type="number"> ignores commas entirely; rewriting at
  // keydown is the cheapest way to make the numpad's comma key work the same
  // as the dot key without forcing every amount field to switch to text/inputMode.
  const isDecimal = type === "number" || inputMode === "decimal";

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (isDecimal && (e.key === "," || (e.code === "NumpadDecimal" && e.key !== "."))) {
      e.preventDefault();
      const input = e.currentTarget;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      const next = `${input.value.slice(0, start)}.${input.value.slice(end)}`;
      // Use the native setter so React picks up the change on the next input event.
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(input, next);
      input.setSelectionRange(start + 1, start + 1);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    onKeyDown?.(e);
  }

  return (
    <InputPrimitive
      type={type}
      inputMode={inputMode}
      onKeyDown={handleKeyDown}
      onChange={onChange}
      data-slot="input"
      className={cn(
        "h-8 max-md:h-10 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
