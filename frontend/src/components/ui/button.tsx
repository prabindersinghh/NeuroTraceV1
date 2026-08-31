import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // `tactile` is the press: a spring scale on :active. It lived in index.css and was
  // applied to two CARDS and to no button at all, which is why every click felt dead.
  // DESIGN_LANGUAGE §1.7 — "everything clickable gives weight back".
  "tactile inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium focus-ring disabled:pointer-events-none disabled:opacity-50 transition-[background-color,border-color,color,transform] duration-200 ease-out active:scale-[0.985] motion-reduce:active:scale-100",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        accent: "bg-accent text-accent-foreground hover:bg-accent/90",
        outline: "border border-input bg-card hover:bg-secondary",
        ghost: "hover:bg-secondary",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-9 px-3 text-sm",
        default: "h-11 px-5 text-[0.95rem]",
        lg: "h-14 px-8 text-lg",
        /* Patients are 55-75 with low digital literacy — one huge target per screen. */
        // 72px/24px is the PHONE size, and it was applied at every width — on a
        // 1900px laptop that renders a 384x72px button with 24px text inside a
        // 448px column, which is a phone layout blown up rather than a desktop one.
        // DESIGN_LANGUAGE.md §6: touch devices get the big target, "pointer devices
        // keep compact sizing". Scoped to a LARGE screen WITH A MOUSE, so a phone or
        // a tablet in landscape is untouched. 56px is still a generous target.
        touch:
          "min-h-[4.5rem] w-full px-8 text-2xl font-semibold "
          + "[@media(min-width:1024px)_and_(pointer:fine)]:min-h-[3.5rem] "
          + "[@media(min-width:1024px)_and_(pointer:fine)]:text-xl",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
