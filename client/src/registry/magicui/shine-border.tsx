import * as React from "react"

interface ShineBorderProps extends React.HTMLAttributes<HTMLDivElement> {
  borderWidth?: number
  duration?: number
  shineColor?: string | string[]
}

export function ShineBorder({
  borderWidth = 1,
  duration = 14,
  shineColor = "#000000",
  style,
  ...props
}: ShineBorderProps) {
  const color = Array.isArray(shineColor) ? shineColor[1] ?? shineColor[0] : shineColor

  return (
    <div
      style={
        {
          "--border-width": `${borderWidth}px`,
          "--duration": `${duration}s`,
          "--shine-color": color,
          backgroundImage: `conic-gradient(from var(--shine-angle, 0deg), transparent 60%, var(--shine-color) 80%, transparent 100%)`,
          mask: `linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)`,
          WebkitMask: `linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)`,
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
          padding: "var(--border-width)",
          animation: `shine-border var(--duration) linear infinite`,
          pointerEvents: "none",
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          borderRadius: "inherit",
          willChange: "transform",
          ...style,
        } as React.CSSProperties
      }
      {...props}
    />
  )
}
