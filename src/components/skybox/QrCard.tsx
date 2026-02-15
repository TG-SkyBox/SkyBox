import { useState, useEffect } from "react";
import { Send, Smartphone, RefreshCw } from "lucide-react";
import { QRCode, Spin } from "antd";

interface QrCardProps {
  isActive?: boolean;
  onConfirm?: () => void;
  qrData?: string;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  expiresAt?: number;
}

export function QrCard({ isActive, onConfirm, qrData, onRefresh, isRefreshing, expiresAt }: QrCardProps) {
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    if (!expiresAt) return;

    const updateTimer = () => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setTimeLeft(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const isExpired = timeLeft <= 0 && expiresAt !== undefined;

  return (
    <div className="flex flex-col items-center gap-6">
      {/* QR Code */}
      <div className="relative p-4 bg-white rounded-xl shadow-lg">
        {qrData ? (
          <QRCode
            value={qrData}
            size={200}
            icon="/Square44x44Logo.png" // Using requested icon from public folder
            iconSize={40}
            status={isExpired ? "expired" : isRefreshing ? "loading" : "active"}
            onRefresh={onRefresh}
            bordered={false}
          />
        ) : (
          // Loading state
          <div className="w-[200px] h-[200px] flex items-center justify-center">
            <Spin size="large" tip="Generating QR..." />
          </div>
        )}
      </div>

      {/* Title and Expiration */}
      <div className="text-center">
        <h2 className="text-xl font-semibold text-foreground mb-2">
          Scan From Mobile Telegram
        </h2>
        {expiresAt && (
          <div className={`text-sm ${isExpired ? "text-destructive" : "text-muted-foreground"}`}>
            {isExpired ? "QR code expired" : `Expires in ${Math.floor(timeLeft / 60)}:${(timeLeft % 60).toString().padStart(2, "0")}`}
          </div>
        )}
      </div>

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
            Scan this QR code to Log In
          </p>
        </div>
      </div>

      {/* Auto-generate indicator */}
      <div className="mt-2 text-center">
        <p className="text-sm text-muted-foreground">
          Scan with Telegram on your phone
        </p>
      </div>
    </div>
  );
}
