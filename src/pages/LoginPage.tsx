import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Send, ArrowLeft, X } from "lucide-react";
import { CountryCodeSelect, countries, Country } from "@/components/teleexplorer/CountryCodeSelect";
import { TelegramButton } from "@/components/teleexplorer/TelegramButton";
import { OtpInput } from "@/components/teleexplorer/OtpInput";
import { QrCard } from "@/components/teleexplorer/QrCard";
import { toast } from "@/hooks/use-toast";

type LoginStep = "phone" | "otp" | "qr";
type LoginMode = "qr" | "phone";

export default function LoginPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<LoginStep>("phone");
  const [loginMode, setLoginMode] = useState<LoginMode>("qr");
  const [selectedCountry, setSelectedCountry] = useState<Country>(
    countries.find(c => c.code === "LK") || countries[0]
  );
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber.trim()) return;

    setIsLoading(true);
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setIsLoading(false);
    setStep("otp");
    
    toast({
      title: "Code sent",
      description: `Verification code sent to ${selectedCountry.dialCode}${phoneNumber}`,
    });
  };

  const handleOtpComplete = async (code: string) => {
    setIsLoading(true);
    // Simulate verification
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setIsLoading(false);

    // For demo, accept any 5-digit code
    if (code.length === 5) {
      toast({
        title: "Welcome!",
        description: "Successfully logged in",
      });
      navigate("/explorer");
    } else {
      toast({
        title: "Invalid code",
        description: "Please enter a valid verification code",
        variant: "destructive",
      });
    }
  };

  const handleQrConfirm = async () => {
    setIsLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setIsLoading(false);
    
    toast({
      title: "Device linked!",
      description: "Successfully authenticated via QR code",
    });
    navigate("/explorer");
  };

  const handleBack = () => {
    if (step === "otp") {
      setStep("phone");
      setOtp("");
    } else if (loginMode === "phone") {
      setLoginMode("qr");
    }
  };

  const maskedPhone = `${selectedCountry.dialCode}${phoneNumber.slice(0, 3)}***${phoneNumber.slice(-2)}`;

  const showBackButton = loginMode === "phone" || step === "otp";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between p-4">
        <div className="w-10">
          {showBackButton && (
            <button 
              onClick={handleBack}
              className="p-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
        </div>
        <button className="text-body text-link hover:underline">
          Proxy Settings
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          {/* QR Login Mode */}
          {loginMode === "qr" && step === "phone" && (
            <div className="animate-fade-in">
              <QrCard isActive onConfirm={handleQrConfirm} />
              
              {/* Alternative login links */}
              <div className="flex flex-col items-center gap-2 mt-6">
                <button
                  onClick={() => setLoginMode("phone")}
                  className="text-body text-link hover:underline"
                >
                  Log in with phone number
                </button>
                <button className="text-body text-link hover:underline">
                  Log in with passkey
                </button>
              </div>
            </div>
          )}

          {/* Phone Login Mode */}
          {loginMode === "phone" && step === "phone" && (
            <div className="animate-fade-in flex flex-col items-center">
              {/* Telegram Logo */}
              <div className="w-32 h-32 mb-8 bg-primary rounded-full flex items-center justify-center">
                <Send className="w-16 h-16 text-primary-foreground -rotate-45 translate-x-1" />
              </div>

              {/* Title */}
              <h1 className="text-2xl font-bold text-foreground mb-2">
                Your Phone
              </h1>
              <p className="text-body text-muted-foreground text-center mb-8">
                Please confirm your country code<br />
                and enter your phone number.
              </p>

              {/* Form */}
              <form onSubmit={handlePhoneSubmit} className="w-full space-y-2">
                {/* Country Selector */}
                <CountryCodeSelect
                  value={selectedCountry}
                  onChange={setSelectedCountry}
                  fullWidth
                />

                {/* Phone Input */}
                <div className="relative">
                  <input
                    type="tel"
                    value={`${selectedCountry.dialCode}${phoneNumber}`}
                    onChange={(e) => {
                      const val = e.target.value;
                      // Remove dial code prefix and keep only digits
                      const withoutDialCode = val.startsWith(selectedCountry.dialCode) 
                        ? val.slice(selectedCountry.dialCode.length) 
                        : val.replace(/^\+\d*/, '');
                      setPhoneNumber(withoutDialCode.replace(/\D/g, ""));
                    }}
                    placeholder={selectedCountry.dialCode}
                    className="w-full px-4 py-3 bg-secondary border border-border rounded-lg text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary pr-10"
                  />
                  {phoneNumber && (
                    <button
                      type="button"
                      onClick={() => setPhoneNumber("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* OK Button */}
                <TelegramButton
                  type="submit"
                  fullWidth
                  size="lg"
                  loading={isLoading}
                  disabled={!phoneNumber.trim()}
                >
                  OK
                </TelegramButton>
              </form>
              
              {/* Alternative login links */}
              <div className="flex flex-col items-center gap-2 mt-6">
                <button
                  onClick={() => setLoginMode("qr")}
                  className="text-body text-link hover:underline"
                >
                  Quick log in using QR code
                </button>
                <button className="text-body text-link hover:underline">
                  Log in with passkey
                </button>
              </div>
            </div>
          )}

          {/* OTP Step */}
          {step === "otp" && (
            <div className="animate-fade-in flex flex-col items-center">
              {/* Telegram Logo */}
              <div className="w-32 h-32 mb-8 bg-primary rounded-full flex items-center justify-center">
                <Send className="w-16 h-16 text-primary-foreground -rotate-45 translate-x-1" />
              </div>

              {/* Title */}
              <h1 className="text-2xl font-bold text-foreground mb-2">
                {maskedPhone}
              </h1>
              <p className="text-body text-muted-foreground text-center mb-8">
                We've sent the code to your phone.<br />
                Please enter it below.
              </p>

              <div className="w-full space-y-6">
                <OtpInput
                  value={otp}
                  onChange={setOtp}
                  onComplete={handleOtpComplete}
                />

                <div className="text-center space-y-2">
                  <button className="text-body text-link hover:underline">
                    Didn't receive code?
                  </button>
                  <p className="text-small text-muted-foreground">
                    You can request a new code in 60s
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 text-center">
        <p className="text-small text-muted-foreground">
          TeleExplorer 1.0.0
        </p>
      </div>
    </div>
  );
}
