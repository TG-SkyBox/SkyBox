import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { logger } from "./lib/logger.ts";

logger.info("Starting Telegram Desktop");

createRoot(document.getElementById("root")!).render(<App />);
