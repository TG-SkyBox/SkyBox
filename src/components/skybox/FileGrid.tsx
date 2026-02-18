import { FileItem, getFileIcon, formatFileSize } from "./FileRow";
import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { resolveThumbnailSrc } from "@/lib/thumbnail-src";

interface FileGridProps {
    files: FileItem[];
    selectedFile: FileItem | null;
    onSelect: (file: FileItem) => void;
    onOpen: (file: FileItem) => void;
    onContextMenu: (e: React.MouseEvent, file: FileItem) => void;
    isDraggable?: (file: FileItem) => boolean;
    isDropTarget?: (file: FileItem) => boolean;
    onDragStart?: (e: React.DragEvent, file: FileItem) => void;
    onDragEnd?: (e: React.DragEvent, file: FileItem) => void;
    onDragOver?: (e: React.DragEvent, file: FileItem) => void;
    onDragLeave?: (e: React.DragEvent, file: FileItem) => void;
    onDrop?: (e: React.DragEvent, file: FileItem) => void;
    appendItems?: ReactNode;
}

export function FileGrid({
    files,
    selectedFile,
    onSelect,
    onOpen,
    onContextMenu,
    isDraggable,
    isDropTarget,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
    appendItems,
}: FileGridProps) {
    return (
        <div className="grid [grid-template-columns:repeat(auto-fill,minmax(8.75rem,8.75rem))] justify-start gap-3">
            {files.map((file) => (
                <FileGridItem
                    key={file.path}
                    file={file}
                    isSelected={selectedFile?.path === file.path}
                    onSelect={() => onSelect(file)}
                    onOpen={() => onOpen(file)}
                    onContextMenu={(e) => onContextMenu(e, file)}
                    draggable={isDraggable?.(file)}
                    isDropTarget={isDropTarget?.(file)}
                    onDragStart={(e) => onDragStart?.(e, file)}
                    onDragEnd={(e) => onDragEnd?.(e, file)}
                    onDragOver={(e) => onDragOver?.(e, file)}
                    onDragLeave={(e) => onDragLeave?.(e, file)}
                    onDrop={(e) => onDrop?.(e, file)}
                />
            ))}
            {appendItems}
        </div>
    );
}

interface FileGridItemProps {
    file: FileItem;
    isSelected: boolean;
    onSelect: () => void;
    onOpen: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
    draggable?: boolean;
    isDropTarget?: boolean;
    onDragStart?: (e: React.DragEvent) => void;
    onDragEnd?: (e: React.DragEvent) => void;
    onDragOver?: (e: React.DragEvent) => void;
    onDragLeave?: (e: React.DragEvent) => void;
    onDrop?: (e: React.DragEvent) => void;
}

function FileGridItem({
    file,
    isSelected,
    onSelect,
    onOpen,
    onContextMenu,
    draggable,
    isDropTarget,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
}: FileGridItemProps) {
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

    return (
        <div
            onClick={onSelect}
            onDoubleClick={onOpen}
            onContextMenu={onContextMenu}
            draggable={draggable}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`group flex flex-col items-center p-2 rounded-xl cursor-pointer transition-all duration-200 border ${isSelected
                    ? "bg-sidebar-accent border-primary/30 shadow-lg shadow-primary/5"
                    : "hover:bg-sidebar-accent/50 border-transparent hover:border-border"
                } ${isDropTarget ? "ring-1 ring-primary/60 bg-primary/10" : ""}`}
        >
            <div className="w-full max-w-24 max-h-24 aspect-square mb-3 mx-auto flex items-center justify-center rounded-lg overflow-hidden bg-secondary/30 group-hover:bg-secondary/50 transition-colors relative">
                {thumbUrl ? (
                    <img
                        src={thumbUrl}
                        alt={file.name}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        onError={() => {
                            void refetchThumbnail();
                        }}
                    />
                ) : (
                    <Icon
                        className={`w-10 h-10 transition-transform duration-200 group-hover:scale-110 ${file.isDirectory ? "text-primary" : "text-muted-foreground"
                            }`}
                    />
                )}

                {/* Overlay for directories or media indicators */}
                {file.isDirectory && (
                    <div className="absolute inset-0 bg-primary/5 pointer-events-none" />
                )}
            </div>

            <div className="w-full text-center">
                <p className="text-body font-medium text-foreground truncate w-full px-1" title={file.name}>
                    {file.name}
                </p>
                {!file.isDirectory && (
                    <p className="text-small text-muted-foreground mt-0.5">
                        {formatFileSize(file.size)}
                    </p>
                )}
            </div>
        </div>
    );
}
