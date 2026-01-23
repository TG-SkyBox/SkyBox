import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { 
  ArrowLeft, 
  User, 
  Bell, 
  Shield, 
  Palette, 
  HardDrive, 
  Info,
  ChevronRight,
  LogOut,
  Moon,
  Sun,
  Monitor
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface SettingItemProps {
  icon: React.ElementType;
  label: string;
  description?: string;
  onClick?: () => void;
  rightElement?: React.ReactNode;
}

function SettingItem({ icon: Icon, label, description, onClick, rightElement }: SettingItemProps) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-sidebar-accent/50 transition-all duration-150 text-left"
    >
      <div className="w-10 h-10 rounded-lg bg-sidebar-accent flex items-center justify-center flex-shrink-0">
        <Icon className="w-5 h-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-body font-medium text-foreground">{label}</p>
        {description && (
          <p className="text-small text-muted-foreground truncate">{description}</p>
        )}
      </div>
      {rightElement || <ChevronRight className="w-5 h-5 text-muted-foreground" />}
    </button>
  );
}

interface SettingSectionProps {
  title: string;
  children: React.ReactNode;
}

function SettingSection({ title, children }: SettingSectionProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-small uppercase tracking-wider text-muted-foreground px-4">{title}</h3>
      <div className="glass-card p-2 space-y-1">
        {children}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");

  const handleLogout = () => {
    toast({
      title: "Logged out",
      description: "You have been logged out successfully",
    });
    navigate("/login");
  };

  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="h-16 bg-glass border-b border-border flex items-center px-4 gap-4">
        <button
          onClick={() => navigate("/explorer")}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-all"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-title">Settings</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Profile Section */}
          <div className="glass-card p-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-xl">JD</span>
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-foreground">John Doe</h2>
                <p className="text-body text-muted-foreground">@johndoe</p>
              </div>
              <button className="px-4 py-2 rounded-lg bg-sidebar-accent text-foreground hover:bg-sidebar-accent/80 transition-colors text-body">
                Edit Profile
              </button>
            </div>
          </div>

          {/* Account Settings */}
          <SettingSection title="Account">
            <SettingItem
              icon={User}
              label="Profile"
              description="Manage your profile information"
            />
            <SettingItem
              icon={Shield}
              label="Privacy & Security"
              description="Password, 2FA, sessions"
            />
            <SettingItem
              icon={Bell}
              label="Notifications"
              description="Configure notification preferences"
            />
          </SettingSection>

          {/* Appearance */}
          <SettingSection title="Appearance">
            <SettingItem
              icon={Palette}
              label="Theme"
              description={theme.charAt(0).toUpperCase() + theme.slice(1)}
              onClick={() => {
                const themes: ("dark" | "light" | "system")[] = ["dark", "light", "system"];
                const currentIndex = themes.indexOf(theme);
                const nextTheme = themes[(currentIndex + 1) % themes.length];
                setTheme(nextTheme);
                toast({
                  title: "Theme updated",
                  description: `Theme set to ${nextTheme}`,
                });
              }}
              rightElement={<ThemeIcon className="w-5 h-5 text-muted-foreground" />}
            />
          </SettingSection>

          {/* Storage */}
          <SettingSection title="Storage">
            <SettingItem
              icon={HardDrive}
              label="Storage & Data"
              description="Manage cached files and data"
            />
          </SettingSection>

          {/* About */}
          <SettingSection title="About">
            <SettingItem
              icon={Info}
              label="About TeleExplorer"
              description="Version 1.0.0"
            />
          </SettingSection>

          {/* Logout */}
          <div className="glass-card p-2">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-destructive/10 transition-all duration-150 text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-destructive/20 flex items-center justify-center flex-shrink-0">
                <LogOut className="w-5 h-5 text-destructive" />
              </div>
              <div className="flex-1">
                <p className="text-body font-medium text-destructive">Log Out</p>
                <p className="text-small text-muted-foreground">Sign out of your account</p>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 text-center border-t border-border">
        <p className="text-small text-muted-foreground">
          TeleExplorer 1.0.0
        </p>
      </div>
    </div>
  );
}
