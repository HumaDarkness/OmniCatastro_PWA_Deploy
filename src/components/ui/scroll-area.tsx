import * as React from "react"

function cn(...classes: (string | undefined | false)[]) {
    return classes.filter(Boolean).join(" ")
}

const ScrollArea = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, children, ...props }, ref) => (
        <div ref={ref} className={cn("relative overflow-auto", className)} {...props}>
            {children}
        </div>
    )
)
ScrollArea.displayName = "ScrollArea"

export { ScrollArea }
