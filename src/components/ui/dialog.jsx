import * as RadixDialog from "@radix-ui/react-dialog";

export function Dialog({ open, onOpenChange, children }) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </RadixDialog.Root>
  );
}

export function DialogContent({ className = "", children }) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
      <RadixDialog.Content
        className={`fixed left-1/2 top-1/2 z-50 w-[95vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-0 shadow-xl dark:border-slate-700 dark:bg-slate-900 ${className}`}
      >
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

export function DialogHeader({ className = "", children }) {
  return (
    <div
      className={`p-4 border-b border-slate-200 dark:border-slate-700 ${className}`}
    >
      {children}
    </div>
  );
}
export function DialogTitle({ children }) {
  return (
    <RadixDialog.Title className="text-lg font-semibold">
      {children}
    </RadixDialog.Title>
  );
}
export function DialogFooter({ className = "", children }) {
  return (
    <div
      className={`p-4 border-t border-slate-200 dark:border-slate-700 ${className}`}
    >
      {children}
    </div>
  );
}
export const DialogClose = RadixDialog.Close;
