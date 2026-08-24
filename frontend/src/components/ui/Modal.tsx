import type { ReactNode } from 'react'
import clsx from 'clsx'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  className?: string
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div
        className={clsx('max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-[14px] border border-border bg-surface shadow-xl', className)}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-border-light px-4 py-3">
            <h2 className="text-[15px] font-extrabold text-ink">{title}</h2>
            <button onClick={onClose} className="text-ink-muted hover:text-ink" aria-label="Fechar">
              ✕
            </button>
          </div>
        )}
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}
