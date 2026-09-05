import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/cn'

// Themed per DESIGN.md §Components → Buttons (09 §2, D-025): 6 px radius, 40 px default height,
// label type 13/20 weight 500, teal primary, solid red destructive, focus ring from --focus.
//
// The label wraps rather than escaping the control (WCAG 1.4.4): at 200 % text size a nowrap label
// clipped itself and pushed the document sideways at 360 px, so the sizes set a *minimum* height —
// 40 px at normal text size, exactly as DESIGN.md §Control heights requires, because the 13/20
// label plus the 4 px of `py-1` comes to 28 px and the minimum is what shows — and a wrapped
// second line grows the control instead. `max-w-full` keeps a long label inside its container even
// though the button never shrinks below its content.
//
// Two treatments for a control that cannot act, because they are two different states:
//
// `disabled` is the browser's own — removed from the tab order, announced as unavailable, and
// exempt from contrast (WCAG 1.4.3 "inactive user interface components"). It keeps DESIGN.md's
// 45 % opacity.
//
// `aria-disabled` is the one this product reaches for wherever the control must stay reachable and
// carry its reason (the lock button while a claim is unstanced, "Create and generate" on UI-041, a
// submit while its request is in flight). That control is still focusable and still read aloud, so
// the inactive-component exemption is a poor fit for it — and 45 % opacity measured 2.14:1 on the
// secondary variant's teal label, which nobody can read. It instead takes the sunken well and
// muted ink the rest of the product uses for "present, not available now": ink-muted on
// paper-sunken is 6.5:1, and the fill, not the fade, is what says it cannot act. The hover and
// active fills are pinned back to the same well so a press changes nothing.
const buttonVariants = cva(
  "group/button inline-flex max-w-full shrink-0 items-center justify-center gap-2 rounded-md border border-transparent text-center text-meta font-medium transition-colors duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-45 aria-disabled:cursor-default aria-disabled:bg-paper-sunken aria-disabled:text-ink-muted aria-disabled:hover:bg-paper-sunken aria-disabled:active:bg-paper-sunken aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-foreground hover:bg-[color-mix(in_srgb,var(--primary)_90%,var(--ink))] active:bg-[color-mix(in_srgb,var(--primary)_85%,var(--ink))]',
        secondary:
          'border-line-control bg-paper-raised text-primary hover:bg-paper-sunken aria-expanded:bg-paper-sunken',
        // `outline` is the name other shadcn primitives pass; it is the secondary treatment.
        outline:
          'border-line-control bg-paper-raised text-primary hover:bg-paper-sunken aria-expanded:bg-paper-sunken',
        ghost: 'text-ink hover:bg-paper-sunken aria-expanded:bg-paper-sunken',
        destructive:
          'bg-red text-primary-ink hover:bg-[color-mix(in_srgb,var(--red)_90%,var(--ink))] active:bg-[color-mix(in_srgb,var(--red)_85%,var(--ink))]',
        link: 'h-auto px-0 text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'min-h-8 px-3 py-1',
        md: 'min-h-10 px-4 py-1',
        default: 'min-h-10 px-4 py-1',
        lg: 'min-h-12 px-5 py-1 text-body',
        icon: 'size-10',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

function Button({
  className,
  variant = 'primary',
  size = 'md',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
