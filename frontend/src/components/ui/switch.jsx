import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

const Switch = React.forwardRef(({ className, ...props }, ref) => (
  // Forced to dir="ltr": the thumb's on/off position is driven by a
  // physical translate-x, which never flips under the page's dir="rtl" —
  // but the flex layout it sits in does, so the thumb's un-transformed
  // (flex-start) rest position jumps to the opposite edge while the
  // translate distance stays pointed the same way. The two fighting each
  // other pushed the thumb outside the track, rendering as a blank/broken
  // toggle on any Arabic page. Toggle switches are a fairly universal UI
  // convention anyway (most RTL products don't mirror them), so pinning
  // this control to LTR internally is simpler and more robust than trying
  // to make every transform direction-aware.
  <SwitchPrimitives.Root
    dir="ltr"
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      className
    )}
    {...props}
    ref={ref}>
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      )} />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
