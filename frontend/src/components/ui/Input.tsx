import { type InputHTMLAttributes, forwardRef } from 'react'
import clsx from 'clsx'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={clsx(
        'w-full rounded-[10px] border border-border bg-surface-alt px-3.5 py-2.5 text-[13px] text-ink placeholder:text-ink-faint',
        'outline-none focus:border-accent focus:bg-surface',
        'disabled:bg-page disabled:text-ink-faint',
        className
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'
