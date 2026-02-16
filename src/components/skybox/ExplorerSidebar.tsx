import { Home, Star, Clock, FolderOpen, ChevronRight, Settings, LogOut, Trash2 } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import { TelegramButton } from "@/components/skybox/TelegramButton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SidebarMenu } from "./SidebarMenu";

interface SidebarItem {
  id: string;
  label: string;
  icon: React.ElementType;
  path?: string;
  onClick?: () => void;
}

const mainItems: SidebarItem[] = [
  { id: "saved", label: "Saved Messages", icon: Clock, path: "tg://saved" },
];

const savedSubItems: SidebarItem[] = [
  { id: "saved-recycle-bin", label: "Recycle Bin", icon: Trash2, path: "tg://saved/Recycle Bin" },
];

interface UserInfo {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  profile_photo?: string;
}

interface ExplorerSidebarProps {
  roots?: { id: string; path: string; name: string }[];
  onAddRoot?: () => void;
  currentPath?: string;
  userInfo?: UserInfo;
  avatarUrl?: string | null;
  phoneNumber?: string | null;
}

export function ExplorerSidebar({ roots = [], onAddRoot, currentPath, userInfo, avatarUrl, phoneNumber }: ExplorerSidebarProps) {
  const location = useLocation();
  const photoUrl = avatarUrl?.trim();
  const [photoFailed, setPhotoFailed] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPhotoFailed(false);
  }, [photoUrl]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isMenuOpen && sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isMenuOpen]);

  const handleRootClick = (path: string) => {
    // Navigate to explorer with the selected path
    // We'll handle the path navigation in the ExplorerPage
    window.dispatchEvent(new CustomEvent('navigate-to-path', { detail: path }));
  };

  const handleLogout = async () => {
    // Dispatch an event to the parent component to handle logout
    window.dispatchEvent(new CustomEvent('logout-request'));
  };

  // Get user's full name or fallback to username
  const displayName = userInfo
    ? `${userInfo.first_name || ''} ${userInfo.last_name || ''}`.trim()
    : 'User';

  // Get initials for the avatar
  const getInitials = () => {
    if (!userInfo) return 'U';

    const firstNameInitial = userInfo.first_name ? userInfo.first_name.charAt(0).toUpperCase() : '';
    const lastNameInitial = userInfo.last_name ? userInfo.last_name.charAt(0).toUpperCase() : '';

    if (firstNameInitial && lastNameInitial) {
      return firstNameInitial + lastNameInitial;
    } else if (firstNameInitial) {
      return firstNameInitial;
    } else if (lastNameInitial) {
      return lastNameInitial;
    } else if (userInfo.username) {
      return userInfo.username.charAt(0).toUpperCase();
    }

    return 'U';
  };

  return (
    <div ref={sidebarRef} className="w-64 h-full glass-sidebar flex flex-col relative overflow-hidden">
      <SidebarMenu
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        userInfo={userInfo}
        avatarUrl={avatarUrl}
        phoneNumber={phoneNumber}
        onLogout={handleLogout}
      />
      {/* User Profile Header */}
      <div className="p-4 border-b border-border">
        <button
          onClick={() => setIsMenuOpen(true)}
          className="flex items-center gap-3 w-full text-left hover:bg-sidebar-accent/50 p-2 rounded-lg transition-colors group"
        >
          <Avatar className="w-10 h-10 flex-shrink-0">
            {photoUrl && !photoFailed ? (
              <AvatarImage
                src={photoUrl}
                alt={displayName || "User"}
                onError={() => setPhotoFailed(true)}
              />
            ) : null}
            <AvatarFallback className="bg-primary text-primary-foreground font-semibold text-body">
              {getInitials()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-body font-medium text-foreground truncate">
              {displayName || 'User'}
            </p>
            <p className="text-small text-muted-foreground truncate">
              @{userInfo?.username || 'username'}
            </p>
          </div>
          <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${isMenuOpen ? "rotate-90" : ""}`} />
        </button>
      </div>

      {/* Main navigation */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <div className="px-2 py-1.5">
          <span className="text-small text-muted-foreground uppercase tracking-wider">Browse</span>
        </div>

        {mainItems.map((item) => {
          const Icon = item.icon;
          const isVirtual = item.path?.startsWith("tg://");
          const isActive = isVirtual
            ? currentPath === item.path
            : location.pathname === item.path;

          const content = (
            <>
              <Icon className="w-5 h-5" />
              <span className="text-body font-medium">{item.label}</span>
            </>
          );

          const className = `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 w-full text-left ${isActive
            ? "bg-sidebar-accent text-primary font-medium"
            : "text-foreground hover:bg-sidebar-accent/50"
            }`;

          if (isVirtual) {
            return (
              <button
                key={item.id}
                onClick={() => item.path && handleRootClick(item.path)}
                className={className}
              >
                {content}
              </button>
            );
          }

          return (
            <NavLink
              key={item.id}
              to={item.path || "#"}
              className={className}
            >
              {content}
            </NavLink>
          );
        })}

        {savedSubItems.map((item) => {
          const Icon = item.icon;
          const itemPath = item.path || "";
          const isActive = !!itemPath && !!currentPath && (
            currentPath === itemPath || currentPath.startsWith(`${itemPath}/`)
          );

          return (
            <button
              key={item.id}
              onClick={() => item.path && handleRootClick(item.path)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 w-full text-left ${isActive
                ? "bg-sidebar-accent text-primary font-medium"
                : "text-foreground hover:bg-sidebar-accent/50"
                }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-body font-medium">{item.label}</span>
            </button>
          );
        })}

      </div>
    </div>
  );
}
