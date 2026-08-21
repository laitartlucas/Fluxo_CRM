import { type ButtonHTMLAttributes, forwardRef } from 'react'
import clsx from 'clsx'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover disabled:bg-accent/40',
  secondary: 'bg-surface text-ink border border-border hover:bg-page disabled:text-ink-faint',
  ghost: 'bg-transparent text-ink-muted hover:bg-page disabled:text-ink-faint/60',
  danger: 'bg-danger text-white hover:bg-danger/90 disabled:bg-danger/40',
  success: 'bg-success text-white hover:bg-success-ink disabled:bg-success/40',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', className, ...props }, ref) => (
    <button
      ref={ref}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-[10px] px-4 py-2.5 text-[13px] font-bold transition-colors disabled:cursor-not-allowed',
        variantClasses[variant],
        className
      )}
      {...props}
    />
  )
)
Button.displayName = 'Button'
