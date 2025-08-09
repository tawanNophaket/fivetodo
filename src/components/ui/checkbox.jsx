export function Checkbox({ className = "", checked, onCheckedChange }) {
  return (
    <input
      type="checkbox"
      className={`h-4 w-4 rounded border-slate-300 ${className}`}
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
    />
  );
}
