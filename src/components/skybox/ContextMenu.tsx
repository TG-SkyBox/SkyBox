import { forwardRef, useEffect } from "react";
import { 
  FolderPlus, 
  ClipboardPaste, 
  RotateCcw, 
  Trash2, 
  Copy, 
  Edit3, 
  Share, 
  FileText, 
  Info, 
  ArrowDownToLine 
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { FileItem } from "@/components/skybox/FileRow";

interface ContextMenuState {
  x: number;
  y: number;
  targetFile: FileItem | null;
  isEmptyArea: boolean;
}

interface ContextMenuProps {
  contextMenuState: ContextMenuState | null;
  selectedPaths: string[];
  clipboardItem: { path: string; name: string; mode: "copy" | "cut"; isDirectory: boolean } | null;
  favorites: string[];
  currentPath: string;
  isRecycleBinView: boolean;
  isNotesFolderView: boolean;
  isNotesMessageContextMenu: boolean;
  isMultiSelectionContextMenu: boolean;
  contextTargetFile: FileItem | null;
  canPasteInCurrentPath: boolean;
  onClose: () => void;
  onOpen: (file: FileItem) => void;
  onDelete: (file: FileItem) => void;
  onDetails: (file: FileItem) => void;
  onCopyPath: (file: FileItem) => void;
  onToggleFavorite: (file: FileItem) => void;
  onRename: (file: FileItem) => void;
  onNewFolder: () => void;
  onPaste: () => void;
  onShare: (file: FileItem) => void;
  onDownload: (file: FileItem) => void;
  onCopyNoteText: (file: FileItem) => void;
  onEditNoteMessage: (file: FileItem) => void;
  onRestoreFromRecycleBin: (file: FileItem) => void;
  onCopy: (file: FileItem) => void;
  onCut: (file: FileItem) => void;
}

const contextMenuItemClassName = "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-body text-foreground transition-colors hover:bg-primary/15 outline-none focus-visible:outline-none";
const contextMenuDisabledItemClassName = "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-body text-muted-foreground/60 pointer-events-none outline-none focus-visible:outline-none";
const contextMenuDangerItemClassName = "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-body text-destructive transition-colors hover:bg-destructive/10 outline-none focus-visible:outline-none";

export const ContextMenu = forwardRef<HTMLDivElement, ContextMenuProps>(
  function ContextMenu({
    contextMenuState,
    selectedPaths,
    clipboardItem,
    favorites,
    currentPath,
    isRecycleBinView,
    isNotesFolderView,
    isNotesMessageContextMenu,
    isMultiSelectionContextMenu,
    contextTargetFile,
    canPasteInCurrentPath,
    onClose,
    onOpen,
    onDelete,
    onDetails,
    onCopyPath,
    onToggleFavorite,
    onRename,
    onNewFolder,
    onPaste,
    onShare,
    onDownload,
    onCopyNoteText,
    onEditNoteMessage,
    onRestoreFromRecycleBin,
    onCopy,
    onCut,
  }, ref) {
    const { toast } = useToast();

    useEffect(() => {
      if (!contextMenuState) {
        return;
      }

      const handlePointerDown = (event: MouseEvent) => {
        const target = event.target as Node | null;
        if (ref && (ref as React.RefObject<HTMLDivElement>).current && target && (ref as React.RefObject<HTMLDivElement>).current.contains(target)) {
          return;
        }
        onClose();
      };

      const handleEscape = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          onClose();
        }
      };

      const handleViewportChange = () => {
        onClose();
      };

      window.addEventListener("mousedown", handlePointerDown, true);
      window.addEventListener("keydown", handleEscape);
      window.addEventListener("scroll", handleViewportChange, true);
      window.addEventListener("blur", handleViewportChange);

      return () => {
        window.removeEventListener("mousedown", handlePointerDown, true);
        window.removeEventListener("keydown", handleEscape);
        window.removeEventListener("scroll", handleViewportChange, true);
        window.removeEventListener("blur", handleViewportChange);
      };
    }, [contextMenuState, onClose, ref]);

    if (!contextMenuState) {
      return null;
    }

    const isFavorite = contextTargetFile ? favorites.includes(contextTargetFile.path) : false;
    const menuWidth = 220;
    const menuHeight = 300;
    const clampedX = Math.max(8, Math.min(contextMenuState.x, window.innerWidth - menuWidth - 8));
    const clampedY = Math.max(8, Math.min(contextMenuState.y, window.innerHeight - menuHeight - 8));

    return (
      <div
        ref={ref}
        className="fixed z-[80] min-w-[220px] rounded-xl bg-glass shadow-2xl shadow-black/50 backdrop-saturate-150 p-1"
        style={{ left: `${clampedX}px`, top: `${clampedY}px` }}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        {contextMenuState.isEmptyArea ? (
          <>
            <button
              className={contextMenuItemClassName}
              onClick={() => {
                onClose();
                onNewFolder();
              }}
            >
              <FolderPlus className="w-4 h-4 text-muted-foreground" />
              <span>New Folder</span>
            </button>
            <button
              className={canPasteInCurrentPath ? contextMenuItemClassName : contextMenuDisabledItemClassName}
              disabled={!canPasteInCurrentPath}
              onClick={() => {
                if (!canPasteInCurrentPath) {
                  return;
                }
                onClose();
                onPaste();
              }}
            >
              <ClipboardPaste className="w-4 h-4 text-muted-foreground" />
              <span>Paste</span>
            </button>
          </>
        ) : isRecycleBinView ? (
          <>
            <button
              className={contextMenuItemClassName}
              onClick={() => {
                onClose();
                onRestoreFromRecycleBin(contextTargetFile!);
              }}
            >
              <RotateCcw className="w-4 h-4 text-muted-foreground" />
              <span>Restore</span>
            </button>

            <div className="my-1 h-px bg-border/70" />

            <button
              className={contextMenuDangerItemClassName}
              onClick={() => {
                onClose();
                onDelete(contextTargetFile!);
              }}
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete</span>
            </button>
          </>
        ) : isNotesMessageContextMenu ? (
          <>
            <button
              className={contextMenuItemClassName}
              onClick={() => {
                onClose();
                onCopyNoteText(contextTargetFile!);
              }}
            >
              <Copy className="w-4 h-4 text-muted-foreground" />
              <span>Copy as text</span>
            </button>

            <button
              className={contextMenuItemClassName}
              onClick={() => {
                onClose();
                onEditNoteMessage(contextTargetFile!);
              }}
            >
              <Edit3 className="w-4 h-4 text-muted-foreground" />
              <span>Edit</span>
            </button>
          </>
        ) : isMultiSelectionContextMenu ? (
          <>
            <button
              className={contextMenuItemClassName}
              onClick={() => {
                onClose();
                onShare(contextTargetFile!);
              }}
            >
              <Share className="w-4 h-4 text-muted-foreground" />
              <span>Share</span>
            </button>

            <button
              className={contextMenuDangerItemClassName}
              onClick={() => {
                onClose();
                onDelete(contextTargetFile!);
              }}
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete</span>
            </button>
          </>
        ) : (
          <>
            <button
              className={contextMenuItemClassName}
              onClick={() => {
                onClose();
                onOpen(contextTargetFile!);
              }}
            >
              <FileText className="w-4 h-4 text-muted-foreground" />
              <span>Open</span>
            </button>

            <button
              className={contextMenuItemClassName}
              onClick={() => {
                onClose();
                onDownload(contextTargetFile!);
              }}
            >
              <ArrowDownToLine className="w-4 h-4 text-muted-foreground" />
              <span>Download</span>
            </button>

            <button
              className={contextMenuItemClassName}
              onClick={() => {
                onClose();
                onShare(contextTargetFile!);
              }}
            >
              <Share className="w-4 h-4 text-muted-foreground" />
              <span>Share</span>
            </button>

            <button
              className={contextMenuItemClassName}
              onClick={() => {
                onClose();
                onCopy(contextTargetFile!);
              }}
            >
              <Copy className="w-4 h-4 text-muted-foreground" />
              <span>Copy</span>
            </button>

            <button
              className={contextMenuItemClassName}
              onClick={() => {
                onClose();
                onCut(contextTargetFile!);
              }}
            >
              <Copy className="w-4 h-4 text-muted-foreground" />
              <span>Cut</span>
            </button>

            <button
              className={contextMenuItemClassName}
              onClick={() => {
                onClose();
                onRename(contextTargetFile!);
              }}
            >
              <Edit3 className="w-4 h-4 text-muted-foreground" />
              <span>Rename</span>
            </button>

            <button
              className={contextMenuDangerItemClassName}
              onClick={() => {
                onClose();
                onDelete(contextTargetFile!);
              }}
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete</span>
            </button>

            <button
              className={contextMenuItemClassName}
              onClick={() => {
                onClose();
                onDetails(contextTargetFile!);
              }}
            >
              <Info className="w-4 h-4 text-muted-foreground" />
              <span>Details</span>
            </button>


          </>
        )}
      </div>
    );
  },
);

ContextMenu.displayName = "ContextMenu";