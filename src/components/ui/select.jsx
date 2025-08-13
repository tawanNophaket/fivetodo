import * as RadixSelect from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";

export const Select = RadixSelect.Root;
export const SelectTrigger = ({ className = "", children, ...props }) => (
  <RadixSelect.Trigger
    className={`inline-flex h-9 w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm ${className}`}
    {...props}
  >
    <RadixSelect.Value />
    {children ?? (
      <RadixSelect.Icon className="ml-2 opacity-50">
        <ChevronDown className="h-4 w-4" />
      </RadixSelect.Icon>
    )}
  </RadixSelect.Trigger>
);
export const SelectValue = RadixSelect.Value;
export const SelectContent = ({ children }) => (
  <RadixSelect.Portal>
    <RadixSelect.Content className="z-50 overflow-hidden rounded-md border bg-white shadow-md">
      <RadixSelect.Viewport className="p-1">{children}</RadixSelect.Viewport>
    </RadixSelect.Content>
  </RadixSelect.Portal>
);
export const SelectItem = ({ value, children }) => (
  <RadixSelect.Item
    value={value}
    className="cursor-pointer select-none rounded px-2 py-1.5 text-sm outline-none hover:bg-slate-100"
  >
    <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
  </RadixSelect.Item>
);
