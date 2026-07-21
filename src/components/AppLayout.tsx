import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { NotificationCenter } from "./NotificationCenter";
import { GlobalSearch } from "./GlobalSearch";
import { WatermarkOverlay } from "./WatermarkOverlay";

export const AppLayout = ({ children }: { children: ReactNode }) => (
  <SidebarProvider>
    <div className="min-h-screen flex w-full bg-background">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-10 flex min-h-14 flex-wrap items-center gap-2 border-b border-border/70 bg-card/60 px-3 py-2 backdrop-blur-xl sm:flex-nowrap sm:gap-3 sm:px-4">
          <SidebarTrigger className="text-muted-foreground hover:text-accent transition-colors" />
          <div className="hidden h-5 w-px bg-border sm:block" />
          <div className="flex min-w-0 flex-1 items-center gap-2 text-xs font-mono tracking-wider text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            <span className="truncate">事前绩效评估管理平台</span>
            <span className="hidden text-border lg:inline">/</span>
            <span className="hidden text-foreground/70 lg:inline">PRE-PERFORMANCE EVALUATION</span>
          </div>
          <div className="ml-auto flex w-auto max-w-full items-center gap-2 text-[11px] font-mono text-muted-foreground tabular-nums">
            <GlobalSearch />
            <NotificationCenter />
            <span className="hidden lg:inline">v1.0.0</span>
          </div>
        </header>
        <main className="flex-1 overflow-x-hidden overflow-y-auto">
          <WatermarkOverlay opacity={0.04} className="min-h-full">
            <div className="mx-auto w-full max-w-screen-2xl px-3 py-4 animate-fade-in-up sm:px-6 sm:py-6 lg:px-8 lg:py-8">
              {children}
            </div>
          </WatermarkOverlay>
        </main>
      </div>
    </div>
  </SidebarProvider>
);
