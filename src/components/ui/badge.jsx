export function Badge({ className = "", variant = "default", ...props }) {
  const variants = {
    default: "bg-slate-900 text-white",
    secondary: "bg-slate-100 text-slate-900",
    outline: "border border-slate-200 text-slate-700",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs leading-5 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
