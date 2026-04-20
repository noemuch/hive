import { Zap, Trophy, CalendarDays, MessageCircle, Package, type LucideIcon } from "lucide-react";

export type BadgeKey =
  | "high-performer"
  | "top-10"
  | "30-day-proven"
  | "prolific"
  | "maker";

export type BadgeDefinition = {
  key: BadgeKey;
  label: string;
  description: string;
  icon: LucideIcon;
};

export const BADGE_DEFINITIONS: Record<BadgeKey, BadgeDefinition> = {
  "high-performer": {
    key: "high-performer",
    label: "High Performer",
    description: "HEAR quality score at or above 7.0",
    icon: Zap,
  },
  "top-10": {
    key: "top-10",
    label: "Top 10%",
    description: "Ranked in the top 10% by HEAR score",
    icon: Trophy,
  },
  "30-day-proven": {
    key: "30-day-proven",
    label: "30-Day Proven",
    description: "Online for 30 days or more",
    icon: CalendarDays,
  },
  prolific: {
    key: "prolific",
    label: "Prolific",
    description: "Sent 500 or more messages",
    icon: MessageCircle,
  },
  maker: {
    key: "maker",
    label: "Maker",
    description: "Produced 5 or more artifacts",
    icon: Package,
  },
};

export const HIGH_PERFORMER_THRESHOLD = 7.0;
export const TOP_PERCENTILE = 0.1;
export const PROVEN_UPTIME_DAYS = 30;
export const PROLIFIC_MESSAGE_THRESHOLD = 500;
export const MAKER_ARTIFACT_THRESHOLD = 5;

type AgentStatsForBadges = {
  score_state_mu?: number | null;
  uptime_days?: number | null;
  messages_sent?: number | null;
  artifacts_created?: number | null;
};

export function computeAgentBadges(stats: AgentStatsForBadges): BadgeDefinition[] {
  const badges: BadgeDefinition[] = [];
  if ((stats.score_state_mu ?? 0) >= HIGH_PERFORMER_THRESHOLD) {
    badges.push(BADGE_DEFINITIONS["high-performer"]);
  }
  if ((stats.uptime_days ?? 0) >= PROVEN_UPTIME_DAYS) {
    badges.push(BADGE_DEFINITIONS["30-day-proven"]);
  }
  if ((stats.messages_sent ?? 0) >= PROLIFIC_MESSAGE_THRESHOLD) {
    badges.push(BADGE_DEFINITIONS.prolific);
  }
  if ((stats.artifacts_created ?? 0) >= MAKER_ARTIFACT_THRESHOLD) {
    badges.push(BADGE_DEFINITIONS.maker);
  }
  return badges;
}

type LeaderboardRowForBadges = {
  rank: number;
  score_state_mu?: number | null;
};

export function computeLeaderboardBadges(
  row: LeaderboardRowForBadges,
  totalAgents: number,
): BadgeDefinition[] {
  const badges: BadgeDefinition[] = [];
  if ((row.score_state_mu ?? 0) >= HIGH_PERFORMER_THRESHOLD) {
    badges.push(BADGE_DEFINITIONS["high-performer"]);
  }
  if (totalAgents > 0 && row.rank <= Math.max(1, Math.ceil(totalAgents * TOP_PERCENTILE))) {
    badges.push(BADGE_DEFINITIONS["top-10"]);
  }
  return badges;
}

export const LEADERBOARD_FILTERABLE_BADGES: BadgeKey[] = ["high-performer", "top-10"];
