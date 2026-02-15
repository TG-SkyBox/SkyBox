import { FileItem, getFileIcon, formatFileSize } from "./FileRow";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface FileGridProps {
    files: FileItem[];
    selectedFile: FileItem | null;
    onSelect: (file: FileItem) => void;
    onOpen: (file: FileItem) => void;
    onContextMenu: (e: React.MouseEvent, file: FileItem) => void;
}

export function FileGrid({ files, selectedFile, onSelect, onOpen, onContextMenu }: FileGridProps) {
    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {files.map((file) => (
                <FileGridItem
                    key={file.path}
                    file={file}
                    isSelected={selectedFile?.path === file.path}
                    onSelect={() => onSelect(file)}
                    onOpen={() => onOpen(file)}
                    onContextMenu={(e) => onContextMenu(e, file)}
                />
            ))}
        </div>
    );
}

interface FileGridItemProps {
    file: FileItem;
    isSelected: boolean;
    onSelect: () => void;
    onOpen: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
}

function FileGridItem({ file, isSelected, onSelect, onOpen, onContextMenu }: FileGridItemProps) {
    const [thumbUrl, setThumbUrl] = useState<string | undefined>(file.thumbnail);
    const Icon = getFileIcon(file);

    useEffect(() => {
        // If we have a messageId but no thumbnail, try to fetch it
        if (file.messageId && !thumbUrl) {
            const fetchThumb = async () => {
                try {
                    const result: string | null = await invoke("tg_get_message_thumbnail", { messageId: file.messageId });
                    if (result) {
                        setThumbUrl(result);
                    }
                } catch (e) {
                    console.error("Failed to fetch thumbnail for message:", file.messageId, e);
                }
            };
            fetchThumb();
        }
    }, [file.messageId, thumbUrl]);

    return (
        <div
            onClick={onSelect}
            onDoubleClick={onOpen}
            onContextMenu={onContextMenu}
            className={`group flex flex-col items-center p-3 rounded-xl cursor-pointer transition-all duration-200 border ${isSelected
                    ? "bg-sidebar-accent border-primary/30 shadow-lg shadow-primary/5"
                    : "hover:bg-sidebar-accent/50 border-transparent hover:border-border"
                }`}
        >
            <div className="w-full aspect-square mb-3 flex items-center justify-center rounded-lg overflow-hidden bg-secondary/30 group-hover:bg-secondary/50 transition-colors relative">
                {thumbUrl ? (
                    <img src={thumbUrl} alt={file.name} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                ) : (
                    <Icon
                        className={`w-12 h-12 transition-transform duration-200 group-hover:scale-110 ${file.isDirectory ? "text-primary" : "text-muted-foreground"
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
