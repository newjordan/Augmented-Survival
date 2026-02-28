/**
 * TownPlanner — Autonomous town layout and expansion strategy.
 *
 * Each agent uses its architectural style and priorities to decide:
 * - Where to place buildings (ring-based expansion from center)
 * - What to build next (resource needs, population, defense)
 * - When to expand territory
 * - How to lay out roads connecting buildings
 *
 * Layout strategies vary by ArchitecturalStyle:
 * - Organic: spiral placement with noise offsets, curved roads
 * - Geometric: grid-snapped, orderly rows, straight roads
 * - Fortified: concentric rings with wall gaps, compact center
 * - Sprawling: large spacing, scattered placement, wide roads
 * - Vertical: tight clusters, overlapping footprints stacked
 */

import { BuildingType } from '../types/buildings';
import { ResourceType } from '../types/resources';
import type { ArchitecturalStyle, AgentPriority, TownPlan, TownPlot, RoadSegment } from './types';
import type { OpenClawAgentComponent } from './OpenClawAgentComponent';
import { AgentDecisionType } from './types';
import type { AgentDecision } from './types';

/** Spacing between buildings for each style */
const STYLE_SPACING: Record<ArchitecturalStyle, number> = {
  Organic: 6,
  Geometric: 7,
  Fortified: 5,
  Sprawling: 10,
  Vertical: 4,
};

/** How many buildings per ring for each style */
const STYLE_RING_COUNT: Record<ArchitecturalStyle, number> = {
  Organic: 5,
  Geometric: 8,
  Fortified: 6,
  Sprawling: 4,
  Vertical: 7,
};

/** Simple seeded random */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

/**
 * Generate building plots for the next expansion ring.
 * Returns new plots arranged according to the agent's architectural style.
 */
export function planExpansionRing(
  agent: OpenClawAgentComponent,
  ring: number,
): TownPlot[] {
  const style = agent.style;
  const rng = seededRandom(agent.seed + ring * 1000);
  const center = agent.townPlan;
  const spacing = STYLE_SPACING[style];
  const countPerRing = STYLE_RING_COUNT[style];
  const radius = spacing * (ring + 1);

  const plots: TownPlot[] = [];

  for (let i = 0; i < countPerRing; i++) {
    const baseAngle = (i / countPerRing) * Math.PI * 2;
    let angle = baseAngle;
    let r = radius;

    // Style-specific placement offsets
    switch (style) {
      case 'Organic':
        // Add noise to create natural-feeling placement
        angle += (rng() - 0.5) * 0.4;
        r += (rng() - 0.5) * spacing * 0.4;
        break;
      case 'Geometric':
        // Snap to grid
        break;
      case 'Fortified':
        // Slightly tighter, with gaps for "gates"
        if (i % 3 === 0) continue; // Leave gaps
        r *= 0.9;
        break;
      case 'Sprawling':
        // Wider spacing, more random
        angle += (rng() - 0.5) * 0.6;
        r += (rng() - 0.5) * spacing * 0.6;
        break;
      case 'Vertical':
        // Tight clusters
        r *= 0.7;
        angle += (rng() - 0.5) * 0.2;
        break;
    }

    let x = center.centerX + Math.cos(angle) * r;
    let z = center.centerZ + Math.sin(angle) * r;

    // For Geometric style, snap to grid
    if (style === 'Geometric') {
      const gridSize = spacing;
      x = Math.round(x / gridSize) * gridSize;
      z = Math.round(z / gridSize) * gridSize;
    }

    // Determine building type based on position in ring and priority
    const buildingType = chooseBuildingType(agent, ring, i, rng);

    plots.push({
      x,
      z,
      buildingType,
      isBuilt: false,
      priority: calculatePlotPriority(agent, buildingType, ring),
    });
  }

  return plots;
}

/**
 * Choose what building type to place based on agent priorities,
 * current town state, and position in the expansion ring.
 */
function chooseBuildingType(
  agent: OpenClawAgentComponent,
  ring: number,
  index: number,
  rng: () => number,
): BuildingType {
  const builtCount = agent.totalBuildingsBuilt;
  const citizenCount = agent.citizenEntities.length;

  // Ring 0: Core infrastructure
  if (ring === 0) {
    const corePattern: BuildingType[] = [
      BuildingType.House,
      BuildingType.WoodcutterHut,
      BuildingType.StorageBarn,
      BuildingType.FarmField,
      BuildingType.House,
    ];
    return corePattern[index % corePattern.length];
  }

  // Calculate current needs
  const hasStorage = agent.buildingEntities.length > 0; // Simplified
  const needsHousing = citizenCount >= builtCount; // Need more houses
  const needsFood = builtCount > 3 && rng() < 0.3;

  // Priority-based selection
  switch (agent.priority) {
    case 'Growth':
      if (needsHousing || rng() < 0.4) return BuildingType.House;
      if (rng() < 0.3) return BuildingType.FarmField;
      return rng() < 0.5 ? BuildingType.WoodcutterHut : BuildingType.Quarry;

    case 'Economy':
      if (rng() < 0.3) return BuildingType.StorageBarn;
      if (rng() < 0.4) return BuildingType.WoodcutterHut;
      if (needsHousing) return BuildingType.House;
      return rng() < 0.5 ? BuildingType.Quarry : BuildingType.FarmField;

    case 'Aesthetics':
      // Aesthetics agents build more variety
      if (needsHousing) return BuildingType.House;
      const aestheticOptions: BuildingType[] = [
        BuildingType.House, BuildingType.FarmField,
        BuildingType.StorageBarn, BuildingType.WoodcutterHut,
      ];
      return aestheticOptions[Math.floor(rng() * aestheticOptions.length)];

    case 'Defense':
      if (ring <= 1 && rng() < 0.5) return BuildingType.Quarry; // Stone for walls
      if (needsHousing) return BuildingType.House;
      return rng() < 0.4 ? BuildingType.StorageBarn : BuildingType.WoodcutterHut;

    case 'Exploration':
      if (rng() < 0.3) return BuildingType.WoodcutterHut; // Wood for expansion
      if (needsHousing) return BuildingType.House;
      return rng() < 0.5 ? BuildingType.FarmField : BuildingType.StorageBarn;

    default:
      return BuildingType.House;
  }
}

/**
 * Calculate priority score for a building plot.
 * Higher priority = build sooner.
 */
function calculatePlotPriority(
  agent: OpenClawAgentComponent,
  buildingType: BuildingType,
  ring: number,
): number {
  let priority = 100 - ring * 10; // Closer rings get higher priority

  // Boost priority for critical buildings
  switch (buildingType) {
    case BuildingType.House:
      if (agent.priority === 'Growth') priority += 30;
      else priority += 15;
      break;
    case BuildingType.WoodcutterHut:
      if (agent.priority === 'Economy') priority += 25;
      else priority += 20; // Wood is always important
      break;
    case BuildingType.FarmField:
      priority += 15; // Food is always needed
      break;
    case BuildingType.StorageBarn:
      if (agent.priority === 'Economy') priority += 20;
      else priority += 10;
      break;
    case BuildingType.Quarry:
      if (agent.priority === 'Defense') priority += 25;
      else priority += 10;
      break;
  }

  return priority;
}

/**
 * Generate road segments connecting a new plot to existing infrastructure.
 */
export function planRoadsForPlot(plan: TownPlan, plot: TownPlot): RoadSegment[] {
  const roads: RoadSegment[] = [];

  // Road from new plot to town center
  roads.push({
    startX: plot.x,
    startZ: plot.z,
    endX: plan.centerX,
    endZ: plan.centerZ,
    width: 1.5,
  });

  // Connect to nearest existing built plot if any
  let nearestBuilt: TownPlot | null = null;
  let nearestDist = Infinity;
  for (const existing of plan.plots) {
    if (!existing.isBuilt) continue;
    const dx = existing.x - plot.x;
    const dz = existing.z - plot.z;
    const dist = dx * dx + dz * dz;
    if (dist < nearestDist && dist > 1) {
      nearestDist = dist;
      nearestBuilt = existing;
    }
  }

  if (nearestBuilt) {
    roads.push({
      startX: plot.x,
      startZ: plot.z,
      endX: nearestBuilt.x,
      endZ: nearestBuilt.z,
      width: 1.0,
    });
  }

  return roads;
}

/**
 * Make the next strategic decision for the agent.
 * Evaluates current state and returns what the agent should do.
 */
export function makeStrategicDecision(
  agent: OpenClawAgentComponent,
  availableResources: Partial<Record<ResourceType, number>>,
  gameTime: number,
): AgentDecision {
  const wood = availableResources[ResourceType.Wood] ?? 0;
  const stone = availableResources[ResourceType.Stone] ?? 0;
  const food = availableResources[ResourceType.Food] ?? 0;

  // Check if we have unbuilt plots
  const unbuiltPlots = agent.townPlan.plots
    .filter(p => !p.isBuilt)
    .sort((a, b) => b.priority - a.priority);

  // If no unbuilt plots, plan next expansion ring
  if (unbuiltPlots.length === 0) {
    return {
      type: AgentDecisionType.ExpandTerritory,
      priority: 80,
      reason: `No unbuilt plots remaining, expanding to ring ${agent.townPlan.expansionRing + 1}`,
    };
  }

  // Find the highest priority plot we can afford
  for (const plot of unbuiltPlots) {
    const canAfford = canAffordBuilding(plot.buildingType, wood, stone);
    if (canAfford) {
      return {
        type: AgentDecisionType.Build,
        buildingType: plot.buildingType,
        position: { x: plot.x, z: plot.z },
        priority: plot.priority,
        reason: `Building ${plot.buildingType} at (${plot.x.toFixed(1)}, ${plot.z.toFixed(1)}) — priority ${plot.priority}`,
      };
    }
  }

  // Can't afford anything — focus on resource gathering (assign jobs)
  if (wood < 10 || stone < 5) {
    return {
      type: AgentDecisionType.AssignJobs,
      priority: 60,
      reason: `Low resources (wood: ${wood}, stone: ${stone}) — focusing on gathering`,
    };
  }

  // Check if art evolution is due
  if (agent.artEvolutionTimer <= 0) {
    return {
      type: AgentDecisionType.EvolveArt,
      priority: 30,
      reason: `Art evolution cycle — generation ${agent.artDNA.generation}`,
    };
  }

  return {
    type: AgentDecisionType.Idle,
    priority: 0,
    reason: 'Waiting for resources or conditions to change',
  };
}

/**
 * Check if the agent can afford a building with current resources.
 */
function canAffordBuilding(type: BuildingType, wood: number, stone: number): boolean {
  switch (type) {
    case BuildingType.House:
      return wood >= 10 && stone >= 5;
    case BuildingType.StorageBarn:
      return wood >= 15;
    case BuildingType.WoodcutterHut:
      return wood >= 5;
    case BuildingType.FarmField:
      return wood >= 5;
    case BuildingType.Quarry:
      return wood >= 10;
    case BuildingType.TownCenter:
      return false; // Only one per agent
    default:
      return false;
  }
}
