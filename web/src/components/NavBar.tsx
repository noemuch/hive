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
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { User, LogOut, Sun, Moon, Hexagon, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/initials";

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
  const [menuOpen, setMenuOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => {
    queueMicrotask(() => setMenuOpen(false));
  }, [pathname]);

  const navLinks =
    status === "authenticated"
      ? [{ href: "/dashboard", label: "Dashboard" }]
      : [];

  return (
    <header className="sticky top-0 z-50">
      <div
        className="relative bg-background"
      >
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          {/* Left: logo */}
          <Link href="/" className="flex items-center gap-1.5 text-foreground" aria-label="Hive home">
            <Hexagon className="size-5" aria-hidden="true" />
            <span className="hidden text-sm font-semibold sm:inline">Hive</span>
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

                {/* Desktop: Get started CTA (anonymous) */}
                {status === "anonymous" && (
                  <Link
                    href="/register"
                    className="hidden h-7 items-center justify-center rounded-[8px] bg-primary px-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/80 md:inline-flex"
                  >
                    Get started
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
                          {getInitials(builder?.display_name ?? "")}
                        </div>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56 shadow-none border-foreground/10">
                        {/* Avatar + identity */}
                        <div className="flex items-center gap-2.5 px-2.5 py-2.5">
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {getInitials(builder?.display_name ?? "")}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium leading-tight truncate">{builder?.display_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {builder?.agent_count ?? 0}
                              {builder?.tier_limit === -1 ? "" : `/${builder?.tier_limit}`} agent slots
                            </p>
                          </div>
                        </div>
                        <DropdownMenuItem
                          render={<Link href="/dashboard" />}
                          className="cursor-pointer h-8 gap-2 px-2 py-0 focus:bg-foreground/5"
                        >
                          <User className="size-4 text-muted-foreground" />
                          Profile
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={logout}
                          className="cursor-pointer h-8 gap-2 px-2 py-0 focus:bg-foreground/5"
                        >
                          <LogOut className="size-4 text-muted-foreground" />
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

                      <Separator className="my-1" />

                      {status === "anonymous" ? (
                        <Link
                          href="/register"
                          className="inline-flex h-8 items-center justify-center rounded-[8px] bg-primary px-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/80"
                        >
                          Get started
                        </Link>
                      ) : (
                        <>
                          <Link
                            href="/dashboard"
                            className="flex items-center gap-2 rounded-[6px] px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          >
                            <User className="size-4" />
                            Profile
                          </Link>
                          <Separator className="my-1" />
                          <Button
                            variant="ghost"
                            onClick={logout}
                            className="w-full justify-start gap-2 rounded-[6px] px-3 py-2 h-auto text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          >
                            <LogOut className="size-4" />
                            Logout
                          </Button>
                        </>
                      )}
                    </nav>
                  </SheetContent>
                </Sheet>
              </>
            )}
          </div>
        </div>

      </div>
    </header>
  );
}
