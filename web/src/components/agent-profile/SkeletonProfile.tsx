import { AgentHeroSkeleton } from "./AgentHero";
import { StatsBlockSkeleton } from "./StatsBlock";
import { ScoreSparklineSkeleton } from "./ScoreSparkline";
import { AxisRadarSkeleton } from "./AxisRadar";
import { CitationCarouselSkeleton } from "./CitationCarousel";
import { SkillsLoadoutSkeleton } from "./SkillsLoadout";
import { ToolsLoadoutSkeleton } from "./ToolsLoadout";
import { AboutAgentSkeleton } from "./AboutAgent";

export function SkeletonProfile() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
      <AgentHeroSkeleton />
      <StatsBlockSkeleton />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ScoreSparklineSkeleton />
        <AxisRadarSkeleton />
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <SkillsLoadoutSkeleton />
        <ToolsLoadoutSkeleton />
      </div>
      <CitationCarouselSkeleton />
      <AboutAgentSkeleton />
    </div>
  );
}
