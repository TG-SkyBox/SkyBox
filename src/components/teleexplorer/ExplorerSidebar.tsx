import { Home, Star, Clock, FolderOpen, ChevronRight, Settings } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

interface SidebarItem {
  id: string;
  label: string;
  icon: React.ElementType;
  path?: string;
  onClick?: () => void;
}

const mainItems: SidebarItem[] = [
  { id: "home", label: "Home", icon: Home, path: "/explorer" },
  { id: "favorites", label: "Favorites", icon: Star, path: "/explorer/favorites" },
  { id: "recent", label: "Recent", icon: Clock, path: "/explorer/recent" },
];

interface ExplorerSidebarProps {
  roots?: { id: string; path: string; name: string }[];
  onAddRoot?: () => void;
  currentPath?: string;
}

export function ExplorerSidebar({ roots = [], onAddRoot, currentPath }: ExplorerSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="w-64 h-full glass-sidebar flex flex-col">
      {/* User Profile Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
            <span className="text-primary-foreground font-semibold text-body">JD</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-body font-medium text-foreground truncate">John Doe</p>
            <p className="text-small text-muted-foreground truncate">@johndoe</p>
          </div>
        </div>
      </div>

      {/* Main navigation */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <div className="px-2 py-1.5">
          <span className="text-small text-muted-foreground uppercase tracking-wider">Browse</span>
        </div>
        
        {mainItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          
          return (
            <NavLink
              key={item.id}
              to={item.path || "#"}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 ${
                isActive
                  ? "bg-sidebar-accent text-primary font-medium"
                  : "text-foreground hover:bg-sidebar-accent/50"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-body font-medium">{item.label}</span>
            </NavLink>
          );
        })}

        {/* Locations section */}
        <div className="mt-4 px-2 py-1.5 flex items-center justify-between">
          <span className="text-small text-muted-foreground uppercase tracking-wider">Locations</span>
          <button
            onClick={onAddRoot}
            className="text-small text-primary hover:text-accent transition-colors"
          >
            + Add
          </button>
        </div>

        {roots.length === 0 ? (
          <div className="px-3 py-2">
            <p className="text-small text-muted-foreground">
              No folders added yet
            </p>
          </div>
        ) : (
          roots.map((root) => {
            const isActive = currentPath?.startsWith(root.path);
            return (
              <NavLink
                key={root.id}
                to={`/explorer?path=${encodeURIComponent(root.path)}`}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 ${
                  isActive
                    ? "bg-sidebar-accent text-primary font-medium"
                    : "text-foreground hover:bg-sidebar-accent/50"
                }`}
              >
                <FolderOpen className="w-5 h-5" />
                <span className="text-body flex-1 truncate">{root.name}</span>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </NavLink>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-border">
        <button 
          onClick={() => navigate("/settings")}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-foreground hover:bg-sidebar-accent/50 transition-all duration-150"
        >
          <Settings className="w-5 h-5" />
          <span className="text-body">Settings</span>
        </button>
      </div>
    </div>
  );
}
