/**
 * BlockEconomy — The resource-to-block refining pipeline.
 *
 * This creates the material loop that drives the block-based building system:
 *
 *   Mine Resources → Refine into Block Materials → Craft Blocks → Build Structures
 *
 * Agents maintain a block inventory alongside their resource stockpile.
 * Refining is a strategic choice: convert raw resources now for building,
 * or hoard them for flexibility.
 *
 * The block economy connects to the art economy:
 * - Marble and Gold blocks generate cultural value when placed
 * - Agents with Aesthetics priority spend more on prestigious materials
 * - Block material choices are influenced by ArtDNA
 */

import { ResourceType } from '../types/resources';
import {
  BlockMaterial,
  BlockShape,
  BLOCK_MATERIAL_COSTS,
  BLOCK_MATERIAL_STRENGTH,
  BLOCK_MATERIAL_CULTURE,
  type Block,
  type BlockRole,
} from '../types/blocks';
import type { OpenClawAgentComponent } from './OpenClawAgentComponent';
import type { ArtDNA } from './types';

// ─── Block Inventory ────────────────────────────────────────────────

/**
 * An agent's block stockpile — refined blocks ready for construction.
 */
export type BlockInventory = Partial<Record<BlockMaterial, number>>;

/**
 * Create an empty block inventory.
 */
export function createBlockInventory(): BlockInventory {
  return {};
}

/**
 * Get the count of a specific block material in inventory.
 */
export function getBlockCount(inventory: BlockInventory, material: BlockMaterial): number {
  return inventory[material] ?? 0;
}

/**
 * Get total blocks across all materials.
 */
export function getTotalBlocks(inventory: BlockInventory): number {
  let total = 0;
  for (const count of Object.values(inventory)) {
    total += count ?? 0;
  }
  return total;
}

// ─── Refining ───────────────────────────────────────────────────────

/**
 * Result of a refining attempt.
 */
export interface RefineResult {
  success: boolean;
  /** How many blocks were refined */
  blocksProduced: number;
  /** Resources consumed */
  resourcesConsumed: Partial<Record<ResourceType, number>>;
  /** Reason for failure */
  reason?: string;
}

/**
 * Check if an agent can afford to refine blocks of a given material.
 */
export function canRefine(
  resources: Partial<Record<ResourceType, number>>,
  material: BlockMaterial,
  count: number,
): boolean {
  const costPer = BLOCK_MATERIAL_COSTS[material];
  for (const [resource, amount] of Object.entries(costPer)) {
    const needed = (amount ?? 0) * count;
    const have = resources[resource as ResourceType] ?? 0;
    if (have < needed) return false;
  }
  return true;
}

/**
 * Refine raw resources into blocks. Deducts resources from the agent's pool
 * and adds blocks to their inventory.
 *
 * Returns how many blocks were actually produced (may be less than requested
 * if resources run out mid-batch).
 */
export function refineBlocks(
  resources: Record<ResourceType, number>,
  inventory: BlockInventory,
  material: BlockMaterial,
  requestedCount: number,
): RefineResult {
  const costPer = BLOCK_MATERIAL_COSTS[material];
  let produced = 0;
  const totalConsumed: Partial<Record<ResourceType, number>> = {};

  for (let i = 0; i < requestedCount; i++) {
    // Check if we can afford one more
    let canAfford = true;
    for (const [resource, amount] of Object.entries(costPer)) {
      const needed = amount ?? 0;
      const have = resources[resource as ResourceType] ?? 0;
      if (have < needed) {
        canAfford = false;
        break;
      }
    }

    if (!canAfford) break;

    // Deduct resources
    for (const [resource, amount] of Object.entries(costPer)) {
      const cost = amount ?? 0;
      resources[resource as ResourceType] = (resources[resource as ResourceType] ?? 0) - cost;
      totalConsumed[resource as ResourceType] = (totalConsumed[resource as ResourceType] ?? 0) + cost;
    }

    produced++;
  }

  // Add to inventory
  if (produced > 0) {
    inventory[material] = (inventory[material] ?? 0) + produced;
  }

  return {
    success: produced > 0,
    blocksProduced: produced,
    resourcesConsumed: totalConsumed,
    reason: produced === 0 ? 'Insufficient resources' : undefined,
  };
}

// ─── Material Selection ─────────────────────────────────────────────

/**
 * Choose the best material for a block role based on the agent's
 * ArtDNA, available resources, and structural requirements.
 *
 * This is where art meets engineering — the agent's aesthetic
 * preferences influence material choices.
 */
export function chooseMaterial(
  agent: OpenClawAgentComponent,
  role: BlockRole,
  inventory: BlockInventory,
): BlockMaterial {
  const dna = agent.artDNA;

  // Structural roles need strong materials
  const needsStrength = role === 'Foundation' || role === 'Column' || role === 'Beam' || role === 'Wall';

  // Decorative roles prefer beautiful materials
  const needsBeauty = role === 'Decoration' || role === 'Capital' || role === 'Entablature' || role === 'Pediment';

  // Roof materials
  const isRoof = role === 'Roof';

  // Score each material
  let bestMaterial = BlockMaterial.Stone;
  let bestScore = -Infinity;

  for (const material of Object.values(BlockMaterial)) {
    const available = getBlockCount(inventory, material);
    if (available <= 0) continue;

    let score = 0;

    // Structural suitability
    const strength = BLOCK_MATERIAL_STRENGTH[material];
    if (needsStrength) {
      score += strength * 2;
    }

    // Aesthetic suitability
    const culture = BLOCK_MATERIAL_CULTURE[material];
    if (needsBeauty) {
      score += culture * 3;
    }

    // Art DNA influence: detail-loving agents prefer ornate materials
    score += dna.shape.detailLevel * culture;

    // Aesthetics-priority agents always lean toward beauty
    if (agent.priority === 'Aesthetics') {
      score += culture * 2;
    }

    // Roof preference
    if (isRoof) {
      if (material === BlockMaterial.Thatch) score += 3;
      if (material === BlockMaterial.Wood) score += 2;
      if (dna.shape.detailLevel > 0.6 && material === BlockMaterial.DressedStone) score += 4;
    }

    // Availability bonus (prefer what we have lots of)
    score += Math.min(available / 10, 2);

    if (score > bestScore) {
      bestScore = score;
      bestMaterial = material;
    }
  }

  return bestMaterial;
}

/**
 * Calculate the cultural value of a placed block based on its material and role.
 */
export function getBlockCulturalValue(material: BlockMaterial, role: BlockRole): number {
  const baseCulture = BLOCK_MATERIAL_CULTURE[material];

  // Decorative blocks contribute more to culture
  const roleMultiplier =
    role === 'Decoration' ? 2.0 :
    role === 'Capital' ? 1.8 :
    role === 'Entablature' ? 1.5 :
    role === 'Pediment' ? 1.5 :
    role === 'Vault' ? 1.3 :
    role === 'Column' ? 1.2 :
    1.0;

  return baseCulture * roleMultiplier;
}

/**
 * Decide what materials to refine based on agent strategy.
 * Called periodically by the agent's decision loop.
 *
 * Returns a list of (material, count) pairs to refine.
 */
export function planRefining(
  agent: OpenClawAgentComponent,
  inventory: BlockInventory,
): Array<{ material: BlockMaterial; count: number }> {
  const plan: Array<{ material: BlockMaterial; count: number }> = [];
  const resources = agent.resources;

  // Always maintain a base stock of structural blocks
  const stoneCount = getBlockCount(inventory, BlockMaterial.Stone);
  const woodCount = getBlockCount(inventory, BlockMaterial.Wood);

  if (stoneCount < 10 && canRefine(resources, BlockMaterial.Stone, 5)) {
    plan.push({ material: BlockMaterial.Stone, count: 5 });
  }

  if (woodCount < 10 && canRefine(resources, BlockMaterial.Wood, 5)) {
    plan.push({ material: BlockMaterial.Wood, count: 5 });
  }

  // Aesthetics agents refine decorative materials
  if (agent.priority === 'Aesthetics') {
    const dressedCount = getBlockCount(inventory, BlockMaterial.DressedStone);
    if (dressedCount < 5 && canRefine(resources, BlockMaterial.DressedStone, 3)) {
      plan.push({ material: BlockMaterial.DressedStone, count: 3 });
    }

    const marbleCount = getBlockCount(inventory, BlockMaterial.Marble);
    if (marbleCount < 3 && canRefine(resources, BlockMaterial.Marble, 2)) {
      plan.push({ material: BlockMaterial.Marble, count: 2 });
    }
  }

  // Defense agents focus on strong materials
  if (agent.priority === 'Defense') {
    const ironCount = getBlockCount(inventory, BlockMaterial.Iron);
    if (ironCount < 5 && canRefine(resources, BlockMaterial.Iron, 3)) {
      plan.push({ material: BlockMaterial.Iron, count: 3 });
    }
  }

  // Economy agents refine cheap materials in bulk
  if (agent.priority === 'Economy') {
    const brickCount = getBlockCount(inventory, BlockMaterial.Brick);
    if (brickCount < 15 && canRefine(resources, BlockMaterial.Brick, 8)) {
      plan.push({ material: BlockMaterial.Brick, count: 8 });
    }
  }

  return plan;
}
