import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, X } from "lucide-react";
import { CountryCodeSelect, countries, Country } from "@/components/skybox/CountryCodeSelect";
import { TelegramButton } from "@/components/skybox/TelegramButton";
import { OtpInput } from "@/components/skybox/OtpInput";
import { QrCard } from "@/components/skybox/QrCard";
import { TelegramInput } from "@/components/skybox/TelegramInput"; // Assuming this exists for password input
import { toast } from "@/hooks/use-toast";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { logger } from "@/lib/logger";
import appStartIcon from "../../image.png";

interface DbError {
  message: string;
}

interface TelegramError {
  message: string;
}

interface Session {
  id: number;
  phone: string;
  session_data?: string;
  created_at: string;
}

interface TelegramAuthData {
  phone_number: string;
  phone_code?: string;
  password?: string;
}

interface TelegramAuthResult {
  authorized: boolean;
  session_data?: string;
  user_info?: UserInfo;
  requires_password: boolean;
}

interface QrLoginData {
  qr_url: string;
  expires_at_unix: number;
  flow_id: number;
}

interface QrPollResult {
  status: QrLoginStatus;
  qr_url?: string;
  user_info?: UserInfo;
  session_data?: string;
  requires_password: boolean;
  message?: string;
}

type QrLoginStatus = "Pending" | "Success" | "Expired" | "PasswordRequired" | "Error";

interface UserInfo {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  profile_photo?: string;
}

type LoginStep = "phone" | "otp" | "password" | "qr";
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
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [appVersion, setAppVersion] = useState<string>("...");

  // QR Login state
  const [qrData, setQrData] = useState<string | null>(null);
  const [qrExpiresAt, setQrExpiresAt] = useState<number | null>(null);
  const [qrFlowId, setQrFlowId] = useState<number | null>(null);
  const [isQrRefreshing, setIsQrRefreshing] = useState(false);
  const [qrPollInterval, setQrPollInterval] = useState<number | null>(null);
  const pollingRef = useRef<boolean>(false);
  const qrStartedRef = useRef<boolean>(false);
  const isMigratingRef = useRef<boolean>(false); // Track migration state

  // Removed the session check useEffect since it's now handled in LoadingPage

  useEffect(() => {
    let cancelled = false;

    const loadAppVersion = async () => {
      try {
        const version = await getVersion();
        if (!cancelled) {
          setAppVersion(version);
        }
      } catch (error) {
        logger.warn("LoginPage: Failed to read app version", error);
        if (!cancelled) {
          setAppVersion("unknown");
        }
      }
    };

    void loadAppVersion();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber.trim()) return;

    logger.info("handlePhoneSubmit: Starting phone validation");

    // Validate phone number format
    const fullPhoneNumber = `${selectedCountry.dialCode}${phoneNumber}`;
    const phoneRegex = /^\+[1-9]\d{1,14}$/; // E.164 format validation

    if (!phoneRegex.test(fullPhoneNumber)) {
      toast({
        title: "Invalid Phone Number",
        description: "Please enter a valid phone number in international format",
        variant: "destructive",
      });
      return;
    }

    logger.info(`handlePhoneSubmit: Validated phone number: ${fullPhoneNumber}`);

    setIsLoading(true);

    try {
      logger.info(`handlePhoneSubmit: Calling tg_request_auth_code with phone: ${fullPhoneNumber}`);

      // Request auth code via MTProto
      const authData: TelegramAuthData = {
        phone_number: fullPhoneNumber
      };

      const result: TelegramAuthResult = await invoke("tg_request_auth_code", { authData });

      logger.info(`handlePhoneSubmit: Received result from tg_request_auth_code:`, result);

      if (result.authorized) {
        // If already authorized, save session and navigate
        if (result.user_info) {
          logger.info("handlePhoneSubmit: User already authorized");
          toast({
            title: "Welcome back!",
            description: `Logged in as ${result.user_info.first_name || result.user_info.username || 'user'}`,
          });
          navigate("/explorer");
        }
      } else {
        logger.info("handlePhoneSubmit: Moving to OTP step");
        // Move to OTP step to enter the code received via Telegram
        setStep("otp");
        toast({
          title: "Code sent",
          description: `Verification code sent to ${fullPhoneNumber}`,
        });
      }
    } catch (error) {
      console.error("handlePhoneSubmit: Error requesting auth code:", error);
      const typedError = error as TelegramError;

      // More specific error handling based on error message
      let title = "Error";
      let description = typedError.message || "Failed to send verification code";
      let variant: "destructive" | "default" = "destructive";

      if (description.includes("Network connection lost")) {
        title = "Connection Error";
        description = "Please check your internet connection and try again.";
      } else if (description.includes("Request timed out")) {
        title = "Timeout Error";
        description = "The request took too long. Please check your connection and try again.";
      } else if (description.includes("Invalid phone number")) {
        title = "Invalid Number";
        description = "Please check the phone number format and try again.";
      } else if (description.includes("Too many requests")) {
        title = "Rate Limit Exceeded";
        description = "Please wait a few minutes before trying again.";
      } else if (description.includes("Authentication service error")) {
        title = "Service Error";
        description = "Telegram authentication service is temporarily unavailable. Please try again later.";
      }

      toast({
        title,
        description,
        variant,
      });
    } finally {
      logger.info("handlePhoneSubmit: Setting isLoading to false");
      setIsLoading(false);
    }
  };

  const handleOtpComplete = async (code: string) => {
    setIsLoading(true);

    try {
      // Complete sign in with the code
      const result: TelegramAuthResult = await invoke("tg_sign_in_with_code", {
        phoneCode: code  // Pass only the phone code as expected by the backend
      });

      if (result.requires_password) {
        // 2FA is enabled, need to enter password
        setStep("password");
        toast({
          title: "2-Step Verification",
          description: "Please enter your password",
        });
      } else if (result.authorized && result.user_info) {
        toast({
          title: "Welcome!",
          description: `Successfully logged in as ${result.user_info.first_name || result.user_info.username || 'user'}`,
        });
        navigate("/explorer");
      } else {
        toast({
          title: "Invalid code",
          description: "Please enter a valid verification code",
          variant: "destructive",
        });
      }
    } catch (error) {
      const typedError = error as TelegramError;
      console.error("Error signing in with code:", error);
      toast({
        title: "Authentication failed",
        description: typedError.message || "Failed to authenticate with the provided code",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setIsLoading(true);

    try {
      // Complete sign in with the password
      const result: TelegramAuthResult = await invoke("tg_sign_in_with_password", {
        password: password
      });

      if (result.authorized && result.user_info) {
        // Session is already saved in backend, just navigate
        toast({
          title: "Welcome!",
          description: `Successfully logged in as ${result.user_info.first_name || result.user_info.username || 'user'}`,
        });
        navigate("/explorer");
      } else {
        toast({
          title: "Invalid password",
          description: "Please enter a valid password",
          variant: "destructive",
        });
      }
    } catch (error) {
      const typedError = error as TelegramError;
      console.error("Error signing in with password:", error);
      toast({
        title: "Authentication failed",
        description: typedError.message || "Failed to authenticate with the provided password",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const generateQrCode = async () => {
    setIsQrRefreshing(true);
    try {
      // Clear any existing polling interval before generating new QR
      if (qrPollInterval) {
        clearInterval(qrPollInterval);
        setQrPollInterval(null);
      }

      logger.info("generateQrCode: Calling tg_generate_qr_code");
      const result: QrLoginData = await invoke("tg_generate_qr_code");

      if (!result.qr_url) {
        throw new Error("No QR URL returned from backend");
      }

      logger.info(`generateQrCode: Received QR for flow_id=${result.flow_id}`);
      setQrData(result.qr_url);
      setQrExpiresAt(result.expires_at_unix * 1000); // Convert to milliseconds
      setQrFlowId(result.flow_id);

      // Start polling for login status
      startQrPolling();
    } catch (error) {
      const typedError = error as TelegramError;
      console.error("Error generating QR code:", error);
      toast({
        title: "QR Code Generation Failed",
        description: typedError.message || "Failed to generate QR code",
        variant: "destructive",
      });
    } finally {
      setIsQrRefreshing(false);
    }
  };

  const startQrPolling = () => {
    // Stop any existing polling
    pollingRef.current = false;
    isMigratingRef.current = false; // Reset migration state

    // Start new polling loop
    pollingRef.current = true;

    const poll = async () => {
      if (!pollingRef.current) return;
      
      // Skip polling if migration is in progress
      if (isMigratingRef.current) {
        logger.debug("startQrPolling: Skipping poll during migration");
        setTimeout(poll, 1000); // Check again in 1 second
        return;
      }

      try {
        const result: QrPollResult = await invoke("tg_poll_qr_login");

        if (!pollingRef.current) return;

        switch (result.status) {
          case "Success":
            pollingRef.current = false;
            isMigratingRef.current = false;
            if (result.user_info) {
              toast({
                title: "Login Successful!",
                description: `Welcome ${result.user_info.first_name || result.user_info.username || 'user'}!`,
              });
              navigate("/explorer");
            }
            break;

          case "PasswordRequired":
            pollingRef.current = false;
            isMigratingRef.current = false;
            setStep("password");
            toast({
              title: "2-Step Verification Required",
              description: "Please enter your password",
            });
            break;

          case "Expired":
            pollingRef.current = false;
            isMigratingRef.current = false;
            toast({
              title: "QR Code Expired",
              description: "Generating a new QR code",
              variant: "destructive",
            });
            setTimeout(() => {
              generateQrCode();
            }, 5000);
            break;

          case "Error":
            if (result.message?.includes("migration") || result.message?.includes("MigrateTo") || result.message?.includes("Migration")) {
              // Backend is handling migration, pause frontend polling completely
              logger.info("startQrPolling: Migration detected, pausing frontend polling");
              isMigratingRef.current = true;
              pollingRef.current = false; // STOP POLLING ENTIRELY
              // Don't resume polling - let backend handle everything
              toast({
                title: "Migration in progress",
                description: "Please wait while we connect to Telegram servers...",
              });
              return;
            }
            
            if (result.message) {
              toast({
                title: "Error",
                description: result.message,
                variant: "destructive",
              });
            }
            // Continue polling after delay unless it's a critical error
            setTimeout(poll, 5000); // Increased from 2s to 5s to reduce interference
            break;

          case "Pending":
            if (result.qr_url && result.qr_url !== qrData) {
              logger.info("startQrPolling: Token updated during poll, updating QR");
              setQrData(result.qr_url);
            }
            // Schedule next poll
            setTimeout(poll, 5000); // Increased from 2s to 5s
            break;
        }
      } catch (error) {
        if (!pollingRef.current) return;
        console.error("Error polling QR login status:", error);

        const typedError = error as TelegramError;
        toast({
          title: "Polling Error",
          description: typedError.message || "Failed to poll login status",
          variant: "destructive",
        });

        // Don't stop on one error, try again
        setTimeout(poll, 3000);
      }
    };

    poll();
  };

  const handleQrConfirm = async () => {
    // Auto-start QR generation when entering QR mode
    await generateQrCode();
  };

  // Auto-generate QR code when entering QR mode (with guard to prevent double generation)
  useEffect(() => {
    if (loginMode === 'qr' && step === 'phone') {
      // Use ref to ensure this only runs once per mount, even if dependencies change
      if (!qrStartedRef.current) {
        logger.info("LoginPage: Auto-generating QR code (first time)");
        qrStartedRef.current = true;
        generateQrCode();
      }
    } else {
      // Reset the guard when leaving QR mode
      qrStartedRef.current = false;
    }
  }, [loginMode, step]);

  // Listen for QR token update events from backend
  useEffect(() => {
    const unlisten = listen<{ flow_id: number; qr_url: string; expires_at_unix: number }>(
      'qr-token-updated',
      (event) => {
        logger.info(`LoginPage: Received qr-token-updated event for flow_id=${event.payload.flow_id}`);
        // Only update if it matches our current flow
        if (qrFlowId && event.payload.flow_id === qrFlowId) {
          logger.info("LoginPage: Updating QR with new token from backend");
          setQrData(event.payload.qr_url);
          setQrExpiresAt(event.payload.expires_at_unix * 1000);
        }
      }
    );

    return () => {
      unlisten.then(fn => fn());
    };
  }, [qrFlowId]);

  // Stop QR polling when switching away from QR mode or starting phone login
  useEffect(() => {
    if (loginMode !== 'qr' || step !== 'phone') {
      if (pollingRef.current) {
        logger.info("LoginPage: Stopping QR polling due to mode/step change");
        pollingRef.current = false;
        isMigratingRef.current = false;
        // Cancel the QR flow on backend
        invoke("tg_cancel_qr_login").catch(err => {
          console.error("Failed to cancel QR login:", err);
        });
      }
    }
  }, [loginMode, step]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      pollingRef.current = false;
      isMigratingRef.current = false;
      // Cancel QR flow when component unmounts
      invoke("tg_cancel_qr_login").catch(err => {
        console.error("Failed to cancel QR login on unmount:", err);
      });
    };
  }, []);

  const handleBack = () => {
    if (step === "password") {
      setPassword("");
      // If we came from QR login, go back to the QR screen.
      // If we came from phone login, go back to the OTP step.
      setStep(loginMode === "qr" ? "phone" : "otp");
    } else if (step === "otp") {
      setStep("phone");
      setOtp("");
    } else if (loginMode === "phone") {
      setLoginMode("qr");
    }
  };

  const maskedPhone = `${selectedCountry.dialCode}${phoneNumber.slice(0, 3)}***${phoneNumber.slice(-2)}`;
  const fullPhoneNumber = `${selectedCountry.dialCode}${phoneNumber}`;

  const showBackButton = loginMode === "phone" || step === "otp" || step === "password";

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
      <div className="flex-1 flex items-start justify-center p-4 pt-[10vh]">
        <div className="w-full max-w-sm">
          {/* QR Login Mode */}
          {loginMode === "qr" && step === "phone" && (
            <div className="animate-fade-in">
              <QrCard
                isActive
                qrData={qrData || undefined}
                isRefreshing={isQrRefreshing}
                expiresAt={qrExpiresAt || undefined}
              />

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
              <div className="w-32 h-32 mb-8 flex items-center justify-center">
                <img src={appStartIcon} alt="SkyBox Logo" className="w-full h-full object-contain" />
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
              <div className="w-32 h-32 mb-8 flex items-center justify-center">
                <img src={appStartIcon} alt="SkyBox Logo" className="w-full h-full object-contain" />
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

          {/* Password Step for 2FA */}
          {step === "password" && (
            <div className="animate-fade-in flex flex-col items-center">
              {/* Telegram Logo */}
              <div className="w-32 h-32 mb-8 flex items-center justify-center">
                <img src={appStartIcon} alt="SkyBox Logo" className="w-full h-full object-contain" />
              </div>

              {/* Title */}
              <h1 className="text-2xl font-bold text-foreground mb-2">
                Two-Step Verification
              </h1>
              <p className="text-body text-muted-foreground text-center mb-8">
                Please enter your password
              </p>

              <div className="w-full space-y-4">
                <form onSubmit={handlePasswordSubmit} className="space-y-4">
                  <TelegramInput
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    className="w-full px-4 py-3 bg-secondary border border-border rounded-lg text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />

                  <TelegramButton
                    type="submit"
                    fullWidth
                    size="lg"
                    loading={isLoading}
                    disabled={!password.trim()}
                  >
                    Continue
                  </TelegramButton>
                </form>

                <div className="text-center space-y-2">
                  <button className="text-body text-link hover:underline">
                    Forgot password?
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 text-center">
        <p className="text-small text-muted-foreground">
          skybox {appVersion}
        </p>
      </div>
    </div>
  );
}
