import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-10 items-center justify-center rounded-md border border-border/70 bg-muted/60 backdrop-blur p-1 text-muted-foreground gap-1",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative inline-flex items-center justify-center whitespace-nowrap rounded-[6px] px-3.5 py-1.5 text-sm font-medium tracking-tight ring-offset-background transition-all duration-300",
      "hover:text-foreground hover:bg-background/40",
      "data-[state=active]:bg-card data-[state=active]:text-foreground",
      "data-[state=active]:shadow-[0_0_0_1px_hsl(var(--cyan)/0.35),0_4px_14px_-4px_hsl(var(--cyan)/0.4)]",
      "data-[state=active]:before:content-[''] data-[state=active]:before:absolute data-[state=active]:before:left-3 data-[state=active]:before:right-3 data-[state=active]:before:-bottom-px data-[state=active]:before:h-[2px] data-[state=active]:before:rounded-full data-[state=active]:before:bg-gradient-to-r data-[state=active]:before:from-transparent data-[state=active]:before:via-[hsl(var(--cyan))] data-[state=active]:before:to-transparent",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
