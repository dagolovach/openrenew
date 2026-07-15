// components/ui/input.tsx
import { InputHTMLAttributes, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', id, ...props }, ref) => (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-[#9CA3AF]">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={id}
        className={`rounded-md border px-3 py-2 text-sm bg-white/5 text-[#F9FAFB] shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${error ? 'border-red-500' : 'border-white/10'} ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
)
Input.displayName = 'Input'
