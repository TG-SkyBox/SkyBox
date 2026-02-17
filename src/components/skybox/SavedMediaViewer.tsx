import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import Plyr from "plyr";
import "plyr/dist/plyr.css";
import { TelegramButton } from "./TelegramButton";

export type SavedMediaKind = "image" | "video" | "audio";

interface SavedMediaViewerProps {
  isOpen: boolean;
  fileName: string;
  mediaKind: SavedMediaKind | null;
  mediaSrc?: string | null;
  isLoading: boolean;
  error?: string | null;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}

interface PlyrMediaProps {
  kind: "video" | "audio";
  src: string;
}

function PlyrMedia({ kind, src }: PlyrMediaProps) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const playerRef = useRef<Plyr | null>(null);

  useEffect(() => {
    const target = mediaRef.current;
    if (!target) {
      return;
    }

    const controls = kind === "video"
      ? ["play-large", "play", "progress", "current-time", "mute", "volume", "settings", "pip", "fullscreen"]
      : ["play", "progress", "current-time", "mute", "volume", "settings"];

    const player = new Plyr(target, {
      controls,
      resetOnEnd: false,
      keyboard: { focused: true, global: true },
    });

    playerRef.current = player;

    return () => {
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [kind, src]);

  if (kind === "video") {
    return (
      <video
        key={src}
        ref={mediaRef as MutableRefObject<HTMLVideoElement | null>}
        className="h-full w-full"
        playsInline
        controls
      >
        <source src={src} />
      </video>
    );
  }

  return (
    <audio
      key={src}
      ref={mediaRef as MutableRefObject<HTMLAudioElement | null>}
      className="w-full"
      controls
    >
      <source src={src} />
    </audio>
  );
}

export function SavedMediaViewer({
  isOpen,
  fileName,
  mediaKind,
  mediaSrc,
  isLoading,
  error,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
  onClose,
}: SavedMediaViewerProps) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }

      if (event.key === "ArrowLeft" && canGoPrevious) {
        event.preventDefault();
        onPrevious();
      }

      if (event.key === "ArrowRight" && canGoNext) {
        event.preventDefault();
        onNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [canGoNext, canGoPrevious, isOpen, onClose, onNext, onPrevious]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[94] bg-black/80 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative z-[95] h-full w-full p-4 sm:p-6">
        <div className="mx-auto flex h-full max-w-6xl flex-col rounded-2xl bg-glass shadow-2xl shadow-black/60">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <p className="truncate text-body font-medium text-foreground">{fileName}</p>
            <button
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
              onClick={onClose}
              aria-label="Close media viewer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4 sm:p-6">
            {isLoading && (
              <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-body">Loading media...</p>
              </div>
            )}

            {!isLoading && error && (
              <div className="text-center">
                <p className="text-body text-destructive">{error}</p>
              </div>
            )}

            {!isLoading && !error && mediaSrc && mediaKind === "image" && (
              <img
                src={mediaSrc}
                alt={fileName}
                className="max-h-full max-w-full object-contain rounded-lg"
              />
            )}

            {!isLoading && !error && mediaSrc && (mediaKind === "video" || mediaKind === "audio") && (
              <div className={`w-full ${mediaKind === "video" ? "h-full" : "max-w-2xl"}`}>
                <PlyrMedia kind={mediaKind} src={mediaSrc} />
              </div>
            )}
          </div>

          {mediaKind === "image" && (
            <div className="flex items-center justify-center gap-3 border-t border-border/60 px-4 py-3">
              <TelegramButton
                variant="secondary"
                onClick={onPrevious}
                disabled={!canGoPrevious}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </TelegramButton>
              <TelegramButton
                variant="secondary"
                onClick={onNext}
                disabled={!canGoNext}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </TelegramButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
