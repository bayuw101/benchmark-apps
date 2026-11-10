import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "Benchmark",
  description: "Arbiter performance audit platform",
};

// Set the theme before first paint so dark mode doesn't flash light. Same rule as parseTheme()
// in lib/theme.ts: the stored value, but only "dark" counts; anything else (or no storage) is light.
const themeScript = `try{document.documentElement.setAttribute("data-theme",localStorage.getItem("theme")==="dark"?"dark":"light")}catch(e){document.documentElement.setAttribute("data-theme","light")}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
