
import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "../../lib/utils"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-slate-200">
      <SliderPrimitive.Range className="absolute h-full bg-slate-400" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-6 w-3 rounded-sm bg-slate-600 ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-ew-resize shadow-md hover:bg-slate-700" />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
