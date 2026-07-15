// components/ui/button.tsx
import { ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline'
  isLoading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', isLoading, children, className = '', disabled, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'
    const variants = {
      primary: 'bg-emerald-500 text-[#0A0F1E] hover:bg-emerald-400 focus:ring-emerald-500',
      outline: 'border border-white/10 bg-transparent text-[#F9FAFB] hover:bg-white/5 focus:ring-emerald-500',
    }
    return (
      <button
        ref={ref}
        className={`${base} ${variants[variant]} ${className}`}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? 'Loading…' : children}
      </button>
    )
  }
)
Button.displayName = 'Button'
