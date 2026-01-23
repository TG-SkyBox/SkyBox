import { Send, Smartphone } from "lucide-react";

interface QrCardProps {
  isActive?: boolean;
  onConfirm?: () => void;
}

export function QrCard({ isActive, onConfirm }: QrCardProps) {
  return (
    <div className="flex flex-col items-center gap-6">
      {/* QR Code */}
      <div className="relative w-48 h-48 bg-foreground rounded-lg flex items-center justify-center overflow-hidden p-3">
        {/* Simulated QR pattern */}
        <div className="absolute inset-3 grid grid-cols-9 gap-0.5">
          {Array.from({ length: 81 }).map((_, i) => {
            // Create corner patterns (position detection patterns)
            const row = Math.floor(i / 9);
            const col = i % 9;
            
            // Top-left corner pattern
            const isTopLeft = (row < 3 && col < 3) || (row === 0 && col < 3) || (col === 0 && row < 3);
            // Top-right corner pattern
            const isTopRight = (row < 3 && col > 5) || (row === 0 && col > 5) || (col === 8 && row < 3);
            // Bottom-left corner pattern
            const isBottomLeft = (row > 5 && col < 3) || (row === 8 && col < 3) || (col === 0 && row > 5);
            
            // Outer border of position patterns
            const isOuterBorder = 
              (row === 0 && col <= 2) || (row === 2 && col <= 2) || (col === 0 && row <= 2) || (col === 2 && row <= 2) ||
              (row === 0 && col >= 6) || (row === 2 && col >= 6) || (col === 6 && row <= 2) || (col === 8 && row <= 2) ||
              (row === 6 && col <= 2) || (row === 8 && col <= 2) || (col === 0 && row >= 6) || (col === 2 && row >= 6);
            
            // Inner dot of position patterns
            const isInnerDot = 
              (row === 1 && col === 1) ||
              (row === 1 && col === 7) ||
              (row === 7 && col === 1);
            
            // Random data pattern in the middle
            const isData = !isTopLeft && !isTopRight && !isBottomLeft && 
              [12, 13, 14, 21, 23, 30, 31, 32, 33, 34, 39, 40, 41, 48, 49, 50, 57, 58, 59, 66, 67, 68].includes(i);
            
            const isFilled = isOuterBorder || isInnerDot || isData;
            
            return (
              <div
                key={i}
                className={`aspect-square ${
                  isFilled ? "bg-background" : "bg-transparent"
                }`}
              />
            );
          })}
        </div>
        
        {/* Center icon - Telegram style */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-12 h-12 bg-primary rounded-full flex items-center justify-center">
            <Send className="w-6 h-6 text-primary-foreground -rotate-45" />
          </div>
        </div>
      </div>

      {/* Title */}
      <h2 className="text-xl font-semibold text-foreground">
        Scan From Mobile Telegram
      </h2>

      {/* Instructions */}
      <div className="flex flex-col gap-3 w-full max-w-sm">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
            <span className="text-sm text-primary-foreground font-medium">1</span>
          </div>
          <p className="text-body text-foreground">
            Open Telegram on your phone
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
            <span className="text-sm text-primary-foreground font-medium">2</span>
          </div>
          <p className="text-body text-foreground">
            Go to Settings &gt; Devices &gt; Link Desktop Device
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
            <span className="text-sm text-primary-foreground font-medium">3</span>
          </div>
          <p className="text-body text-foreground">
            Scan this image to Log In
          </p>
        </div>
      </div>

      {/* Confirm button for demo */}
      {isActive && (
        <button
          onClick={onConfirm}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-accent text-primary-foreground rounded-lg text-sm font-medium transition-colors duration-150 mt-2"
        >
          <Smartphone className="w-4 h-4" />
          Simulate Scan
        </button>
      )}
    </div>
  );
}
