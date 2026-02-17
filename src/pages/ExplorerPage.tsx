import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { ExplorerSidebar } from "@/components/skybox/ExplorerSidebar";
import { SearchBar } from "@/components/skybox/SearchBar";
import { Breadcrumbs } from "@/components/skybox/Breadcrumbs";
import { FileRow, FileItem } from "@/components/skybox/FileRow";
import { FileGrid } from "@/components/skybox/FileGrid";
import { DetailsPanel } from "@/components/skybox/DetailsPanel";
import { ConfirmDialog } from "@/components/skybox/ConfirmDialog";
import { TextInputDialog } from "@/components/skybox/TextInputDialog";
import { TelegramButton } from "@/components/skybox/TelegramButton";
import {
  FolderPlus,
  Grid,
  List,
  SortAsc,
  RefreshCw,
  Download,
  Copy,
  Trash2,
  RotateCcw,
  Edit3,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Share2,
  Info,
  Scissors,
  ClipboardPaste,
} from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { invoke } from "@tauri-apps/api/core";
import { resolveThumbnailSrc } from "@/lib/thumbnail-src";

interface FsError {
  message: string;
}

interface DbError {
  message: string;
}

interface TelegramError {
  message: string;
}

// Define the FileEntry type to match the Rust struct
interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  size?: number;
  modified_at?: string;
  extension?: string;
}

interface RecentPath {
  id: number;
  path: string;
  last_opened: string;
}

interface Favorite {
  id: number;
  path: string;
  label: string;
}

interface Session {
  id: number;
  phone: string;
  session_data?: string;
  created_at: string;
}

interface TelegramAuthResult {
  authorized: boolean;
  session_data?: string;
  user_info?: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
    profile_photo?: string;
  };
  requires_password: boolean;
}

// Define the user info type
interface UserInfo {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  profile_photo?: string;
}

interface TelegramMessage {
  message_id: number;
  chat_id: number;
  category: string;
  filename?: string;
  extension?: string;
  mime_type?: string;
  timestamp: string;
  size?: number;
  text?: string;
  thumbnail?: string;
  file_reference: string;
}

interface TelegramSavedItem {
  chat_id: number;
  message_id: number;
  thumbnail?: string;
  file_type: string;
  file_unique_id: string;
  file_size: number;
  file_name: string;
  file_caption?: string;
  file_path: string;
  modified_date: string;
  owner_id: string;
}

interface TelegramSavedItemsPage {
  items: TelegramSavedItem[];
  has_more: boolean;
  next_offset: number;
}

interface TelegramIndexSavedMessagesResult {
  total_new_messages: number;
  started_from_empty_db?: boolean;
}

interface SavedPathCacheEntry {
  items: FileItem[];
  nextOffset: number;
  hasMore: boolean;
  isCompleteSnapshot: boolean;
}

type ExplorerViewMode = "list" | "grid";
type ClipboardMode = "copy" | "cut";

interface ExplorerClipboardItem {
  path: string;
  name: string;
  isDirectory: boolean;
  mode: ClipboardMode;
}

interface ExplorerContextMenuState {
  x: number;
  y: number;
  targetFile: FileItem | null;
  isEmptyArea: boolean;
}

// Convert Rust FileEntry to our FileItem type
const convertFileEntryToFileItem = (entry: FileEntry): FileItem => {
  return {
    name: entry.name,
    path: entry.path,
    isDirectory: entry.is_directory,
    size: entry.size,
    modifiedAt: entry.modified_at,
    extension: entry.extension,
  };
};

const mockRoots = [
  { id: "1", path: "/home/user", name: "Home" },
  { id: "2", path: "/media/external", name: "External Drive" },
];

const INTERNAL_DRAG_MIME = "application/x-skybox-item-path";
const SAVED_ITEMS_PAGE_SIZE = 50;
const EXPLORER_VIEW_MODE_KEY = "explorer_view_mode";
const RECYCLE_BIN_VIRTUAL_PATH = "tg://saved/Recycle Bin";
const DETAILS_PANEL_ANIMATION_MS = 220;

const isVirtualPath = (path: string): boolean => path.startsWith("tg://");
const isSavedVirtualFolderPath = (path: string): boolean => path === "tg://saved" || path.startsWith("tg://saved/");
const isSavedVirtualFilePath = (path: string): boolean => path.startsWith("tg://msg/");
const isSavedVirtualItemPath = (path: string): boolean => isSavedVirtualFolderPath(path) || isSavedVirtualFilePath(path);
const isRecycleBinPath = (path: string): boolean => (
  path === RECYCLE_BIN_VIRTUAL_PATH || path.startsWith(`${RECYCLE_BIN_VIRTUAL_PATH}/`)
);

const normalizePath = (path: string): string => path.replace(/\\/g, "/");

const getPathName = (path: string): string => {
  const normalized = normalizePath(path).replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalized;
};

const getParentPath = (path: string): string => {
  const normalized = normalizePath(path).replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) {
    return "";
  }

  return normalized.slice(0, index);
};

const joinPath = (base: string, name: string): string => {
  const normalizedBase = normalizePath(base).replace(/\/+$/, "");
  if (!normalizedBase) {
    return name;
  }

  return `${normalizedBase}/${name}`;
};

const isTextInputElement = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;
  return (
    target.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  );
};

const extensionFromFileName = (fileName: string): string | undefined => {
  const parts = fileName.split(".");
  if (parts.length < 2) {
    return undefined;
  }

  return parts[parts.length - 1]?.toLowerCase();
};

const virtualToSavedPath = (virtualPath: string): string => {
  if (virtualPath === "tg://saved") {
    return "/Home";
  }

  const relativePath = virtualPath.replace(/^tg:\/\/saved\/?/, "").replace(/\/+$/, "");
  return relativePath ? `/Home/${relativePath}` : "/Home";
};

const savedToVirtualPath = (savedPath: string): string => {
  const normalized = normalizePath(savedPath).replace(/\/+$/, "");
  if (normalized === "/Home") {
    return "tg://saved";
  }

  if (normalized.startsWith("/Home/")) {
    return `tg://saved/${normalized.slice(6)}`;
  }

  return "tg://saved";
};

const savedItemToFileItem = (item: TelegramSavedItem): FileItem => {
  const resolvedName = item.file_name?.trim()
    ? item.file_name
    : (["image", "video", "audio"].includes(item.file_type)
      ? `${item.file_type}_${item.file_unique_id}`
      : `message_${item.message_id || item.file_unique_id}`);

  const isDirectory = item.file_type === "folder";
  if (isDirectory) {
    const folderPath = savedToVirtualPath(joinPath(item.file_path, resolvedName));
    return {
      name: resolvedName,
      path: folderPath,
      isDirectory: true,
      modifiedAt: item.modified_date,
    };
  }

  return {
    name: resolvedName,
    path: `tg://msg/${item.message_id}`,
    isDirectory: false,
    size: item.file_size,
    modifiedAt: item.modified_date,
    extension: extensionFromFileName(resolvedName),
    messageId: item.message_id > 0 ? item.message_id : undefined,
    thumbnail: resolveThumbnailSrc(item.thumbnail),
  };
};

export default function ExplorerPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ExplorerViewMode>("list");
  const [isViewModeLoaded, setIsViewModeLoaded] = useState(false);
  const [contextMenuState, setContextMenuState] = useState<ExplorerContextMenuState | null>(null);
  const [clipboardItem, setClipboardItem] = useState<ExplorerClipboardItem | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null);
  const [isNewFolderDialogOpen, setIsNewFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameTarget, setRenameTarget] = useState<FileItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [currentPath, setCurrentPath] = useState<string>("tg://saved");
  const [error, setError] = useState<string | null>(null);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [isExternalDragging, setIsExternalDragging] = useState(false);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [savedItemsOffset, setSavedItemsOffset] = useState(0);
  const [hasMoreSavedItems, setHasMoreSavedItems] = useState(false);
  const [isLoadingMoreSavedItems, setIsLoadingMoreSavedItems] = useState(false);
  const [isSavedBackfillSyncing, setIsSavedBackfillSyncing] = useState(false);
  const [isSavedSyncComplete, setIsSavedSyncComplete] = useState(false);
  const [savedSyncProgress, setSavedSyncProgress] = useState(0);
  const [backHistory, setBackHistory] = useState<string[]>([]);
  const [forwardHistory, setForwardHistory] = useState<string[]>([]);
  const filesRef = useRef<FileItem[]>([]);
  const currentPathRef = useRef("tg://saved");
  const savedLoadMoreLastAttemptRef = useRef(0);
  const startupSyncRanRef = useRef(false);
  const lastNavigationAtRef = useRef(Date.now());
  const prefetchedThumbnailIdsRef = useRef<Set<number>>(new Set());
  const savedPathCacheRef = useRef<Record<string, SavedPathCacheEntry>>({});
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const detailsPanelRef = useRef<HTMLDivElement | null>(null);
  const detailsPanelCloseTimerRef = useRef<number | null>(null);
  const navigationStateRef = useRef({
    backHistory: [] as string[],
    forwardHistory: [] as string[],
    currentPath: "tg://saved",
    isLoading: false,
  });

  const clearDetailsPanelCloseTimer = useCallback(() => {
    if (detailsPanelCloseTimerRef.current !== null) {
      window.clearTimeout(detailsPanelCloseTimerRef.current);
      detailsPanelCloseTimerRef.current = null;
    }
  }, []);

  const openDetailsPanel = useCallback(() => {
    clearDetailsPanelCloseTimer();
    setShowDetails(true);

    window.requestAnimationFrame(() => {
      setIsDetailsPanelOpen(true);
    });
  }, [clearDetailsPanelCloseTimer]);

  const closeDetailsPanel = useCallback(() => {
    if (!showDetails && !isDetailsPanelOpen) {
      return;
    }

    clearDetailsPanelCloseTimer();
    setIsDetailsPanelOpen(false);
    detailsPanelCloseTimerRef.current = window.setTimeout(() => {
      setShowDetails(false);
      detailsPanelCloseTimerRef.current = null;
    }, DETAILS_PANEL_ANIMATION_MS);
  }, [clearDetailsPanelCloseTimer, isDetailsPanelOpen, showDetails]);

  useEffect(() => {
    return () => {
      clearDetailsPanelCloseTimer();
    };
  }, [clearDetailsPanelCloseTimer]);

  // Initialize with home directory and user info
  useEffect(() => {
    loadDirectory("tg://saved");
    loadFavorites();

    // Check if user info was passed from the LoadingPage
    const passedUserInfo = location.state?.userInfo as UserInfo | undefined;
    if (passedUserInfo) {
      setUserInfo(passedUserInfo);
      loadProfilePhoto(passedUserInfo.profile_photo); // Load photo with cached version if available
    } else {
      loadUserInfo().then(() => {
        // We handle setting avatarUrl inside loadUserInfo now, 
        // but loadProfilePhoto still needs to be called to check for updates if missing
        loadProfilePhoto();
      });
    }

  }, [location.state]);

  useEffect(() => {
    navigationStateRef.current = {
      backHistory,
      forwardHistory,
      currentPath,
      isLoading,
    };
    currentPathRef.current = currentPath;
  }, [backHistory, forwardHistory, currentPath, isLoading]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    let cancelled = false;

    const loadViewModePreference = async () => {
      try {
        const savedViewMode = await invoke<string | null>("db_get_setting", {
          key: EXPLORER_VIEW_MODE_KEY,
        });

        if (!cancelled && (savedViewMode === "list" || savedViewMode === "grid")) {
          setViewMode(savedViewMode);
        }
      } catch (error) {
        console.error("Error loading explorer view mode setting:", error);
      } finally {
        if (!cancelled) {
          setIsViewModeLoaded(true);
        }
      }
    };

    void loadViewModePreference();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isViewModeLoaded) {
      return;
    }

    invoke("db_set_setting", {
      key: EXPLORER_VIEW_MODE_KEY,
      value: viewMode,
    }).catch((error) => {
      console.error("Error saving explorer view mode setting:", error);
    });
  }, [isViewModeLoaded, viewMode]);

  useEffect(() => {
    if (!contextMenuState) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (contextMenuRef.current && target && contextMenuRef.current.contains(target)) {
        return;
      }
      setContextMenuState(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenuState(null);
      }
    };

    const handleViewportChange = () => {
      setContextMenuState(null);
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
  }, [contextMenuState]);

  useEffect(() => {
    if (!showDetails) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (detailsPanelRef.current && target && detailsPanelRef.current.contains(target)) {
        return;
      }

      closeDetailsPanel();
    };

    window.addEventListener("mousedown", handlePointerDown, true);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown, true);
    };
  }, [closeDetailsPanel, showDetails]);

  useEffect(() => {
    if (isRecycleBinPath(currentPath) && showDetails) {
      closeDetailsPanel();
    }
  }, [closeDetailsPanel, currentPath, showDetails]);

  useEffect(() => {
    setContextMenuState(null);
  }, [currentPath]);

  useEffect(() => {
    if (!isSavedBackfillSyncing) {
      return;
    }

    setSavedSyncProgress((prev) => (prev > 0 && prev <= 100 ? prev : 5));

    const timer = window.setInterval(() => {
      setSavedSyncProgress((prev) => {
        if (prev >= 95) {
          return 95;
        }
        if (prev < 50) {
          return prev + 5;
        }
        if (prev < 80) {
          return prev + 3;
        }
        return prev + 1;
      });
    }, 350);

    return () => {
      window.clearInterval(timer);
    };
  }, [isSavedBackfillSyncing]);

  const markNavigationActivity = useCallback(() => {
    lastNavigationAtRef.current = Date.now();
  }, []);

  const indexSavedMessages = useCallback(async (): Promise<TelegramIndexSavedMessagesResult | null> => {
    try {
      const result: TelegramIndexSavedMessagesResult = await invoke("tg_index_saved_messages");

      console.log("Indexing summary:", result);
      if (result.total_new_messages > 0) {
        setIsSavedSyncComplete(false);
        toast({
          title: "Saved Messages Synced",
          description: `Found ${result.total_new_messages} new item${result.total_new_messages === 1 ? "" : "s"}.`,
        });
      }

      return result;
    } catch (error) {
      console.error("Error indexing saved messages:", error);
      return null;
    }
  }, []);

  useEffect(() => {
    if (startupSyncRanRef.current) {
      return;
    }
    startupSyncRanRef.current = true;

    let cancelled = false;

    const runSavedMessageSync = async () => {
      setIsSavedBackfillSyncing(true);
      setSavedSyncProgress(5);
      try {
        const syncResult = await indexSavedMessages();
        setSavedSyncProgress((prev) => (prev < 85 ? 85 : prev));

        if (!cancelled) {
          setIsSavedSyncComplete(true);
          setHasMoreSavedItems(false);

          if (currentPathRef.current.startsWith("tg://saved")) {
            const activePath = currentPathRef.current;
            const cacheEntry = savedPathCacheRef.current[activePath];
            const shouldRefreshVisibleSavedItems =
              (syncResult?.total_new_messages ?? 0) > 0 ||
              !cacheEntry?.isCompleteSnapshot;

            if (shouldRefreshVisibleSavedItems) {
              await loadAllSavedItems(activePath);
            }
          }

          setSavedSyncProgress(100);
        }
      } catch (error) {
        console.error("Error syncing saved messages:", error);
        setSavedSyncProgress(0);
      } finally {
        if (!cancelled) {
          setIsSavedBackfillSyncing(false);
        }
      }
    };

    void runSavedMessageSync();
    return () => {
      cancelled = true;
    };
  }, [indexSavedMessages]);

  // Load user info from session
  const loadUserInfo = async () => {
    try {
      const session: any = await invoke("db_get_session");
      if (session) {
        // If we have cached user info, use it immediately
        if (session.first_name || session.last_name || session.username) {
          setUserInfo({
            id: 0,
            username: session.username || null,
            first_name: session.first_name || null,
            last_name: session.last_name || null,
            profile_photo: session.profile_photo || null
          });

          if (session.profile_photo) {
            setAvatarUrl(session.profile_photo);
          }
          if (session.phone) {
            setPhoneNumber(session.phone);
          }
        }

        if (session.session_data) {
          const result: TelegramAuthResult = await invoke("tg_restore_session", {
            sessionData: session.session_data
          });

          if (result.authorized && result.user_info) {
            setUserInfo(result.user_info);

            if (result.user_info.profile_photo) {
              setAvatarUrl(result.user_info.profile_photo);
            }

            // Background update of cache if info changed or was missing
            if (!session.first_name || !session.last_name || !session.username) {
              invoke("db_update_session_user_info", {
                firstName: result.user_info.first_name,
                lastName: result.user_info.last_name,
                username: result.user_info.username
              }).catch(e => console.error("Failed to update user info cache:", e));
            }
          }
        }
      }
    } catch (error) {
      console.error("Error loading user info:", error);
    }
  };

  // Load profile photo from Telegram
  const loadProfilePhoto = async (cachedPhoto?: string | null) => {
    // If we already have an avatarUrl or a cachedPhoto is provided, don't reload
    const currentAvatar = avatarUrl || cachedPhoto;
    if (currentAvatar) {
      if (!avatarUrl && cachedPhoto) setAvatarUrl(cachedPhoto);
      return;
    }

    try {
      const photoUrl: string | null = await invoke("tg_get_my_profile_photo");
      if (photoUrl) {
        setAvatarUrl(photoUrl);
      }
    } catch (error) {
      console.error("Error loading profile photo:", error);
      // Don't show error to user, just keep the fallback avatar
    }
  };

  // Listen for navigation events from sidebar
  useEffect(() => {
    const handleNavigateEvent = (event: CustomEvent) => {
      const nextPath = event.detail;
      if (!nextPath) {
        return;
      }

      if (nextPath === currentPath) {
        markNavigationActivity();
        loadDirectory(nextPath, { force: true });
        return;
      }

      setBackHistory((prev) => [...prev, currentPath]);
      setForwardHistory([]);
      markNavigationActivity();
      loadDirectory(nextPath);
    };

    window.addEventListener('navigate-to-path', handleNavigateEvent as EventListener);

    return () => {
      window.removeEventListener('navigate-to-path', handleNavigateEvent as EventListener);
    };
  }, [currentPath, markNavigationActivity]);

  // Listen for logout events from sidebar
  useEffect(() => {
    const handleLogoutEvent = () => {
      handleLogout();
    };

    window.addEventListener('logout-request', handleLogoutEvent);

    return () => {
      window.removeEventListener('logout-request', handleLogoutEvent);
    };
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const canNavigateByKeyboard = !isTextInputElement(e.target);
      const isBackShortcut = e.key === "BrowserBack" || (e.altKey && e.key === "ArrowLeft");
      const isForwardShortcut = e.key === "BrowserForward" || (e.altKey && e.key === "ArrowRight");

      if (canNavigateByKeyboard && isBackShortcut) {
        e.preventDefault();
        if (backHistory.length) {
          const previousPath = backHistory[backHistory.length - 1];
          setBackHistory((prev) => prev.slice(0, -1));
          setForwardHistory((prev) => [...prev, currentPath]);
          markNavigationActivity();
          loadDirectory(previousPath);
        }
        return;
      }

      if (canNavigateByKeyboard && isForwardShortcut) {
        e.preventDefault();
        if (forwardHistory.length) {
          const nextPath = forwardHistory[forwardHistory.length - 1];
          setForwardHistory((prev) => prev.slice(0, -1));
          setBackHistory((prev) => [...prev, currentPath]);
          markNavigationActivity();
          loadDirectory(nextPath);
        }
        return;
      }

      // Ctrl/Cmd + R to refresh
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        handleRefresh();
      }

      // Escape to close details panel
      if (e.key === 'Escape' && showDetails) {
        closeDetailsPanel();
      }

      // Delete key to delete selected file
      if (e.key === 'Delete' && selectedFile) {
        setDeleteTarget(selectedFile);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedFile, showDetails, backHistory, forwardHistory, currentPath, isLoading, markNavigationActivity, closeDetailsPanel]);

  useEffect(() => {
    const suppressDefaultMouseNavigation = (event: MouseEvent) => {
      if (event.button === 3 || event.button === 4) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const handleMouseNavigationButtons = (event: MouseEvent) => {
      if (isTextInputElement(event.target)) {
        return;
      }

      if (event.button === 3) {
        event.preventDefault();
        event.stopPropagation();
        if (backHistory.length) {
          const previousPath = backHistory[backHistory.length - 1];
          setBackHistory((prev) => prev.slice(0, -1));
          setForwardHistory((prev) => [...prev, currentPath]);
          markNavigationActivity();
          void loadDirectory(previousPath);
        }
      }

      if (event.button === 4) {
        event.preventDefault();
        event.stopPropagation();
        if (forwardHistory.length) {
          const nextPath = forwardHistory[forwardHistory.length - 1];
          setForwardHistory((prev) => prev.slice(0, -1));
          setBackHistory((prev) => [...prev, currentPath]);
          markNavigationActivity();
          void loadDirectory(nextPath);
        }
      }
    };

    window.addEventListener("mousedown", suppressDefaultMouseNavigation, true);
    window.addEventListener("mouseup", handleMouseNavigationButtons, true);
    return () => {
      window.removeEventListener("mousedown", suppressDefaultMouseNavigation, true);
      window.removeEventListener("mouseup", handleMouseNavigationButtons, true);
    };
  }, [backHistory, currentPath, forwardHistory, isLoading, markNavigationActivity]);

  const applySavedPathCache = (path: string): boolean => {
    const cacheEntry = savedPathCacheRef.current[path];
    if (!cacheEntry) {
      return false;
    }

    setFiles(cacheEntry.items);
    setSavedItemsOffset(cacheEntry.nextOffset);
    setHasMoreSavedItems(cacheEntry.hasMore);
    setCurrentPath(path);
    prefetchThumbnailsForItems(cacheEntry.items);
    return true;
  };

  const cacheSavedPath = (
    path: string,
    items: FileItem[],
    nextOffset: number,
    hasMore: boolean,
    isCompleteSnapshot: boolean,
  ) => {
    savedPathCacheRef.current[path] = {
      items,
      nextOffset,
      hasMore,
      isCompleteSnapshot,
    };
  };

  const prefetchThumbnailsForItems = (items: FileItem[]) => {
    const messageIds = items
      .map((item) => item.messageId)
      .filter((id): id is number => !!id && id > 0)
      .filter((id) => !prefetchedThumbnailIdsRef.current.has(id));

    if (!messageIds.length) {
      return;
    }

    messageIds.forEach((id) => prefetchedThumbnailIdsRef.current.add(id));

    invoke("tg_prefetch_message_thumbnails", { messageIds }).catch((error) => {
      console.error("Failed to prefetch message thumbnails:", error);
      messageIds.forEach((id) => prefetchedThumbnailIdsRef.current.delete(id));
    });
  };

  const loadSavedItemsPage = async (path: string, offset: number, append: boolean) => {
    const savedPath = virtualToSavedPath(path);
    const result: TelegramSavedItemsPage = await invoke("tg_list_saved_items_page", {
      filePath: savedPath,
      offset,
      limit: SAVED_ITEMS_PAGE_SIZE,
    });

    const pageItems = result.items.map(savedItemToFileItem);
    const mergedItems = append ? [...filesRef.current, ...pageItems] : pageItems;
    setFiles(mergedItems);
    setSavedItemsOffset(result.next_offset);
    setHasMoreSavedItems(result.has_more);
    setCurrentPath(path);
    cacheSavedPath(path, mergedItems, result.next_offset, result.has_more, false);
    prefetchThumbnailsForItems(mergedItems);
  };

  const loadAllSavedItems = async (path: string) => {
    const savedPath = virtualToSavedPath(path);
    const result: TelegramSavedItem[] = await invoke("tg_list_saved_items", {
      filePath: savedPath,
    });

    const allItems = result.map(savedItemToFileItem);
    setFiles(allItems);
    setSavedItemsOffset(allItems.length);
    setHasMoreSavedItems(false);
    setCurrentPath(path);
    cacheSavedPath(path, allItems, allItems.length, false, true);
    prefetchThumbnailsForItems(allItems);
  };

  const loadMoreSavedItems = async () => {
    if (!currentPath.startsWith("tg://saved")) {
      return;
    }

    const now = Date.now();
    if (now - savedLoadMoreLastAttemptRef.current < 250) {
      return;
    }
    savedLoadMoreLastAttemptRef.current = now;

    if (isLoading || isLoadingMoreSavedItems) {
      return;
    }

    if (isSavedSyncComplete) {
      return;
    }

    if (!hasMoreSavedItems && !isSavedBackfillSyncing) {
      return;
    }

    setIsLoadingMoreSavedItems(true);
    try {
      await loadSavedItemsPage(currentPath, savedItemsOffset, true);
    } catch (error) {
      console.error("Error loading more saved items:", error);
      setHasMoreSavedItems(false);
    } finally {
      setIsLoadingMoreSavedItems(false);
    }
  };

  const handleDirectoryScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (!currentPath.startsWith("tg://saved")) {
      return;
    }

    const target = event.currentTarget;
    const reachedBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 120;
    if (reachedBottom) {
      void loadMoreSavedItems();
    }
  };

  const loadDirectory = async (path: string, options?: { force?: boolean }) => {
    const forceReload = options?.force === true;
    setError(null);

    if (path.startsWith("tg://saved") && !forceReload) {
      const hasCache = applySavedPathCache(path);
      if (hasCache) {
        const cacheEntry = savedPathCacheRef.current[path];
        if (isSavedSyncComplete && !cacheEntry.isCompleteSnapshot) {
          void loadAllSavedItems(path).catch((error) => {
            console.error("Error upgrading cached saved items view to full list:", error);
          });
        }
        return;
      }
    }

    setIsLoading(true);
    try {
      if (path.startsWith("tg://saved")) {
        setSavedItemsOffset(0);
        setHasMoreSavedItems(false);
        if (isSavedSyncComplete) {
          await loadAllSavedItems(path);
        } else {
          await loadSavedItemsPage(path, 0, false);
        }
      } else {
        const result: FileEntry[] = await invoke("fs_list_dir", { path });
        const convertedFiles = result.map(convertFileEntryToFileItem);
        setFiles(convertedFiles);
        setCurrentPath(path);
        setSavedItemsOffset(0);
        setHasMoreSavedItems(false);
      }

      // Add to recent paths (only for real FS paths for now, or decide if virtual paths should be saved)
      if (!path.startsWith("tg://")) {
        try {
          await invoke("db_add_recent_path", { path });
        } catch (error) {
          console.error("Error adding recent path:", error);
        }
      }
    } catch (error) {
      const typedError = error as FsError;
      setError(typedError.message || "An unknown error occurred");
      toast({
        title: "Error loading directory",
        description: typedError.message || "An unknown error occurred",
        variant: "destructive",
      });
      console.error("Error loading directory:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const navigateToPath = useCallback(async (path: string) => {
    if (!path) {
      return;
    }

    if (path === currentPath) {
      await loadDirectory(path);
      return;
    }

    setBackHistory((prev) => [...prev, currentPath]);
    setForwardHistory([]);
    markNavigationActivity();
    await loadDirectory(path);
  }, [currentPath, markNavigationActivity]);

  const handleGoBack = useCallback(async () => {
    if (!backHistory.length) {
      return;
    }

    const previousPath = backHistory[backHistory.length - 1];
    setBackHistory((prev) => prev.slice(0, -1));
    setForwardHistory((prev) => [...prev, currentPath]);
    markNavigationActivity();
    await loadDirectory(previousPath);
  }, [backHistory, currentPath, markNavigationActivity]);

  const handleGoForward = useCallback(async () => {
    if (!forwardHistory.length) {
      return;
    }

    const nextPath = forwardHistory[forwardHistory.length - 1];
    setForwardHistory((prev) => prev.slice(0, -1));
    setBackHistory((prev) => [...prev, currentPath]);
    markNavigationActivity();
    await loadDirectory(nextPath);
  }, [currentPath, forwardHistory, markNavigationActivity]);

  useEffect(() => {
    const explorerUrl = window.location.href;
    const guardState = {
      ...(window.history.state || {}),
      __skyboxExplorerGuard: true,
    };

    const hasGuardState =
      typeof window.history.state === "object" &&
      window.history.state !== null &&
      "__skyboxExplorerGuard" in window.history.state;

    if (!hasGuardState) {
      window.history.pushState(guardState, "", explorerUrl);
    }

    const handlePopState = () => {
      window.history.pushState(guardState, "", explorerUrl);

      const { backHistory: stack, currentPath: activePath, isLoading: loading } = navigationStateRef.current;
      if (!stack.length || loading) {
        return;
      }

      const previousPath = stack[stack.length - 1];
      setBackHistory((prev) => prev.slice(0, -1));
      setForwardHistory((prev) => [...prev, activePath]);
      markNavigationActivity();
      void loadDirectory(previousPath);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [markNavigationActivity]);

  const loadFavorites = async () => {
    try {
      const result: Favorite[] = await invoke("db_get_favorites");
      const favoritePaths = result.map(fav => fav.path);
      setFavorites(favoritePaths);
    } catch (error) {
      const typedError = error as DbError;
      console.error("Error loading favorites:", error);
    }
  };

  const handleNavigateToPath = (path: string) => {
    navigateToPath(path);
  };

  const handleViewModeChange = useCallback((mode: ExplorerViewMode) => {
    setViewMode((prev) => (prev === mode ? prev : mode));
  }, []);

  const breadcrumbItems = useMemo(() => {
    if (!currentPath) return [];

    if (currentPath.startsWith("tg://saved")) {
      const relativePath = currentPath.replace(/^tg:\/\/saved\/?/, "");
      if (!relativePath) {
        return [];
      }

      const parts = relativePath.split("/").filter(Boolean);
      const breadcrumbs: { name: string; path: string }[] = [];
      let runningPath = "tg://saved";

      parts.forEach((part) => {
        runningPath = `${runningPath}/${part}`;
        breadcrumbs.push({ name: part, path: runningPath });
      });

      return breadcrumbs;
    }

    const parts = currentPath.split('/').filter(p => p);
    const breadcrumbs = [];

    let current = "";
    parts.forEach(part => {
      current += `/${part}`;
      breadcrumbs.push({ name: part, path: current });
    });

    return breadcrumbs;
  }, [currentPath]);

  const filteredFiles = useMemo(() => {
    const query = search.trim().toLowerCase();

    return files.filter((file) => {
      if (
        currentPath === "tg://saved" &&
        file.isDirectory &&
        file.path === RECYCLE_BIN_VIRTUAL_PATH
      ) {
        return false;
      }

      if (!query) {
        return true;
      }

      return file.name.toLowerCase().includes(query);
    });
  }, [currentPath, search, files]);

  // Sort: directories first, then by name
  const sortedFiles = useMemo(() => {
    if (currentPath.startsWith("tg://saved")) {
      return filteredFiles;
    }

    return [...filteredFiles].sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [currentPath, filteredFiles]);

  const isLoadingSavedFiles =
    currentPath.startsWith("tg://saved") &&
    isSavedBackfillSyncing &&
    !search.trim() &&
    sortedFiles.length === 0;

  const syncProgressLabel = `${Math.min(100, Math.max(0, Math.round(savedSyncProgress)))}%`;
  const contextMenuItemClassName = "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-body text-foreground transition-colors hover:bg-primary/15 outline-none focus-visible:outline-none";
  const contextMenuDisabledItemClassName = "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-body text-muted-foreground/60 pointer-events-none outline-none focus-visible:outline-none";
  const contextMenuDangerItemClassName = "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-body text-destructive transition-colors hover:bg-destructive/10 outline-none focus-visible:outline-none";
  const contextTargetFile = contextMenuState?.targetFile ?? null;
  const canPaste = !!clipboardItem;
  const isRecycleBinView = isRecycleBinPath(currentPath);
  const isPermanentDeleteTarget =
    isRecycleBinView &&
    !!deleteTarget &&
    isSavedVirtualItemPath(deleteTarget.path);
  const isSavedDeleteTarget = !!deleteTarget && isSavedVirtualItemPath(deleteTarget.path);

  const handleFileSelect = (file: FileItem) => {
    setSelectedFile(file);
    if (isRecycleBinPath(currentPath)) {
      closeDetailsPanel();
    }
  };

  const handleDownloadSavedFile = async (targetFile?: FileItem | null) => {
    const file = targetFile ?? selectedFile;
    if (!file || file.isDirectory || !isSavedVirtualFilePath(file.path)) {
      return;
    }

    try {
      toast({
        title: "Downloading",
        description: file.name,
      });

      const destinationPath: string = await invoke("tg_download_saved_file", {
        sourcePath: file.path,
      });

      toast({
        title: "Downloaded",
        description: `${file.name} saved to Downloads`,
      });

      console.info("Saved Messages download completed:", destinationPath);
    } catch (error) {
      const typedError = error as TelegramError;
      toast({
        title: "Download failed",
        description: typedError.message || "An unknown error occurred",
        variant: "destructive",
      });
    }
  };

  const handleFileOpen = async (file: FileItem) => {
    if (file.isDirectory) {
      navigateToPath(file.path);
    } else {
      if (isSavedVirtualFilePath(file.path)) {
        await handleDownloadSavedFile(file);
        return;
      }

      try {
        await invoke("fs_open_path", { path: file.path });
        toast({
          title: "Opening file",
          description: file.name,
        });
      } catch (error) {
        const typedError = error as FsError;
        toast({
          title: "Error opening file",
          description: typedError.message || "An unknown error occurred",
          variant: "destructive",
        });
      }
    }
  };

  const handleToggleFavorite = async () => {
    if (!selectedFile) return;
    const path = selectedFile.path;

    if (favorites.includes(path)) {
      // Remove from favorites
      try {
        // Find the favorite ID by path
        const allFavorites: Favorite[] = await invoke("db_get_favorites");
        const favoriteToRemove = allFavorites.find(fav => fav.path === path);

        if (favoriteToRemove) {
          await invoke("db_remove_favorite", { id: favoriteToRemove.id });
          setFavorites(prev => prev.filter(f => f !== path));
          toast({
            title: "Removed from favorites",
            description: `${selectedFile.name} is no longer a favorite`
          });
        }
      } catch (error) {
        const typedError = error as DbError;
        toast({
          title: "Error removing from favorites",
          description: typedError.message || "An unknown error occurred",
          variant: "destructive",
        });
      }
    } else {
      // Add to favorites
      try {
        const id: number = await invoke("db_add_favorite", {
          path: path,
          label: selectedFile.name
        });
        setFavorites(prev => [...prev, path]);
        toast({
          title: "Added to favorites",
          description: `${selectedFile.name} is now a favorite`
        });
      } catch (error) {
        const typedError = error as DbError;
        toast({
          title: "Error adding to favorites",
          description: typedError.message || "An unknown error occurred",
          variant: "destructive",
        });
      }
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    try {
      const target = deleteTarget;
      const isSavedItem = isSavedVirtualItemPath(target.path);

      if (isSavedItem) {
        if (isRecycleBinPath(currentPath)) {
          await invoke("tg_delete_saved_item_permanently", {
            sourcePath: target.path,
          });
          toast({
            title: "Deleted",
            description: `${target.name} deleted permanently`,
          });
        } else {
          await invoke("tg_move_saved_item_to_recycle_bin", {
            sourcePath: target.path,
          });
          toast({
            title: "Moved to Recycle Bin",
            description: `${target.name} moved successfully`,
          });
        }

        savedPathCacheRef.current = {};
      } else {
        await invoke("fs_delete", { path: target.path });
        toast({
          title: "Deleted",
          description: `${target.name} has been deleted`,
        });
      }

      // Reload the current directory to reflect changes
      await loadDirectory(currentPath, { force: true });
      setDeleteTarget(null);
      if (selectedFile?.path === target.path) {
        setSelectedFile(null);
        closeDetailsPanel();
      }
    } catch (error) {
      const typedError = error as FsError | TelegramError;
      toast({
        title: "Error deleting item",
        description: typedError.message || "An unknown error occurred",
        variant: "destructive",
      });
    }
  };

  const handleRestoreFromRecycleBin = async (targetFile?: FileItem | null) => {
    const file = targetFile ?? selectedFile;
    if (!file || !isRecycleBinPath(currentPath)) {
      return;
    }

    if (!isSavedVirtualItemPath(file.path)) {
      return;
    }

    try {
      await invoke("tg_restore_saved_item", {
        sourcePath: file.path,
      });

      savedPathCacheRef.current = {};
      toast({
        title: "Restored",
        description: `${file.name} restored to its previous folder`,
      });

      if (selectedFile?.path === file.path) {
        setSelectedFile(null);
        closeDetailsPanel();
      }

      await loadDirectory(currentPath, { force: true });
    } catch (error) {
      const typedError = error as TelegramError;
      toast({
        title: "Restore failed",
        description: typedError.message || "An unknown error occurred",
        variant: "destructive",
      });
    }
  };

  const handleRefresh = async () => {
    await loadDirectory(currentPath, { force: true });
    toast({
      title: "Refreshed",
      description: "Directory contents refreshed"
    });
  };

  const handleLogout = async () => {
    try {
      // Logout from Telegram
      await invoke("tg_logout");

      // Clear session from database
      await invoke("db_clear_session");
      toast({ title: "Logged out" });
    } catch (error) {
      const typedError = error as TelegramError;
      console.error("Error during logout:", error);
      toast({
        title: "Logout error",
        description: typedError.message || "An error occurred during logout",
        variant: "destructive",
      });
    }
    navigate("/login");
  };

  const handleAddRoot = () => {
    toast({
      title: "Add folder",
      description: "This would open a folder picker in Tauri",
    });
  };

  const handleCopyPath = (targetFile?: FileItem | null) => {
    const file = targetFile ?? selectedFile;
    if (!file) {
      return;
    }

    navigator.clipboard.writeText(file.path);
    toast({
      title: "Path copied",
      description: "File path copied to clipboard",
    });
  };

  const handleNewFolder = () => {
    if (isRecycleBinPath(currentPath)) {
      toast({
        title: "Action unavailable",
        description: "Cannot create folders inside Recycle Bin.",
      });
      return;
    }

    setNewFolderName("");
    setIsNewFolderDialogOpen(true);
  };

  const handleConfirmNewFolder = async () => {
    const folderName = newFolderName.trim();
    if (!folderName) {
      toast({
        title: "Folder name required",
        description: "Please enter a folder name.",
        variant: "destructive",
      });
      return;
    }

    try {
      if (currentPath.startsWith("tg://saved")) {
        await invoke("tg_create_saved_folder", {
          parentPath: virtualToSavedPath(currentPath),
          folderName,
        });
        savedPathCacheRef.current = {};
      } else {
        const newPath = `${currentPath}/${folderName}`.replace("//", "/");
        await invoke("fs_create_dir", { path: newPath });
      }

      setIsNewFolderDialogOpen(false);
      setNewFolderName("");
      toast({
        title: "Folder created",
        description: `Created folder: ${folderName}`,
      });
      await loadDirectory(currentPath, { force: true });
    } catch (error) {
      const typedError = error as FsError | TelegramError;
      toast({
        title: "Error creating folder",
        description: typedError.message || "An unknown error occurred",
        variant: "destructive",
      });
    }
  };

  const handleRename = (targetFile?: FileItem | null) => {
    const file = targetFile ?? selectedFile;
    if (!file) {
      return;
    }

    if (isRecycleBinPath(currentPath)) {
      toast({
        title: "Action unavailable",
        description: "Cannot rename items inside Recycle Bin.",
      });
      return;
    }

    setRenameTarget(file);
    setRenameValue(file.name);
  };

  const handleConfirmRename = async () => {
    const file = renameTarget;
    if (!file) {
      return;
    }

    const normalizedName = renameValue.trim();
    if (!normalizedName) {
      toast({
        title: "Name required",
        description: "Please enter a new name.",
        variant: "destructive",
      });
      return;
    }

    if (normalizedName === file.name) {
      setRenameTarget(null);
      setRenameValue("");
      return;
    }

    try {
      if (isSavedVirtualItemPath(file.path)) {
        await invoke("tg_rename_saved_item", {
          sourcePath: file.path,
          newName: normalizedName,
        });
        savedPathCacheRef.current = {};
      } else {
        const directory = getParentPath(file.path);
        if (!directory) {
          toast({
            title: "Rename failed",
            description: "Unable to resolve target directory",
            variant: "destructive",
          });
          return;
        }

        const newPath = joinPath(directory, normalizedName);
        await invoke("rename_file", {
          oldPath: file.path,
          newPath,
        });
      }

      setRenameTarget(null);
      setRenameValue("");
      toast({
        title: "Renamed",
        description: `${file.name} renamed to ${normalizedName}`,
      });

      if (selectedFile?.path === file.path) {
        setSelectedFile({ ...file, name: normalizedName });
      }

      await loadDirectory(currentPath, { force: true });
    } catch (error) {
      const typedError = error as FsError | TelegramError;
      toast({
        title: "Rename failed",
        description: typedError.message || "An unknown error occurred",
        variant: "destructive",
      });
    }
  };

  const closeContextMenu = () => {
    setContextMenuState(null);
  };

  const openContextMenu = (event: React.MouseEvent, targetFile: FileItem | null, isEmptyArea = false) => {
    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 236;
    const isRecycleBinMenu = isRecycleBinPath(currentPath) && !!targetFile;
    const hasDownloadAction = !!targetFile && !targetFile.isDirectory && isSavedVirtualFilePath(targetFile.path);
    const menuHeight = isEmptyArea
      ? 140
      : isRecycleBinMenu
        ? 112
      : (targetFile && !targetFile.isDirectory
        ? (hasDownloadAction ? 376 : 332)
        : 296);
    const clampedX = Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8));
    const clampedY = Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8));

    setContextMenuState({
      x: clampedX,
      y: clampedY,
      targetFile,
      isEmptyArea,
    });
  };

  const handleFileContextMenu = (event: React.MouseEvent, file: FileItem) => {
    setSelectedFile(file);
    openContextMenu(event, file, false);
  };

  const handleEmptyAreaContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    setSelectedFile(null);
    closeDetailsPanel();

    if (isRecycleBinPath(currentPath)) {
      setContextMenuState(null);
      return;
    }

    openContextMenu(event, null, true);
  };

  const handleShare = async (targetFile?: FileItem | null) => {
    const file = targetFile ?? selectedFile;
    if (!file || file.isDirectory) {
      return;
    }

    try {
      const share = (navigator as { share?: (data: { title?: string; text?: string; url?: string }) => Promise<void> }).share;
      if (typeof share === "function") {
        await share({
          title: file.name,
          text: file.path,
        });
      } else {
        await navigator.clipboard.writeText(file.path);
      }

      toast({
        title: "Shared",
        description: "Share payload is ready.",
      });
    } catch (error) {
      console.error("Share failed:", error);
      toast({
        title: "Share failed",
        description: "Unable to share this item",
        variant: "destructive",
      });
    }
  };

  const handleStageClipboardItem = (mode: ClipboardMode, targetFile?: FileItem | null) => {
    const file = targetFile ?? selectedFile;
    if (!file) {
      return;
    }

    if (isRecycleBinPath(currentPath)) {
      toast({
        title: "Action unavailable",
        description: "Cannot modify items inside Recycle Bin.",
      });
      return;
    }

    setClipboardItem({
      path: file.path,
      name: file.name,
      isDirectory: file.isDirectory,
      mode,
    });

    toast({
      title: mode === "cut" ? "Ready to move" : "Ready to copy",
      description: file.name,
    });
  };

  const resolvePasteDestinationPath = (): string => {
    const targetFile = contextMenuState?.targetFile;
    if (targetFile?.isDirectory) {
      return targetFile.path;
    }

    return currentPath;
  };

  const handlePaste = async () => {
    if (!clipboardItem) {
      return;
    }

    const destinationFolderPath = resolvePasteDestinationPath();
    const sourcePath = clipboardItem.path;
    const sourceName = clipboardItem.name;

    if (!destinationFolderPath) {
      return;
    }

    if (isRecycleBinPath(destinationFolderPath)) {
      toast({
        title: "Paste unavailable",
        description: "Cannot paste items inside Recycle Bin.",
        variant: "destructive",
      });
      return;
    }

    try {
      const sourceIsSaved = isSavedVirtualItemPath(sourcePath);
      const destinationIsSaved = isSavedVirtualFolderPath(destinationFolderPath);

      if (sourceIsSaved || destinationIsSaved) {
        if (!sourceIsSaved || !destinationIsSaved) {
          toast({
            title: "Paste unavailable",
            description: "Cannot move items between local files and Saved Messages.",
            variant: "destructive",
          });
          return;
        }

        await invoke("tg_move_saved_item", {
          sourcePath,
          destinationPath: destinationFolderPath,
        });

        setClipboardItem(null);
        savedPathCacheRef.current = {};
        await loadDirectory(currentPath, { force: true });
        toast({
          title: "Pasted",
          description: `${sourceName} moved successfully`,
        });
        return;
      }

      if (isVirtualPath(sourcePath) || isVirtualPath(destinationFolderPath)) {
        toast({
          title: "Paste unavailable",
          description: "Unsupported source or destination path.",
          variant: "destructive",
        });
        return;
      }

      const destinationPath = joinPath(destinationFolderPath, sourceName);
      if (normalizePath(sourcePath) === normalizePath(destinationPath)) {
        toast({
          title: "Paste skipped",
          description: "Source and destination are the same.",
        });
        return;
      }

      if (clipboardItem.mode === "copy") {
        if (clipboardItem.isDirectory) {
          toast({
            title: "Paste unavailable",
            description: "Copying folders is not available yet.",
            variant: "destructive",
          });
          return;
        }

        await invoke("copy_file", {
          source: sourcePath,
          destination: destinationPath,
        });

        toast({
          title: "Copied",
          description: `${sourceName} copied successfully`,
        });
      } else {
        await invoke("move_file", {
          source: sourcePath,
          destination: destinationPath,
        });

        setClipboardItem(null);
        if (selectedFile?.path === sourcePath) {
          setSelectedFile(null);
          closeDetailsPanel();
        }

        toast({
          title: "Moved",
          description: `${sourceName} moved successfully`,
        });
      }

      await loadDirectory(currentPath, { force: true });
    } catch (error) {
      const typedError = error as FsError | TelegramError;
      toast({
        title: "Paste failed",
        description: typedError.message || "An unknown error occurred",
        variant: "destructive",
      });
    }
  };

  const handleContextOpen = async () => {
    const file = contextMenuState?.targetFile;
    if (!file) {
      return;
    }

    await handleFileOpen(file);
  };

  const handleContextDelete = () => {
    const file = contextMenuState?.targetFile;
    if (!file) {
      return;
    }

    setSelectedFile(file);
    setDeleteTarget(file);
  };

  const handleContextDetails = (targetFile?: FileItem | null) => {
    const file = targetFile ?? contextMenuState?.targetFile ?? selectedFile;
    if (!file || isRecycleBinPath(currentPath)) {
      return;
    }

    setSelectedFile(file);
    openDetailsPanel();
  };

  const isDraggableItem = (file: FileItem) => {
    if (isRecycleBinPath(currentPath)) {
      return false;
    }

    if (isSavedVirtualFolderPath(file.path)) {
      return file.path !== "tg://saved";
    }

    if (isSavedVirtualFilePath(file.path)) {
      return true;
    }

    return !isVirtualPath(file.path);
  };

  const getDraggedSourcePath = (event: React.DragEvent): string | null => {
    const fromTransfer = event.dataTransfer.getData(INTERNAL_DRAG_MIME);
    if (fromTransfer) {
      return fromTransfer;
    }

    return draggedPath;
  };

  const canDropToTarget = (sourcePath: string, target: FileItem): boolean => {
    if (isRecycleBinPath(currentPath)) {
      return false;
    }

    if (!target.isDirectory) {
      return false;
    }

    const sourceItem = files.find((file) => file.path === sourcePath);

    const sourceIsSavedVirtual = isSavedVirtualFolderPath(sourcePath) || isSavedVirtualFilePath(sourcePath);
    const targetIsSavedVirtualFolder = isSavedVirtualFolderPath(target.path);

    if (sourceIsSavedVirtual || targetIsSavedVirtualFolder) {
      if (!sourceIsSavedVirtual || !targetIsSavedVirtualFolder) {
        return false;
      }

      if (sourcePath === target.path) {
        return false;
      }

      if (isSavedVirtualFolderPath(sourcePath)) {
        const sourceParentPath = getParentPath(sourcePath);
        if (sourceParentPath === target.path) {
          return false;
        }

        if (target.path.startsWith(`${sourcePath}/`)) {
          return false;
        }
      }

      if (isSavedVirtualFilePath(sourcePath) && currentPath === target.path) {
        return false;
      }

      if (!sourceItem && !isSavedVirtualFilePath(sourcePath)) {
        return false;
      }

      return true;
    }

    if (isVirtualPath(sourcePath) || isVirtualPath(target.path)) {
      return false;
    }

    const normalizedSourcePath = normalizePath(sourcePath);
    const normalizedTargetPath = normalizePath(target.path);

    if (normalizedSourcePath === normalizedTargetPath) {
      return false;
    }

    const sourceParentPath = getParentPath(normalizedSourcePath);
    if (sourceParentPath === normalizedTargetPath) {
      return false;
    }

    if (sourceItem?.isDirectory && normalizedTargetPath.startsWith(`${normalizedSourcePath}/`)) {
      return false;
    }

    return true;
  };

  const handleItemDragStart = (event: React.DragEvent, file: FileItem) => {
    if (!isDraggableItem(file)) {
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(INTERNAL_DRAG_MIME, file.path);
    setDraggedPath(file.path);
  };

  const handleItemDragEnd = () => {
    setDraggedPath(null);
    setDropTargetPath(null);
  };

  const handleItemDragOver = (event: React.DragEvent, target: FileItem) => {
    const sourcePath = getDraggedSourcePath(event);
    if (!sourcePath || !canDropToTarget(sourcePath, target)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetPath(target.path);
  };

  const handleItemDragLeave = (target: FileItem) => {
    if (dropTargetPath === target.path) {
      setDropTargetPath(null);
    }
  };

  const handleItemDrop = async (event: React.DragEvent, target: FileItem) => {
    const sourcePath = getDraggedSourcePath(event);
    if (!sourcePath || !canDropToTarget(sourcePath, target)) {
      return;
    }

    if (isRecycleBinPath(currentPath)) {
      return;
    }

    const sourceItem = files.find((file) => file.path === sourcePath);
    const sourceDisplayName = sourceItem?.name || getPathName(sourcePath);

    event.preventDefault();
    event.stopPropagation();

    if ((isSavedVirtualFolderPath(sourcePath) || isSavedVirtualFilePath(sourcePath)) && isSavedVirtualFolderPath(target.path)) {
      try {
        await invoke("tg_move_saved_item", {
          sourcePath,
          destinationPath: target.path,
        });

        toast({
          title: "Moved",
          description: `${sourceDisplayName} moved to ${target.name}`,
        });

        if (selectedFile?.path === sourcePath) {
          setSelectedFile(null);
          closeDetailsPanel();
        }

        savedPathCacheRef.current = {};
        await loadDirectory(currentPath, { force: true });
      } catch (error) {
        const typedError = error as TelegramError;
        toast({
          title: "Move failed",
          description: typedError.message || "Unable to move item",
          variant: "destructive",
        });
      } finally {
        setDraggedPath(null);
        setDropTargetPath(null);
      }
      return;
    }

    const destinationPath = joinPath(target.path, getPathName(sourcePath));

    try {
      await invoke("move_file", { source: sourcePath, destination: destinationPath });
      toast({
        title: "Moved",
        description: `${sourceDisplayName} moved to ${target.name}`,
      });

      if (selectedFile?.path === sourcePath) {
        setSelectedFile(null);
        closeDetailsPanel();
      }

      await loadDirectory(currentPath, { force: true });
    } catch (error) {
      const typedError = error as FsError;
      toast({
        title: "Move failed",
        description: typedError.message || "Unable to move item",
        variant: "destructive",
      });
    } finally {
      setDraggedPath(null);
      setDropTargetPath(null);
    }
  };

  const isExternalFileDrag = (event: React.DragEvent): boolean => {
    const dragTypes = Array.from(event.dataTransfer.types || []);
    const hasFiles = dragTypes.includes("Files");
    const hasInternalFile = dragTypes.includes(INTERNAL_DRAG_MIME);
    return hasFiles && !hasInternalFile;
  };

  const handleUploadFiles = async (droppedFiles: File[]) => {
    if (!droppedFiles.length) {
      return;
    }

    if (!currentPath.startsWith("tg://saved")) {
      toast({
        title: "Upload unavailable",
        description: "Drag-and-drop upload is available in Saved Messages only.",
        variant: "destructive",
      });
      return;
    }

    if (isRecycleBinPath(currentPath)) {
      toast({
        title: "Upload unavailable",
        description: "Cannot upload files inside Recycle Bin.",
        variant: "destructive",
      });
      return;
    }

    setIsUploadingFiles(true);
    try {
      let uploadedCount = 0;
      let failedCount = 0;
      const uploadedCategories = new Set<string>();

      for (const droppedFile of droppedFiles) {
        try {
          const fileBytes = Array.from(new Uint8Array(await droppedFile.arrayBuffer()));
          const uploadedMessage: TelegramMessage = await invoke("tg_upload_file_to_saved_messages", {
            fileName: droppedFile.name,
            fileBytes,
            filePath: virtualToSavedPath(currentPath),
          });

          uploadedCount += 1;
          uploadedCategories.add(uploadedMessage.category);
        } catch (error) {
          failedCount += 1;
          console.error("Failed to upload file:", droppedFile.name, error);
        }
      }

      if (uploadedCount > 0) {
        savedPathCacheRef.current = {};
        await loadDirectory(currentPath, { force: true });

        const categorySummary = uploadedCategories.size
          ? ` to ${Array.from(uploadedCategories).join(", ")}`
          : "";

        toast({
          title: "Upload complete",
          description: `Uploaded ${uploadedCount} file${uploadedCount === 1 ? "" : "s"}${categorySummary}`,
        });
      }

      if (failedCount > 0) {
        toast({
          title: "Some uploads failed",
          description: `${failedCount} file${failedCount === 1 ? "" : "s"} could not be uploaded`,
          variant: "destructive",
        });
      }
    } finally {
      setIsUploadingFiles(false);
    }
  };

  const handleExplorerDragOver = (event: React.DragEvent) => {
    if (!isExternalFileDrag(event) || isRecycleBinPath(currentPath)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsExternalDragging(true);
  };

  const handleExplorerDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setIsExternalDragging(false);
  };

  const handleExplorerDrop = async (event: React.DragEvent) => {
    if (!isExternalFileDrag(event) || isRecycleBinPath(currentPath)) {
      return;
    }

    event.preventDefault();
    setIsExternalDragging(false);

    await handleUploadFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <div
      className="relative h-screen flex overflow-hidden"
      onClick={() => {
        if (contextMenuState) {
          closeContextMenu();
        }
      }}
    >
      {/* Sidebar */}
      <ExplorerSidebar
        currentPath={currentPath}
        userInfo={userInfo}
        avatarUrl={avatarUrl}
        phoneNumber={phoneNumber}
      />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="h-14 bg-glass border-b border-border flex items-center justify-between px-4 gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={handleGoBack}
              className="p-2 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!backHistory.length}
              title="Back (Mouse Back / Alt+Left)"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleGoForward}
              className="p-2 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!forwardHistory.length}
              title="Forward (Mouse Forward / Alt+Right)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={handleRefresh}
              className="p-2 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              disabled={isLoading}
              title="Refresh (Ctrl+R)"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
            <Breadcrumbs
              items={breadcrumbItems}
              onNavigate={handleNavigateToPath}
              homePath={currentPath.startsWith("tg://") ? "tg://saved" : "/"}
            />
          </div>

          <div className="flex items-center gap-2">
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search files..."
            />

            <div className="flex items-center gap-1 ml-2">
              <button
                onClick={() => handleViewModeChange("list")}
                className={`p-2 rounded transition-colors ${viewMode === "list" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                title="List view"
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => handleViewModeChange("grid")}
                className={`p-2 rounded transition-colors ${viewMode === "grid" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                title="Grid view"
              >
                <Grid className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="h-12 bg-glass border-b border-border flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            {!isRecycleBinView && (
              <TelegramButton variant="secondary" size="sm" onClick={handleNewFolder}>
                <FolderPlus className="w-4 h-4" />
                New Folder
              </TelegramButton>
            )}

            {/* Contextual actions for selected file */}
            {selectedFile && !isRecycleBinView && (
              <>
                <TelegramButton
                  variant="secondary"
                  size="sm"
                  onClick={handleCopyPath}
                  aria-label="Copy path (Ctrl+C)"
                >
                  <Copy className="w-4 h-4" />
                </TelegramButton>

                <TelegramButton
                  variant="secondary"
                  size="sm"
                  onClick={handleRename}
                  aria-label="Rename (F2)"
                >
                  <Edit3 className="w-4 h-4" />
                </TelegramButton>

                <TelegramButton
                  variant="secondary"
                  size="sm"
                  onClick={() => setDeleteTarget(selectedFile)}
                  aria-label="Delete (Del)"
                >
                  <Trash2 className="w-4 h-4" />
                </TelegramButton>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1 px-2 py-1 rounded text-small text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
              <SortAsc className="w-3 h-3" />
              Name
            </button>
            <span className="text-small text-muted-foreground">
              {sortedFiles.length} {sortedFiles.length === 1 ? 'item' : 'items'}
            </span>
            {isLoadingSavedFiles ? (
              <span className="text-small text-muted-foreground inline-flex items-center gap-1">
                <div className="animate-spin rounded-full h-3 w-3 border-b border-primary" />
                Loading files... {syncProgressLabel}
              </span>
            ) : currentPath.startsWith("tg://saved") && isSavedBackfillSyncing && (
              <span className="text-small text-muted-foreground inline-flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
                Syncing... {syncProgressLabel}
              </span>
            )}
          </div>
        </div>

        {/* File list */}
        <div className="flex-1 flex min-h-0">
          <div
            className="relative flex-1 overflow-y-auto p-4"
            onDragOver={handleExplorerDragOver}
            onDragLeave={handleExplorerDragLeave}
            onDrop={handleExplorerDrop}
            onScroll={handleDirectoryScroll}
            onContextMenu={handleEmptyAreaContextMenu}
          >
            {(isExternalDragging || isUploadingFiles) && (
              <div className="pointer-events-none absolute inset-4 z-20 rounded-xl border-2 border-dashed border-primary/60 bg-primary/10 flex items-center justify-center">
                <p className="text-body font-medium text-foreground">
                  {isUploadingFiles
                    ? "Uploading files to Saved Messages..."
                    : "Drop files here to upload to Saved Messages"}
                </p>
              </div>
            )}

            {error ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <p className="text-body text-destructive mb-2">
                  Error: {error}
                </p>
                <TelegramButton onClick={() => loadDirectory(currentPath, { force: true })}>
                  Retry
                </TelegramButton>
              </div>
            ) : isLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-2"></div>
                <p className="text-body text-muted-foreground">
                  Loading directory contents...
                </p>
              </div>
            ) : isLoadingSavedFiles ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-2"></div>
                <p className="text-body text-muted-foreground">Loading files... {syncProgressLabel}</p>
              </div>
            ) : sortedFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <p className="text-body text-muted-foreground mb-2">
                  {search
                    ? "No files match your search"
                    : (isRecycleBinView ? "Recycle bin is empty" : "This folder is empty")}
                </p>
                {!search && !isRecycleBinView && (
                  <TelegramButton onClick={handleNewFolder}>
                    Create New Folder
                  </TelegramButton>
                )}
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="text-body text-link mt-2"
                  >
                    Clear search
                  </button>
                )}
              </div>
            ) : (
              <div className={viewMode === "list" ? "space-y-0.5" : "p-1"}>
                {viewMode === "list" ? (
                  sortedFiles.map((file) => (
                    <FileRow
                      key={file.path}
                      file={file}
                      isSelected={selectedFile?.path === file.path}
                      onSelect={() => handleFileSelect(file)}
                      onOpen={() => handleFileOpen(file)}
                      onContextMenu={(event) => handleFileContextMenu(event, file)}
                      draggable={isDraggableItem(file)}
                      isDropTarget={dropTargetPath === file.path}
                      onDragStart={(event) => handleItemDragStart(event, file)}
                      onDragEnd={handleItemDragEnd}
                      onDragOver={(event) => handleItemDragOver(event, file)}
                      onDragLeave={() => handleItemDragLeave(file)}
                      onDrop={(event) => handleItemDrop(event, file)}
                    />
                  ))
                ) : (
                  <FileGrid
                    files={sortedFiles}
                    selectedFile={selectedFile}
                    onSelect={handleFileSelect}
                    onOpen={handleFileOpen}
                    onContextMenu={(event, file) => handleFileContextMenu(event, file)}
                    isDraggable={isDraggableItem}
                    isDropTarget={(file) => dropTargetPath === file.path}
                    onDragStart={(event, file) => handleItemDragStart(event, file)}
                    onDragEnd={handleItemDragEnd}
                    onDragOver={(event, file) => handleItemDragOver(event, file)}
                    onDragLeave={(_, file) => handleItemDragLeave(file)}
                    onDrop={(event, file) => handleItemDrop(event, file)}
                  />
                )}

                {isLoadingMoreSavedItems && (
                  <div className="flex items-center justify-center py-4">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Details panel overlay */}
      {showDetails && !isRecycleBinView && (
        <div
          ref={detailsPanelRef}
          className={`absolute inset-y-0 left-0 z-[70] w-64 transition-all duration-200 ease-out ${isDetailsPanelOpen
            ? "translate-x-0 opacity-100"
            : "-translate-x-4 opacity-0 pointer-events-none"
            }`}
        >
          <DetailsPanel
            file={selectedFile}
            onClose={closeDetailsPanel}
            onToggleFavorite={handleToggleFavorite}
            onRename={handleRename}
            onDelete={() => selectedFile && setDeleteTarget(selectedFile)}
            onCopyPath={handleCopyPath}
            onOpenLocation={() => toast({ title: "Reveal in folder" })}
            isFavorite={selectedFile ? favorites.includes(selectedFile.path) : false}
          />
        </div>
      )}

      {contextMenuState && (
        <div
          ref={contextMenuRef}
          className="fixed z-[80] min-w-[220px] rounded-xl bg-glass shadow-2xl shadow-black/50 backdrop-saturate-150 p-1"
          style={{ left: `${contextMenuState.x}px`, top: `${contextMenuState.y}px` }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {contextMenuState.isEmptyArea ? (
            <>
              <button
                className={contextMenuItemClassName}
                onClick={() => {
                  closeContextMenu();
                  void handleNewFolder();
                }}
              >
                <FolderPlus className="w-4 h-4 text-muted-foreground" />
                <span>New Folder</span>
              </button>
              <button
                className={canPaste ? contextMenuItemClassName : contextMenuDisabledItemClassName}
                disabled={!canPaste}
                onClick={() => {
                  if (!canPaste) {
                    return;
                  }
                  closeContextMenu();
                  void handlePaste();
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
                  closeContextMenu();
                  void handleRestoreFromRecycleBin(contextTargetFile);
                }}
              >
                <RotateCcw className="w-4 h-4 text-muted-foreground" />
                <span>Restore</span>
              </button>

              <div className="my-1 h-px bg-border/70" />

              <button
                className={contextMenuDangerItemClassName}
                onClick={() => {
                  closeContextMenu();
                  handleContextDelete();
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
                  closeContextMenu();
                  void handleContextOpen();
                }}
              >
                <FolderOpen className="w-4 h-4 text-muted-foreground" />
                <span>Open</span>
              </button>

              {contextTargetFile && !contextTargetFile.isDirectory && isSavedVirtualFilePath(contextTargetFile.path) && (
                <button
                  className={contextMenuItemClassName}
                  onClick={() => {
                    closeContextMenu();
                    void handleDownloadSavedFile(contextTargetFile);
                  }}
                >
                  <Download className="w-4 h-4 text-muted-foreground" />
                  <span>Download</span>
                </button>
              )}

              {contextTargetFile && !contextTargetFile.isDirectory && (
                <button
                  className={contextMenuItemClassName}
                  onClick={() => {
                    closeContextMenu();
                    void handleShare(contextTargetFile);
                  }}
                >
                  <Share2 className="w-4 h-4 text-muted-foreground" />
                  <span>Share</span>
                </button>
              )}

              <div className="my-1 h-px bg-border/70" />

              <button
                className={contextMenuItemClassName}
                onClick={() => {
                  if (!contextTargetFile) {
                    return;
                  }
                  closeContextMenu();
                  handleStageClipboardItem("cut", contextTargetFile);
                }}
              >
                <Scissors className="w-4 h-4 text-muted-foreground" />
                <span>Cut</span>
              </button>
              <button
                className={contextMenuItemClassName}
                onClick={() => {
                  if (!contextTargetFile) {
                    return;
                  }
                  closeContextMenu();
                  handleStageClipboardItem("copy", contextTargetFile);
                }}
              >
                <Copy className="w-4 h-4 text-muted-foreground" />
                <span>Copy</span>
              </button>
              <button
                className={canPaste ? contextMenuItemClassName : contextMenuDisabledItemClassName}
                disabled={!canPaste}
                onClick={() => {
                  if (!canPaste) {
                    return;
                  }
                  closeContextMenu();
                  void handlePaste();
                }}
              >
                <ClipboardPaste className="w-4 h-4 text-muted-foreground" />
                <span>Paste</span>
              </button>

              <div className="my-1 h-px bg-border/70" />

              <button
                className={contextMenuItemClassName}
                onClick={() => {
                  closeContextMenu();
                  void handleRename(contextTargetFile);
                }}
              >
                <Edit3 className="w-4 h-4 text-muted-foreground" />
                <span>Rename</span>
              </button>
              <button
                className={contextMenuDangerItemClassName}
                onClick={() => {
                  closeContextMenu();
                  handleContextDelete();
                }}
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete</span>
              </button>

              <div className="my-1 h-px bg-border/70" />

              <button
                className={contextMenuItemClassName}
                onClick={() => {
                  closeContextMenu();
                  handleContextDetails(contextTargetFile);
                }}
              >
                <Info className="w-4 h-4 text-muted-foreground" />
                <span>Details</span>
              </button>
            </>
          )}
        </div>
      )}

      <TextInputDialog
        isOpen={isNewFolderDialogOpen}
        title="Create Folder"
        description="Enter a name for the new folder."
        value={newFolderName}
        placeholder="Folder name"
        confirmLabel="Create"
        cancelLabel="Cancel"
        onValueChange={setNewFolderName}
        onConfirm={() => {
          void handleConfirmNewFolder();
        }}
        onCancel={() => {
          setIsNewFolderDialogOpen(false);
          setNewFolderName("");
        }}
      />

      <TextInputDialog
        isOpen={!!renameTarget}
        title="Rename Item"
        description={renameTarget ? `Rename ${renameTarget.name}` : undefined}
        value={renameValue}
        placeholder="New name"
        confirmLabel="Rename"
        cancelLabel="Cancel"
        icon={<Edit3 className="w-4 h-4 text-primary" />}
        framed
        onValueChange={setRenameValue}
        onConfirm={() => {
          void handleConfirmRename();
        }}
        onCancel={() => {
          setRenameTarget(null);
          setRenameValue("");
        }}
      />

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title={isPermanentDeleteTarget ? "Delete Permanently" : (isSavedDeleteTarget ? "Move to Recycle Bin" : "Delete Item")}
        message={
          <p>
            {isPermanentDeleteTarget
              ? (
                <>
                  Delete <strong>{deleteTarget?.name}</strong> from Recycle Bin permanently?
                  This action cannot be undone.
                </>
              )
              : isSavedDeleteTarget
                ? (
                  <>
                    Move <strong>{deleteTarget?.name}</strong> to Recycle Bin?
                    You can restore it later.
                  </>
                )
              : (
                <>
                  Are you sure you want to delete <strong>{deleteTarget?.name}</strong>?
                  This action cannot be undone.
                </>
              )}
          </p>
        }
        confirmLabel={isPermanentDeleteTarget ? "Delete Permanently" : (isSavedDeleteTarget ? "Move to Recycle Bin" : "Delete")}
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
