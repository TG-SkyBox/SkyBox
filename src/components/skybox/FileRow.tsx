import {
  Folder,
  File,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileCode,
  FileArchive,
  FileSpreadsheet,
} from "lucide-react";
import { LucideIcon } from "lucide-react";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { resolveThumbnailSrc } from "@/lib/thumbnail-src";

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: string;
  extension?: string;
  messageId?: number;
  thumbnail?: string;
  noteText?: string;
  isNoteMessage?: boolean;
}

interface FileRowProps {
  file: FileItem;
  isSelected?: boolean;
  isCutItem?: boolean;
  onSelect?: () => void;
  onOpen?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  isDropTarget?: boolean;
}

const getFileIcon = (file: FileItem): LucideIcon => {
  if (file.isDirectory) return Folder;

  const ext = file.extension?.toLowerCase() || file.name.split(".").pop()?.toLowerCase();

  const iconMap: Record<string, LucideIcon> = {
    // Images
    jpg: FileImage,
    jpeg: FileImage,
    png: FileImage,
    gif: FileImage,
    webp: FileImage,
    svg: FileImage,
    bmp: FileImage,
    ico: FileImage,
    // Videos
    mp4: FileVideo,
    mkv: FileVideo,
    avi: FileVideo,
    mov: FileVideo,
    wmv: FileVideo,
    webm: FileVideo,
    // Audio
    mp3: FileAudio,
    wav: FileAudio,
    flac: FileAudio,
    aac: FileAudio,
    ogg: FileAudio,
    // Code
    js: FileCode,
    ts: FileCode,
    jsx: FileCode,
    tsx: FileCode,
    html: FileCode,
    css: FileCode,
    scss: FileCode,
    json: FileCode,
    xml: FileCode,
    py: FileCode,
    rs: FileCode,
    go: FileCode,
    java: FileCode,
    cpp: FileCode,
    c: FileCode,
    h: FileCode,
    // Archives
    zip: FileArchive,
    rar: FileArchive,
    "7z": FileArchive,
    tar: FileArchive,
    gz: FileArchive,
    // Spreadsheets
    xlsx: FileSpreadsheet,
    xls: FileSpreadsheet,
    csv: FileSpreadsheet,
    // Documents
    txt: FileText,
    md: FileText,
    pdf: FileText,
    doc: FileText,
    docx: FileText,
  };

  return iconMap[ext || ""] || File;
};

const formatFileSize = (bytes?: number): string => {
  if (bytes === undefined) return "—";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const formatDate = (dateStr?: string): string => {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: "short" });
  } else {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
};

export function FileRow({
  file,
  isSelected,
  isCutItem,
  onSelect,
  onOpen,
  onContextMenu,
  draggable,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  isDropTarget,
}: FileRowProps) {
  const [thumbUrl, setThumbUrl] = useState<string | undefined>(resolveThumbnailSrc(file.thumbnail));
  const [hasRetriedBrokenThumbnail, setHasRetriedBrokenThumbnail] = useState(false);
  const Icon = getFileIcon(file);

  useEffect(() => {
    setThumbUrl(resolveThumbnailSrc(file.thumbnail));
    setHasRetriedBrokenThumbnail(false);
  }, [file.messageId, file.thumbnail]);

  const refetchThumbnail = async () => {
    if (!file.messageId) {
      setThumbUrl(undefined);
      return;
    }

    if (hasRetriedBrokenThumbnail) {
      setThumbUrl(undefined);
      return;
    }

    setHasRetriedBrokenThumbnail(true);

    try {
      const result: string | null = await invoke("tg_get_message_thumbnail", { messageId: file.messageId });
      const resolved = resolveThumbnailSrc(result);
      if (resolved) {
        setThumbUrl(resolved);
        return;
      }
    } catch (e) {
      console.error("Failed to refetch missing thumbnail for message:", file.messageId, e);
    }

    setThumbUrl(undefined);
  };

  if (file.isNoteMessage) {
    return (
      <div
        data-file-item="true"
        data-file-path={file.path}
        onClick={onSelect}
        onDoubleClick={onOpen}
        onContextMenu={onContextMenu}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`px-2 py-1 rounded-lg cursor-pointer transition-all duration-150 ${isSelected ? "bg-sidebar-accent/55" : "hover:bg-sidebar-accent/35"
          } ${isDropTarget ? "ring-1 ring-primary/60 bg-primary/10" : ""} ${isCutItem ? "opacity-50 grayscale" : ""}`}
      >
        <div className="ml-auto max-w-[86%] rounded-2xl rounded-br-md border border-border/70 bg-secondary/35 px-3 py-2 shadow-sm shadow-black/20">
          <p className="text-body text-foreground whitespace-pre-wrap break-words leading-5">
            {file.noteText || file.name}
          </p>
          <p className="mt-1 text-small text-muted-foreground/90 text-right">
            {formatDate(file.modifiedAt)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-file-item="true"
      data-file-path={file.path}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`flex items-center gap-3 px-3 py-1 rounded-lg cursor-pointer transition-all duration-150 ${isSelected ? "bg-sidebar-accent text-foreground" : "hover:bg-sidebar-accent/50"
        } ${isDropTarget ? "ring-1 ring-primary/60 bg-primary/10" : ""} ${isCutItem ? "opacity-50 grayscale" : ""}`}
    >
      <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-md overflow-hidden bg-secondary/50">
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={file.name}
            className="w-5 h-5 rounded-sm object-cover"
            onError={() => {
              void refetchThumbnail();
            }}
          />
        ) : (
          <Icon
            className={`w-5 h-5 ${file.isDirectory ? "text-primary" : "text-muted-foreground"
              }`}
          />
        )}
      </div>
      <span className="flex-1 text-body text-foreground truncate">{file.name}</span>
      {!file.isDirectory && (
        <span className="text-small text-muted-foreground">{formatFileSize(file.size)}</span>
      )}
      <span className="text-small text-muted-foreground w-20 text-right">
        {formatDate(file.modifiedAt)}
      </span>
    </div>
  );
}

export { formatFileSize, formatDate, getFileIcon };
