import { useState, useMemo } from "react";
import { ExplorerSidebar } from "@/components/teleexplorer/ExplorerSidebar";
import { SearchBar } from "@/components/teleexplorer/SearchBar";
import { Breadcrumbs } from "@/components/teleexplorer/Breadcrumbs";
import { FileRow, FileItem } from "@/components/teleexplorer/FileRow";
import { DetailsPanel } from "@/components/teleexplorer/DetailsPanel";
import { ConfirmDialog } from "@/components/teleexplorer/ConfirmDialog";
import { TelegramButton } from "@/components/teleexplorer/TelegramButton";
import { FolderPlus, Grid, List, SortAsc, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";

// Mock data for demo
const mockFiles: FileItem[] = [
  { name: "Documents", path: "/home/user/Documents", isDirectory: true, modifiedAt: "2025-01-20T10:30:00" },
  { name: "Downloads", path: "/home/user/Downloads", isDirectory: true, modifiedAt: "2025-01-21T08:15:00" },
  { name: "Pictures", path: "/home/user/Pictures", isDirectory: true, modifiedAt: "2025-01-19T14:22:00" },
  { name: "Projects", path: "/home/user/Projects", isDirectory: true, modifiedAt: "2025-01-21T16:45:00" },
  { name: "Music", path: "/home/user/Music", isDirectory: true, modifiedAt: "2025-01-15T09:00:00" },
  { name: "Videos", path: "/home/user/Videos", isDirectory: true, modifiedAt: "2025-01-18T11:30:00" },
  { name: "report-2025.pdf", path: "/home/user/report-2025.pdf", isDirectory: false, size: 2457600, modifiedAt: "2025-01-21T15:30:00", extension: "pdf" },
  { name: "notes.txt", path: "/home/user/notes.txt", isDirectory: false, size: 4096, modifiedAt: "2025-01-20T09:15:00", extension: "txt" },
  { name: "screenshot.png", path: "/home/user/screenshot.png", isDirectory: false, size: 1048576, modifiedAt: "2025-01-21T12:00:00", extension: "png" },
  { name: "project.zip", path: "/home/user/project.zip", isDirectory: false, size: 52428800, modifiedAt: "2025-01-19T16:45:00", extension: "zip" },
  { name: "config.json", path: "/home/user/config.json", isDirectory: false, size: 2048, modifiedAt: "2025-01-17T08:30:00", extension: "json" },
  { name: "video-tutorial.mp4", path: "/home/user/video-tutorial.mp4", isDirectory: false, size: 157286400, modifiedAt: "2025-01-16T14:00:00", extension: "mp4" },
];

const mockRoots = [
  { id: "1", path: "/home/user", name: "Home" },
  { id: "2", path: "/media/external", name: "External Drive" },
];

export default function ExplorerPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const currentPath = "/home/user";
  const breadcrumbItems = [
    { name: "home", path: "/home" },
    { name: "user", path: "/home/user" },
  ];

  const filteredFiles = useMemo(() => {
    if (!search.trim()) return mockFiles;
    const query = search.toLowerCase();
    return mockFiles.filter((f) => f.name.toLowerCase().includes(query));
  }, [search]);

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

  const handleFileOpen = (file: FileItem) => {
    if (file.isDirectory) {
      toast({
        title: "Opening folder",
        description: file.name,
      });
    } else {
      toast({
        title: "Opening file",
        description: file.name,
      });
    }
  };

  const handleToggleFavorite = () => {
    if (!selectedFile) return;
    const path = selectedFile.path;
    if (favorites.includes(path)) {
      setFavorites(favorites.filter((f) => f !== path));
      toast({ title: "Removed from favorites" });
    } else {
      setFavorites([...favorites, path]);
      toast({ title: "Added to favorites" });
    }
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    toast({
      title: "Deleted",
      description: `${deleteTarget.name} has been deleted`,
    });
    setDeleteTarget(null);
    if (selectedFile?.path === deleteTarget.path) {
      setSelectedFile(null);
      setShowDetails(false);
    }
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    await new Promise((r) => setTimeout(r, 500));
    setIsLoading(false);
    toast({ title: "Refreshed" });
  };

  const handleLogout = () => {
    toast({ title: "Logged out" });
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
      toast({ title: "Path copied to clipboard" });
    }
  };

  const handleNewFolder = () => {
    toast({
      title: "New folder",
      description: "Create folder dialog would open",
    });
  };

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      {/* Sidebar */}
      <ExplorerSidebar
        roots={mockRoots}
        onAddRoot={handleAddRoot}
        currentPath={currentPath}
      />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="h-14 bg-glass border-b border-border flex items-center justify-between px-4 gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={handleRefresh}
              className="p-2 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              disabled={isLoading}
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
            <Breadcrumbs items={breadcrumbItems} onNavigate={(path) => console.log("Navigate to", path)} />
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
                className={`p-2 rounded transition-colors ${
                  viewMode === "list" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode("grid")}
                className={`p-2 rounded transition-colors ${
                  viewMode === "grid" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
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
          </div>

          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1 px-2 py-1 rounded text-small text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
              <SortAsc className="w-3 h-3" />
              Name
            </button>
            <span className="text-small text-muted-foreground">
              {sortedFiles.length} items
            </span>
          </div>
        </div>

        {/* File list */}
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto p-4">
            {sortedFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <p className="text-body text-muted-foreground mb-2">
                  {search ? "No files match your search" : "This folder is empty"}
                </p>
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="text-body text-link"
                  >
                    Clear search
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-0.5">
                {sortedFiles.map((file) => (
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
                  />
                ))}
              </div>
            )}
          </div>

          {/* Details panel */}
          {showDetails && (
            <DetailsPanel
              file={selectedFile}
              onClose={() => setShowDetails(false)}
              onToggleFavorite={handleToggleFavorite}
              onRename={() => toast({ title: "Rename", description: "Rename dialog would open" })}
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
