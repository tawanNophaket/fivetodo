export function Card({ className = "", children }) {
  return (
    <div
      className={`border border-slate-200 bg-white shadow-sm/40 ${className}`}
    >
      {children}
    </div>
  );
}
export function CardHeader({ className = "", children }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}
export function CardContent({ className = "", children }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}
