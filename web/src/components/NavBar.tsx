"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { useAuth } from "@/providers/auth-provider";
import { useTheme } from "@/hooks/useTheme";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { User, Settings, LogOut, Sun, Moon, Hexagon, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

function ThemePill() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center rounded-[8px] bg-muted p-0.5">
      <button
        type="button"
        onClick={() => setTheme("light")}
        aria-label="Switch to light theme"
        aria-pressed={theme === "light"}
        className={cn(
          "cursor-pointer rounded-[6px] p-1.5 transition-all",
          theme === "light"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Sun className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => setTheme("dark")}
        aria-label="Switch to dark theme"
        aria-pressed={theme === "dark"}
        className={cn(
          "cursor-pointer rounded-[6px] p-1.5 transition-all",
          theme === "dark"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Moon className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

export function NavBar() {
  const { status, builder, logout } = useAuth();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    queueMicrotask(() => setMenuOpen(false));
  }, [pathname]);

  const navLinks =
    status === "authenticated"
      ? [
          { href: "/world", label: "World" },
          { href: "/leaderboard", label: "Leaderboard" },
          { href: "/research", label: "Research" },
          { href: "/dashboard", label: "Dashboard" },
        ]
      : [
          { href: "/world", label: "World" },
          { href: "/leaderboard", label: "Leaderboard" },
          { href: "/research", label: "Research" },
        ];

  return (
    <header className="sticky top-0 z-50">
      <div
        className={cn(
          "relative transition-all duration-300",
          scrolled && "backdrop-blur-lg"
        )}
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          {/* Left: logo */}
          <Link href="/" className="text-foreground" aria-label="Hive home">
            <Hexagon className="size-5" aria-hidden="true" />
          </Link>

          {/* Center: nav links — desktop only */}
          <nav
            className="pointer-events-none absolute inset-x-0 hidden justify-center md:flex"
            aria-label="Main navigation"
          >
            <div className="pointer-events-auto flex items-center gap-1">
              {navLinks.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "rounded-[6px] px-2 py-1 text-sm font-medium transition-all",
                    pathname === href
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground active:bg-muted"
                  )}
                >
                  {label}
                </Link>
              ))}
            </div>
          </nav>

          {/* Right: theme + auth + mobile hamburger */}
          <div className="ml-auto flex items-center gap-3">
            {status === "loading" ? null : (
              <>
                <ThemePill />

                {/* Desktop: Watch now CTA (anonymous) */}
                {status === "anonymous" && (
                  <Link
                    href="/register"
                    className="hidden h-7 items-center justify-center rounded-[8px] bg-primary px-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/80 md:inline-flex"
                  >
                    Watch now
                  </Link>
                )}

                {/* Desktop: avatar dropdown (authenticated) */}
                {status === "authenticated" && (
                  <div className="hidden md:block">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="cursor-pointer rounded-full focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Account menu"
                      >
                        <div className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                          {builder?.display_name
                            ? builder.display_name.slice(0, 2).toUpperCase()
                            : "HV"}
                        </div>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          render={<Link href="/profile" />}
                          className="cursor-pointer"
                        >
                          <User className="size-4" />
                          Profile
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          render={<Link href="/settings" />}
                          className="cursor-pointer"
                        >
                          <Settings className="size-4" />
                          Settings
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={logout}
                          className="cursor-pointer"
                        >
                          <LogOut className="size-4" />
                          Logout
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}

                {/* Mobile: hamburger (all non-loading states) */}
                <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                  <SheetTrigger
                    className="cursor-pointer rounded-[6px] p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
                    aria-label="Open navigation menu"
                  >
                    <Menu className="size-5" aria-hidden="true" />
                  </SheetTrigger>
                  <SheetContent side="right" className="w-64 p-0" showCloseButton={false}>
                    <SheetTitle className="sr-only">Navigation</SheetTitle>
                    <nav
                      className="flex flex-col gap-1 px-3 py-4"
                      aria-label="Mobile navigation"
                    >
                      {navLinks.map(({ href, label }) => (
                        <Link
                          key={href}
                          href={href}
                          className={cn(
                            "rounded-[6px] px-3 py-2 text-sm font-medium transition-all",
                            pathname === href
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          )}
                        >
                          {label}
                        </Link>
                      ))}

                      <div className="my-1 h-px bg-border" />

                      {status === "anonymous" ? (
                        <Link
                          href="/register"
                          className="inline-flex h-8 items-center justify-center rounded-[8px] bg-primary px-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/80"
                        >
                          Watch now
                        </Link>
                      ) : (
                        <>
                          <Link
                            href="/profile"
                            className="flex items-center gap-2 rounded-[6px] px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          >
                            <User className="size-4" />
                            Profile
                          </Link>
                          <Link
                            href="/settings"
                            className="flex items-center gap-2 rounded-[6px] px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          >
                            <Settings className="size-4" />
                            Settings
                          </Link>
                          <div className="my-1 h-px bg-border" />
                          <button
                            type="button"
                            onClick={logout}
                            className="flex items-center gap-2 rounded-[6px] px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          >
                            <LogOut className="size-4" />
                            Logout
                          </button>
                        </>
                      )}
                    </nav>
                  </SheetContent>
                </Sheet>
              </>
            )}
          </div>
        </div>

        {/* Bottom border on scroll */}
        <div
          className={cn(
            "pointer-events-none h-px transition-opacity duration-200",
            scrolled ? "bg-border/50 opacity-100" : "opacity-0"
          )}
        />
      </div>
    </header>
  );
}
