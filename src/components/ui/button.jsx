const variants = {
  default: "bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-900/90",
  secondary:
    "bg-white text-slate-900 border border-slate-200 hover:bg-slate-50 active:bg-slate-100",
  ghost: "bg-transparent hover:bg-slate-100 active:bg-slate-200",
};
const sizes = {
  sm: "h-8 px-3 text-sm",
  md: "h-9 px-4",
  lg: "h-10 px-6",
  icon: "h-9 w-9 p-0",
};

export function Button({
  className = "",
  variant = "default",
  size = "md",
  ...props
}) {
  const base =
    "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-300 disabled:pointer-events-none disabled:opacity-50";
  return (
    <button
      className={`${base} ${variants[variant]} ${
        sizes[size] || sizes.md
      } ${className}`}
      {...props}
    />
  );
}
