import type { Dispatch, ReactNode, SetStateAction } from "react";
import { CheckCircle2, Eye, LogOut, MessageSquarePlus, Settings, UploadCloud } from "lucide-react";
import { statusTone } from "@/app/format";
import type { AnnotationMode, DashboardView, Session, SettingsTab } from "@/app/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

interface DashboardShellProps {
  session: Session;
  activeSidebarItem: "uploads" | "previews" | "settings" | DashboardView;
  hasReviewWorkspace: boolean;
  pageTitle: string;
  pageSubtitle: string;
  status: string;
  statusLabel: string;
  setView: Dispatch<SetStateAction<DashboardView>>;
  setSettingsTab: Dispatch<SetStateAction<SettingsTab>>;
  setStatus: Dispatch<SetStateAction<string>>;
  chooseAnnotationMode: (mode: AnnotationMode) => void;
  loadSettings: () => void | Promise<void>;
  logout: () => void | Promise<void>;
  children: ReactNode;
}

export function DashboardShell({
  session,
  activeSidebarItem,
  hasReviewWorkspace,
  pageTitle,
  pageSubtitle,
  status,
  statusLabel,
  setView,
  setSettingsTab,
  setStatus,
  chooseAnnotationMode,
  loadSettings,
  logout,
  children
}: DashboardShellProps) {
  return (
    <TooltipProvider>
      <SidebarProvider className="appShell">
        <Sidebar collapsible="none" className="appSidebar">
          <SidebarHeader className="sidebarHeader">
            <div className="brand">
              <span className="brandMark">O</span>
              <span>OpenDrop</span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Deploy</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive={activeSidebarItem === "uploads"} onClick={() => setView("uploads")}>
                      <UploadCloud size={16} /> <span>New drop</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {hasReviewWorkspace ? (
                    <SidebarMenuItem>
                      <SidebarMenuButton isActive={activeSidebarItem === "previews"} onClick={() => setView("uploads")}>
                        <Eye size={16} /> <span>Preview</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ) : null}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {hasReviewWorkspace ? (
              <SidebarGroup>
                <SidebarGroupLabel>Review</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        isActive={false}
                        onClick={() => {
                          setView("uploads");
                          chooseAnnotationMode("comment");
                        }}
                      >
                        <MessageSquarePlus size={16} /> <span>Annotations</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        isActive={false}
                        onClick={() => {
                          setView("uploads");
                          setStatus("Use the version selector in the preview toolbar.");
                        }}
                      >
                        <CheckCircle2 size={16} /> <span>Versions</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ) : null}

            <SidebarGroup>
              <SidebarGroupLabel>Manage</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={activeSidebarItem === "settings"}
                      onClick={() => {
                        setView("settings");
                        setSettingsTab("namespaces");
                        loadSettings();
                      }}
                    >
                      <Settings size={16} /> <span>Settings</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="sidebarFooter">
            <div className="sidebarAccount">
              {session.authenticated ? (
                <>
                  <span className="sidebarAccountLabel">Default namespace</span>
                  <strong>/{session.user?.defaultNamespace}</strong>
                </>
              ) : (
                <>
                  <span className="sidebarAccountLabel">Preview access</span>
                  <strong>Public viewer</strong>
                </>
              )}
            </div>
            {session.authenticated ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="outline" className="logoutButton">
                    <LogOut size={15} /> Log out
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Log out of OpenDrop?</AlertDialogTitle>
                    <AlertDialogDescription>
                      You’ll return to the sign-in screen. Any selected upload files that have not been published will be cleared.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Stay signed in</AlertDialogCancel>
                    <AlertDialogAction onClick={logout}>Log out</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </SidebarFooter>
        </Sidebar>

        <main className="workspace">
          <header className="topbar">
            <div className="topbarTitle">
              <h1>{pageTitle}</h1>
              <p>{pageSubtitle}</p>
            </div>
            <div className="topbarActions">
              <Badge aria-live="polite" variant={status ? "default" : "secondary"} className={`statusBadge ${statusTone(statusLabel)}`}>
                {statusLabel}
              </Badge>
            </div>
          </header>

          {children}
        </main>
      </SidebarProvider>
    </TooltipProvider>
  );
}
