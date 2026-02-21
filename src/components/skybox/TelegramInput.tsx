import { InputHTMLAttributes, forwardRef } from "react";

interface TelegramInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const TelegramInput = forwardRef<HTMLInputElement, TelegramInputProps>(
  ({ label, error, hint, className = "", ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label className="block text-small text-muted-foreground font-medium">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`w-full px-4 py-3 bg-secondary border rounded-lg text-body text-foreground placeholder:text-muted-foreground focus:outline-none transition-all duration-150 ${
            error
              ? "border-destructive focus:ring-2 focus:ring-destructive/30"
              : "border-border focus:border-primary focus:ring-2 focus:ring-primary/20"
          } ${className}`}
          {...props}
        />
        {error && <p className="text-small text-destructive">{error}</p>}
        {hint && !error && (
          <p className="text-small text-muted-foreground">{hint}</p>
        )}
      </div>
    );
  },
);

TelegramInput.displayName = "TelegramInput";
