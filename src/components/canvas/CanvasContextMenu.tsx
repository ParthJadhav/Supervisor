import { forwardRef, type CSSProperties } from "react";

const menuContainerStyle: CSSProperties = {
  position: "fixed",
  zIndex: 9999,
  minWidth: 200,
  padding: "6px 0",
  background: "rgba(22, 22, 24, 0.95)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  border: "1px solid rgba(255, 255, 255, 0.10)",
  borderRadius: 10,
  boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)",
};

interface CanvasContextMenuProps extends React.HTMLAttributes<HTMLDivElement> {
  x: number;
  y: number;
}

export const CanvasContextMenu = forwardRef<HTMLDivElement, CanvasContextMenuProps>(
  ({ x, y, children, style, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="menu"
        style={{
          ...menuContainerStyle,
          left: x,
          top: y,
          ...style,
        }}
        {...props}
      >
        {children}
      </div>
    );
  },
);

CanvasContextMenu.displayName = "CanvasContextMenu";

export function CanvasContextMenuDivider() {
  return <div style={{ height: 1, margin: "4px 8px", background: "rgba(255,255,255,0.06)" }} />;
}

interface CanvasContextMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label: string;
  destructive?: boolean;
}

export function CanvasContextMenuItem({ icon, label, destructive, ...props }: CanvasContextMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      {...props}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "8px 14px",
        background: "none",
        border: "none",
        color: destructive ? "#ef4444" : "var(--studio-text-primary, #e5e5e5)",
        fontSize: 14,
        cursor: "pointer",
        textAlign: "left",
        borderRadius: 0,
        transition: "background 100ms ease",
        ...props.style,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)";
        props.onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "none";
        props.onMouseLeave?.(e);
      }}
    >
      {icon}
      {label}
    </button>
  );
}
