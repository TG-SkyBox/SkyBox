import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";

import { logger } from "../lib/logger";

interface Session {
  id: number;
  phone: string;
  session_data?: string;
  created_at: string;
}

interface TelegramAuthResult {
  authorized: boolean;
  session_data?: string;
  user_info?: UserInfo;
  requires_password: boolean;
}

interface UserInfo {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  profile_photo?: string;
}

export default function LoadingPage() {
  const navigate = useNavigate();
  const [appVersion, setAppVersion] = useState<string>("...");

  useEffect(() => {
    let cancelled = false;

    const loadAppVersion = async () => {
      try {
        const version = await getVersion();
        if (!cancelled) {
          setAppVersion(version);
        }
      } catch (error) {
        logger.warn(`LoadingPage: Failed to read app version: ${JSON.stringify(error)}`);
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

  useEffect(() => {
    const checkLoginStatus = async () => {
      logger.info("LoadingPage: Checking login status on mount");

      try {
        const session: Session | null = await invoke("db_get_session");
        logger.info(`LoadingPage: Retrieved session from DB: ${session ? JSON.stringify(session.phone) : 'null'}`);

        if (session && session.session_data) {
          logger.info("LoadingPage: Session exists with data, attempting to restore");

          try {
            const result: TelegramAuthResult = await invoke("tg_restore_session", {
              sessionData: session.session_data
            });
            logger.info("LoadingPage: tg_restore_session result:", result);

            if (result.authorized && result.user_info) {
              logger.info("LoadingPage: Session is valid, navigating to explorer");
              navigate("/explorer", { state: { userInfo: result.user_info } });
              return;
            } else {
              logger.info("LoadingPage: Session not authorized, redirecting to login");
            }
          } catch (restoreError) {
            logger.error(`LoadingPage: Could not restore session: ${JSON.stringify(restoreError)}`);
          }
        } else {
          logger.info("LoadingPage: No session found or no session data, redirecting to login");
        }

        // Redirect to login if no valid session found
        navigate("/login");
      } catch (error) {
        logger.error("LoadingPage: Error checking login status:", error);
        // In case of error, redirect to login
        navigate("/login");
      }
    };

    // Small delay to show the loading screen
    const timer = setTimeout(checkLoginStatus, 1000);

    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar - empty for consistent layout */}
      <div className="flex items-center justify-between p-4">
        <div className="w-10"></div>
        <div className="text-body text-link hover:underline opacity-0 pointer-events-none">
          Proxy Settings
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="flex flex-col items-center">
          {/* Telegram Logo with animation */}
          {/* App Logo */}
          <div className="w-32 h-32 mb-8 flex items-center justify-center animate-pulse">
            <img src="icons/icon.png" alt="SkyBox Logo" className="w-full h-full object-contain" />
          </div>

          {/* Loading text */}
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Loading...
          </h1>
          <p className="text-body text-muted-foreground text-center">
            Checking your session
          </p>
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
