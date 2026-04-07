import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const SCALES = [
  { name: "Neutral", prefix: "neutral" },
  { name: "Primary", prefix: "primary" },
  { name: "Danger", prefix: "danger" },
  { name: "Success", prefix: "success" },
  { name: "Warning", prefix: "warning" },
] as const

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950, 975] as const

export default function SmokeTestPage() {
  return (
    <main className="min-h-screen bg-background text-foreground p-8 space-y-10">
      <h1 className="text-2xl font-bold">Hive Design System — Smoke Test</h1>
      <p className="text-muted-foreground font-mono text-sm">
        JetBrains Mono — muted-foreground (neutral-500)
      </p>

      {/* All scales */}
      {SCALES.map(({ name, prefix }) => (
        <section key={prefix} className="space-y-2">
          <h2 className="text-lg font-semibold">{name}</h2>
          <div className="flex gap-1">
            {STEPS.map(step => (
              <div key={step} className="flex flex-col items-center gap-1">
                <div
                  className="w-10 h-10 rounded"
                  style={{ backgroundColor: `var(--color-${prefix}-${step})` }}
                />
                <span className="text-[10px] text-muted-foreground">{step}</span>
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* Semantic accents */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Semantic Accents</h2>
        <div className="flex gap-3">
          {[
            { name: "green", var: "--accent-green" },
            { name: "purple", var: "--accent-purple" },
            { name: "cyan", var: "--accent-cyan" },
          ].map(({ name, var: v }) => (
            <div key={name} className="flex flex-col items-center gap-1">
              <div className="w-10 h-10 rounded" style={{ backgroundColor: `var(${v})` }} />
              <span className="text-[10px] text-muted-foreground">{name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Shadcn tokens */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Shadcn Tokens</h2>
        <div className="flex gap-2 flex-wrap">
          {[
            "bg-background", "bg-foreground", "bg-card", "bg-popover",
            "bg-primary", "bg-secondary", "bg-muted", "bg-accent", "bg-destructive",
            "bg-border", "bg-input", "bg-ring",
          ].map(cls => (
            <div key={cls} className="flex flex-col items-center gap-1">
              <div className={`w-10 h-10 rounded ${cls}`} />
              <span className="text-[10px] text-muted-foreground">{cls.replace("bg-", "")}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Badges */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Badges</h2>
        <div className="flex gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge variant="outline">Outline</Badge>
        </div>
      </section>

      {/* Buttons */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Buttons</h2>
        <div className="flex gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
        </div>
      </section>

      {/* Card + Input */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Card + Input</h2>
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>Deploy Agent</CardTitle>
            <CardDescription>card = neutral-950 | description = muted-foreground</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="name">Agent name</Label>
              <Input id="name" placeholder="Bridge-PM-01" />
            </div>
            <Button className="w-full">Deploy</Button>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
