import { FileItem, formatFileSize, formatDate } from "./FileRow";
import {
  Folder,
  File,
  FileText,
  FileImage,
  X,
  Star,
  Copy,
  ExternalLink,
  Trash2,
  Edit2,
} from "lucide-react";
import { TelegramButton } from "./TelegramButton";
import { resolveThumbnailSrc } from "@/lib/thumbnail-src";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface DetailsPanelProps {
  file: FileItem | null;
  onClose: () => void;
  onToggleFavorite?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onCopyPath?: () => void;
  onOpenLocation?: () => void;
  isFavorite?: boolean;
}

export function DetailsPanel({
  file,
  onClose,
  onToggleFavorite,
  onRename,
  onDelete,
  onCopyPath,
  onOpenLocation,
  isFavorite = false,
}: DetailsPanelProps) {
  const [previewThumb, setPreviewThumb] = useState<string | undefined>(
    resolveThumbnailSrc(file?.thumbnail),
  );
  const [hasRetriedBrokenThumbnail, setHasRetriedBrokenThumbnail] =
    useState(false);

  useEffect(() => {
    setPreviewThumb(resolveThumbnailSrc(file?.thumbnail));
    setHasRetriedBrokenThumbnail(false);
  }, [file?.messageId, file?.thumbnail]);

  useEffect(() => {
    const messageId = file?.messageId;
    if (!messageId || previewThumb || hasRetriedBrokenThumbnail) {
      return;
    }

    setHasRetriedBrokenThumbnail(true);

    const fetchThumbnail = async () => {
      try {
        const result: string | null = await invoke("tg_get_message_thumbnail", {
          messageId,
        });
        const resolved = resolveThumbnailSrc(result);
        if (resolved) {
          setPreviewThumb(resolved);
        }
      } catch (e) {
        console.error("Failed to fetch thumbnail for message:", messageId, e);
      }
    };

    void fetchThumbnail();
  }, [file?.messageId, hasRetriedBrokenThumbnail, previewThumb]);

  const refetchThumbnail = async () => {
    const messageId = file?.messageId;
    if (!messageId) {
      setPreviewThumb(undefined);
      return;
    }

    if (hasRetriedBrokenThumbnail) {
      setPreviewThumb(undefined);
      return;
    }

    setHasRetriedBrokenThumbnail(true);

    try {
      const result: string | null = await invoke("tg_get_message_thumbnail", {
        messageId,
      });
      const resolved = resolveThumbnailSrc(result);
      if (resolved) {
        setPreviewThumb(resolved);
        return;
      }
    } catch (e) {
      console.error(
        "Failed to refetch missing thumbnail for message:",
        messageId,
        e,
      );
    }

    setPreviewThumb(undefined);
  };

  if (!file) {
    return (
      <div className="w-full h-full glass-sidebar flex flex-col items-center justify-center p-6">
        <File className="w-12 h-12 text-muted-foreground/50 mb-3" />
        <p className="text-body text-muted-foreground text-center">
          Select a file or folder to view details
        </p>
      </div>
    );
  }

  const Icon = file.isDirectory
    ? Folder
    : file.extension?.match(/^(jpg|jpeg|png|gif|webp|svg)$/i)
      ? FileImage
      : FileText;

  return (
    <div className="w-full h-full glass-sidebar flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="text-body font-medium text-foreground">Details</h2>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-secondary transition-colors"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* Preview area */}
      <div className="p-6 border-b border-border flex flex-col items-center">
        <div className="w-48 h-48 rounded-lg bg-secondary flex items-center justify-center mb-4 overflow-hidden border border-border/50 shadow-sm transition-all">
          {previewThumb ? (
            <img
              src={previewThumb}
              alt={file.name}
              className="w-full h-full object-cover animate-in fade-in zoom-in-95 duration-300"
              onError={() => {
                void refetchThumbnail();
              }}
            />
          ) : (
            <Icon
              className={`w-20 h-20 ${
                file.isDirectory ? "text-primary" : "text-muted-foreground"
              }`}
            />
          )}
        </div>
        <h3 className="text-body font-medium text-foreground text-center break-all">
          {file.name}
        </h3>
        <p className="text-small text-muted-foreground mt-1">
          {file.isDirectory
            ? "Folder"
            : file.extension?.toUpperCase() || "File"}
        </p>
      </div>

      {/* Metadata */}
      <div className="p-4 space-y-3 flex-1 overflow-y-auto">
        {!file.isDirectory && file.size !== undefined && (
          <div>
            <p className="text-small text-muted-foreground">Size</p>
            <p className="text-body text-foreground">
              {formatFileSize(file.size)}
            </p>
          </div>
        )}
        {file.modifiedAt && (
          <div>
            <p className="text-small text-muted-foreground">Modified</p>
            <p className="text-body text-foreground">
              {new Date(file.modifiedAt).toLocaleString()}
            </p>
          </div>
        )}
        <div>
          <p className="text-small text-muted-foreground">Path</p>
          <p className="text-small text-foreground break-all">{file.path}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-border space-y-2">
        <div className="flex gap-2">
          <TelegramButton
            variant="secondary"
            size="sm"
            onClick={onToggleFavorite}
            className="flex-1"
          >
            <Star
              className={`w-4 h-4 ${isFavorite ? "fill-primary text-primary" : ""}`}
            />
            {isFavorite ? "Unfavorite" : "Favorite"}
          </TelegramButton>
          <TelegramButton variant="secondary" size="sm" onClick={onCopyPath}>
            <Copy className="w-4 h-4" />
          </TelegramButton>
        </div>
        <div className="flex gap-2">
          <TelegramButton
            variant="secondary"
            size="sm"
            onClick={onRename}
            className="flex-1"
          >
            <Edit2 className="w-4 h-4" />
            Rename
          </TelegramButton>
          <TelegramButton
            variant="secondary"
            size="sm"
            onClick={onOpenLocation}
          >
            <ExternalLink className="w-4 h-4" />
          </TelegramButton>
        </div>
        <TelegramButton variant="danger" size="sm" onClick={onDelete} fullWidth>
          <Trash2 className="w-4 h-4" />
          Delete
        </TelegramButton>
      </div>
    </div>
  );
}
