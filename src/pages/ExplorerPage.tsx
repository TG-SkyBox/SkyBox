import { useState, useEffect, useMemo, useCallback } from "react";
import { ExplorerSidebar } from "@/components/skybox/ExplorerSidebar";
import { SearchBar } from "@/components/skybox/SearchBar";
import { Breadcrumbs } from "@/components/skybox/Breadcrumbs";
import { FileRow, FileItem } from "@/components/skybox/FileRow";
import { FileGrid } from "@/components/skybox/FileGrid";
import { DetailsPanel } from "@/components/skybox/DetailsPanel";
import { ConfirmDialog } from "@/components/skybox/ConfirmDialog";
import { TelegramButton } from "@/components/skybox/TelegramButton";
import { FolderPlus, Grid, List, SortAsc, RefreshCw, Copy, Trash2, Edit3, ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { invoke } from "@tauri-apps/api/core";

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

const isVirtualPath = (path: string): boolean => path.startsWith("tg://");

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
  const isDirectory = item.file_type === "folder";
  if (isDirectory) {
    const folderPath = savedToVirtualPath(joinPath(item.file_path, item.file_name));
    return {
      name: item.file_name,
      path: folderPath,
      isDirectory: true,
      modifiedAt: item.modified_date,
    };
  }

  return {
    name: item.file_name,
    path: `tg://msg/${item.message_id}`,
    isDirectory: false,
    size: item.file_size,
    modifiedAt: item.modified_date,
    extension: extensionFromFileName(item.file_name),
    messageId: item.message_id > 0 ? item.message_id : undefined,
    thumbnail: item.thumbnail || undefined,
  };
};

export default function ExplorerPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null);
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
  const [backHistory, setBackHistory] = useState<string[]>([]);
  const [forwardHistory, setForwardHistory] = useState<string[]>([]);

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

    // Trigger indexing
    indexSavedMessages();
  }, [location.state]);

  const indexSavedMessages = async () => {
    try {
      const result: any = await invoke("tg_index_saved_messages");
      console.log("Indexing summary:", result);
      if (result.total_new_messages > 0) {
        toast({
          title: "Saved Messages Indexed",
          description: `Found ${result.total_new_messages} new messages.`,
        });
        // If we are currently viewing a Saved Messages path, refresh it
        if (currentPath.startsWith("tg://saved")) {
          loadDirectory(currentPath);
        }
      }
    } catch (error) {
      console.error("Error indexing saved messages:", error);
    }
  };

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
        loadDirectory(nextPath);
        return;
      }

      setBackHistory((prev) => [...prev, currentPath]);
      setForwardHistory([]);
      loadDirectory(nextPath);
    };

    window.addEventListener('navigate-to-path', handleNavigateEvent as EventListener);

    return () => {
      window.removeEventListener('navigate-to-path', handleNavigateEvent as EventListener);
    };
  }, [currentPath]);

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
      const isBackShortcut = e.key === "Backspace" || e.key === "BrowserBack" || (e.altKey && e.key === "ArrowLeft");
      const isForwardShortcut = e.key === "BrowserForward" || (e.altKey && e.key === "ArrowRight");

      if (canNavigateByKeyboard && isBackShortcut) {
        e.preventDefault();
        if (backHistory.length && !isLoading) {
          const previousPath = backHistory[backHistory.length - 1];
          setBackHistory((prev) => prev.slice(0, -1));
          setForwardHistory((prev) => [...prev, currentPath]);
          loadDirectory(previousPath);
        }
        return;
      }

      if (canNavigateByKeyboard && isForwardShortcut) {
        e.preventDefault();
        if (forwardHistory.length && !isLoading) {
          const nextPath = forwardHistory[forwardHistory.length - 1];
          setForwardHistory((prev) => prev.slice(0, -1));
          setBackHistory((prev) => [...prev, currentPath]);
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
        setShowDetails(false);
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
  }, [selectedFile, showDetails, backHistory, forwardHistory, currentPath, isLoading]);

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
        if (backHistory.length && !isLoading) {
          const previousPath = backHistory[backHistory.length - 1];
          setBackHistory((prev) => prev.slice(0, -1));
          setForwardHistory((prev) => [...prev, currentPath]);
          void loadDirectory(previousPath);
        }
      }

      if (event.button === 4) {
        event.preventDefault();
        event.stopPropagation();
        if (forwardHistory.length && !isLoading) {
          const nextPath = forwardHistory[forwardHistory.length - 1];
          setForwardHistory((prev) => prev.slice(0, -1));
          setBackHistory((prev) => [...prev, currentPath]);
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
  }, [backHistory, currentPath, forwardHistory, isLoading]);

  const loadDirectory = async (path: string) => {
    setIsLoading(true);
    setError(null);
    try {
      if (path.startsWith("tg://saved")) {
        const savedPath = virtualToSavedPath(path);
        const result: TelegramSavedItem[] = await invoke("tg_list_saved_items", { filePath: savedPath });
        const virtualItems = result.map(savedItemToFileItem);
        setFiles(virtualItems);
        setCurrentPath(path);
      } else {
        const result: FileEntry[] = await invoke("fs_list_dir", { path });
        const convertedFiles = result.map(convertFileEntryToFileItem);
        setFiles(convertedFiles);
        setCurrentPath(path);
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
    await loadDirectory(path);
  }, [currentPath]);

  const handleGoBack = useCallback(async () => {
    if (!backHistory.length || isLoading) {
      return;
    }

    const previousPath = backHistory[backHistory.length - 1];
    setBackHistory((prev) => prev.slice(0, -1));
    setForwardHistory((prev) => [...prev, currentPath]);
    await loadDirectory(previousPath);
  }, [backHistory, currentPath, isLoading]);

  const handleGoForward = useCallback(async () => {
    if (!forwardHistory.length || isLoading) {
      return;
    }

    const nextPath = forwardHistory[forwardHistory.length - 1];
    setForwardHistory((prev) => prev.slice(0, -1));
    setBackHistory((prev) => [...prev, currentPath]);
    await loadDirectory(nextPath);
  }, [currentPath, forwardHistory, isLoading]);

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
    if (!search.trim()) return files;
    const query = search.toLowerCase();
    return files.filter((f) => f.name.toLowerCase().includes(query));
  }, [search, files]);

  // Sort: directories first, then by name
  const sortedFiles = useMemo(() => {
    return [...filteredFiles].sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [filteredFiles]);

  const handleFileSelect = (file: FileItem) => {
    setSelectedFile(file);
    setShowDetails(true);
  };

  const handleFileOpen = async (file: FileItem) => {
    if (file.isDirectory) {
      navigateToPath(file.path);
      toast({
        title: "Opening folder",
        description: file.name,
      });
    } else {
      if (file.path.startsWith("tg://msg/")) {
        toast({
          title: "Cloud file selected",
          description: "Direct open for Saved Messages files is not available yet.",
        });
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
      await invoke("fs_delete", { path: deleteTarget.path });
      toast({
        title: "Deleted",
        description: `${deleteTarget.name} has been deleted`,
      });

      // Reload the current directory to reflect changes
      loadDirectory(currentPath);
      setDeleteTarget(null);
      if (selectedFile?.path === deleteTarget.path) {
        setSelectedFile(null);
        setShowDetails(false);
      }
    } catch (error) {
      const typedError = error as FsError;
      toast({
        title: "Error deleting item",
        description: typedError.message || "An unknown error occurred",
        variant: "destructive",
      });
    }
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    await loadDirectory(currentPath);
    setIsLoading(false);
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

  const handleCopyPath = () => {
    if (selectedFile) {
      navigator.clipboard.writeText(selectedFile.path);
      toast({
        title: "Path copied",
        description: "File path copied to clipboard"
      });
    }
  };

  const handleNewFolder = async () => {
    const folderName = prompt("Enter folder name:");
    if (!folderName) return;

    try {
      if (currentPath.startsWith("tg://saved")) {
        await invoke("tg_create_saved_folder", {
          parentPath: virtualToSavedPath(currentPath),
          folderName,
        });
      } else {
        const newPath = `${currentPath}/${folderName}`.replace("//", "/");
        await invoke("fs_create_dir", { path: newPath });
      }

      toast({
        title: "Folder created",
        description: `Created folder: ${folderName}`,
      });
      // Reload the current directory to show the new folder
      await loadDirectory(currentPath);
    } catch (error) {
      const typedError = error as FsError | TelegramError;
      toast({
        title: "Error creating folder",
        description: typedError.message || "An unknown error occurred",
        variant: "destructive",
      });
    }
  };

  const handleRename = () => {
    if (!selectedFile) return;

    const newName = prompt("Enter new name:", selectedFile.name);
    if (!newName || newName === selectedFile.name) return;

    // Construct new path
    const directory = selectedFile.path.substring(0, selectedFile.path.lastIndexOf('/'));
    const newPath = `${directory}/${newName}`.replace("//", "/");

    toast({
      title: "Rename feature",
      description: "Rename functionality would be implemented here",
    });
  };

  const isDraggableItem = (file: FileItem) => !isVirtualPath(file.path);

  const getDraggedSourcePath = (event: React.DragEvent): string | null => {
    const fromTransfer = event.dataTransfer.getData(INTERNAL_DRAG_MIME);
    if (fromTransfer) {
      return fromTransfer;
    }

    return draggedPath;
  };

  const canDropToTarget = (sourcePath: string, target: FileItem): boolean => {
    if (!target.isDirectory) {
      return false;
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

    const sourceItem = files.find((file) => normalizePath(file.path) === normalizedSourcePath);
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

    event.preventDefault();
    event.stopPropagation();

    const destinationPath = joinPath(target.path, getPathName(sourcePath));

    try {
      await invoke("move_file", { source: sourcePath, destination: destinationPath });
      toast({
        title: "Moved",
        description: `${getPathName(sourcePath)} moved to ${target.name}`,
      });

      if (selectedFile?.path === sourcePath) {
        setSelectedFile(null);
        setShowDetails(false);
      }

      await loadDirectory(currentPath);
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
        await loadDirectory(currentPath);

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
    if (!isExternalFileDrag(event)) {
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
    if (!isExternalFileDrag(event)) {
      return;
    }

    event.preventDefault();
    setIsExternalDragging(false);

    await handleUploadFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <div className="h-screen flex overflow-hidden">
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
              disabled={!backHistory.length || isLoading}
              title="Back (Backspace / Alt+Left)"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleGoForward}
              className="p-2 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!forwardHistory.length || isLoading}
              title="Forward (Alt+Right)"
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
                onClick={() => setViewMode("list")}
                className={`p-2 rounded transition-colors ${viewMode === "list" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                title="List view"
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode("grid")}
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
            <TelegramButton variant="secondary" size="sm" onClick={handleNewFolder}>
              <FolderPlus className="w-4 h-4" />
              New Folder
            </TelegramButton>

            {/* Contextual actions for selected file */}
            {selectedFile && (
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
          </div>
        </div>

        {/* File list */}
        <div className="flex-1 flex min-h-0">
          <div
            className="relative flex-1 overflow-y-auto p-4"
            onDragOver={handleExplorerDragOver}
            onDragLeave={handleExplorerDragLeave}
            onDrop={handleExplorerDrop}
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
                <TelegramButton onClick={() => loadDirectory(currentPath)}>
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
            ) : sortedFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <p className="text-body text-muted-foreground mb-2">
                  {search ? "No files match your search" : "This folder is empty"}
                </p>
                {!search && (
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
                      onContextMenu={(e) => {
                        e.preventDefault();
                        handleFileSelect(file);
                      }}
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
                    onContextMenu={(e, file) => {
                      e.preventDefault();
                      handleFileSelect(file);
                    }}
                    isDraggable={isDraggableItem}
                    isDropTarget={(file) => dropTargetPath === file.path}
                    onDragStart={(event, file) => handleItemDragStart(event, file)}
                    onDragEnd={handleItemDragEnd}
                    onDragOver={(event, file) => handleItemDragOver(event, file)}
                    onDragLeave={(_, file) => handleItemDragLeave(file)}
                    onDrop={(event, file) => handleItemDrop(event, file)}
                  />
                )}
              </div>
            )}
          </div>

          {/* Details panel */}
          {showDetails && (
            <DetailsPanel
              file={selectedFile}
              onClose={() => setShowDetails(false)}
              onToggleFavorite={handleToggleFavorite}
              onRename={handleRename}
              onDelete={() => selectedFile && setDeleteTarget(selectedFile)}
              onCopyPath={handleCopyPath}
              onOpenLocation={() => toast({ title: "Reveal in folder" })}
              isFavorite={selectedFile ? favorites.includes(selectedFile.path) : false}
            />
          )}
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Delete Item"
        message={
          <p>
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>?
            This action cannot be undone.
          </p>
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
