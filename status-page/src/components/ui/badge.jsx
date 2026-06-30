import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium tracking-normal transition-colors",
  {
    variants: {
      variant: {
        default: "border-white/12 bg-white/10 text-white",
        success: "border-emerald-300/20 bg-emerald-300/10 text-emerald-100",
        muted: "border-white/10 bg-black/25 text-white/62"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

function Badge({ className, variant, ...props }) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
