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
import { convertFileSrc } from "@tauri-apps/api/core";

const resolveThumbnailSrc = (thumbnail?: string | null): string | undefined => {
  if (!thumbnail) {
    return undefined;
  }

  if (
    thumbnail.startsWith("data:") ||
    thumbnail.startsWith("http://") ||
    thumbnail.startsWith("https://") ||
    thumbnail.startsWith("asset://") ||
    thumbnail.startsWith("tauri://") ||
    thumbnail.startsWith("asset:") ||
    thumbnail.startsWith("blob:")
  ) {
    return thumbnail;
  }

  const normalizedPath = thumbnail.replace(/\\/g, "/");

  try {
    const converted = convertFileSrc(normalizedPath);
    if (
      converted.startsWith("http://") ||
      converted.startsWith("https://") ||
      converted.startsWith("asset://") ||
      converted.startsWith("tauri://")
    ) {
      return converted;
    }
  } catch (error) {
    console.warn("convertFileSrc failed for thumbnail path", normalizedPath, error);
  }

  return `http://asset.localhost/${encodeURIComponent(normalizedPath)}`;
};

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
  if (!file) {
    return (
      <div className="w-72 h-full glass-sidebar flex flex-col items-center justify-center p-6">
        <File className="w-12 h-12 text-muted-foreground/50 mb-3" />
        <p className="text-body text-muted-foreground text-center">
          Select a file or folder to view details
        </p>
      </div>
    );
  }

  const Icon = file.isDirectory ? Folder : file.extension?.match(/^(jpg|jpeg|png|gif|webp|svg)$/i) ? FileImage : FileText;

  return (
    <div className="w-72 h-full glass-sidebar flex flex-col animate-slide-in-left">
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
          {file.thumbnail ? (
            <img
              src={resolveThumbnailSrc(file.thumbnail)}
              alt={file.name}
              className="w-full h-full object-cover animate-in fade-in zoom-in-95 duration-300"
            />
          ) : (
            <Icon
              className={`w-20 h-20 ${file.isDirectory ? "text-primary" : "text-muted-foreground"
                }`}
            />
          )}
        </div>
        <h3 className="text-body font-medium text-foreground text-center break-all">
          {file.name}
        </h3>
        <p className="text-small text-muted-foreground mt-1">
          {file.isDirectory ? "Folder" : file.extension?.toUpperCase() || "File"}
        </p>
      </div>

      {/* Metadata */}
      <div className="p-4 space-y-3 flex-1 overflow-y-auto">
        {!file.isDirectory && file.size !== undefined && (
          <div>
            <p className="text-small text-muted-foreground">Size</p>
            <p className="text-body text-foreground">{formatFileSize(file.size)}</p>
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
            <Star className={`w-4 h-4 ${isFavorite ? "fill-primary text-primary" : ""}`} />
            {isFavorite ? "Unfavorite" : "Favorite"}
          </TelegramButton>
          <TelegramButton variant="secondary" size="sm" onClick={onCopyPath}>
            <Copy className="w-4 h-4" />
          </TelegramButton>
        </div>
        <div className="flex gap-2">
          <TelegramButton variant="secondary" size="sm" onClick={onRename} className="flex-1">
            <Edit2 className="w-4 h-4" />
            Rename
          </TelegramButton>
          <TelegramButton variant="secondary" size="sm" onClick={onOpenLocation}>
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
