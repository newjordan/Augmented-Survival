/**
 * BlockBuilder — Drives block-by-block construction of blueprints.
 *
 * When an agent decides to build a structure (or an operator commands it),
 * the BlockBuilder:
 *
 * 1. Takes a validated blueprint from the ArchitectureRuleEngine
 * 2. Checks the agent's block inventory for required materials
 * 3. Creates a construction site entity in the ECS world
 * 4. Steps through build phases, placing blocks one at a time
 * 5. Deducts blocks from inventory as they're placed
 * 6. Emits events for each block placed (rendering layer responds)
 * 7. Accumulates cultural value as the structure grows
 *
 * The build process is intentionally slow and visible — watching an agent
 * "attempt" to build a cathedral block by block IS the game experience.
 *
 * Failed builds (running out of materials mid-construction) leave
 * partial structures in the world. This is a feature, not a bug —
 * ruins and incomplete buildings tell stories.
 */

import type { EntityId } from '../ecs/Entity';
import type {
  Block,
  BlockMaterial,
  StructureArchetype,
} from '../types/blocks';
import { BlockRole } from '../types/blocks';
import type { ArchitectureBlueprint, BuildPhase } from './ArchitectureBlueprint';
import type { BlockInventory } from './BlockEconomy';
import { getBlockCount } from './BlockEconomy';
import { getBlockCulturalValue } from './BlockEconomy';

// ─── Active Construction ────────────────────────────────────────────

/**
 * An in-progress block construction — tracks the state of building
 * a blueprint in the world.
 */
export interface ActiveConstruction {
  /** Unique construction ID */
  id: string;

  /** The blueprint being built */
  blueprint: ArchitectureBlueprint;

  /** Entity ID of the construction site in the ECS world */
  siteEntityId: EntityId | null;

  /** Agent entity that owns this construction */
  agentEntityId: EntityId;

  /** World position where the structure is being built */
  worldPosition: { x: number; y: number; z: number };

  /** Current build phase index */
  currentPhase: number;

  /** Index into current phase's block list */
  currentBlockIndex: number;

  /** IDs of blocks that have been placed so far */
  placedBlockIds: number[];

  /** IDs of blocks that failed (no materials) */
  failedBlockIds: number[];

  /** Total blocks in the blueprint */
  totalBlocks: number;

  /** Cultural value accumulated so far */
  accumulatedCulture: number;

  /** Time since last block was placed (for pacing) */
  buildTimer: number;

  /** How fast blocks are placed (seconds per block) */
  buildRate: number;

  /** Current status */
  status: ConstructionStatus;

  /** Reason for pause/failure */
  statusReason?: string;
}

export enum ConstructionStatus {
  /** Waiting for materials/workers */
  Pending = 'Pending',
  /** Actively placing blocks */
  Building = 'Building',
  /** Paused — waiting for more block materials */
  Paused = 'Paused',
  /** All blocks placed */
  Complete = 'Complete',
  /** Abandoned due to failures */
  Abandoned = 'Abandoned',
}

// ─── Block Placement Result ─────────────────────────────────────────

export interface BlockPlacementResult {
  /** Whether the block was placed */
  success: boolean;
  /** The block that was placed (or attempted) */
  block: Block;
  /** World-space position (blueprint position + construction origin) */
  worldPosition: { x: number; y: number; z: number };
  /** Material consumed */
  material: BlockMaterial;
  /** Cultural value gained */
  culturalValueGained: number;
  /** Reason for failure */
  reason?: string;
}

// ─── Events ─────────────────────────────────────────────────────────

export interface BlockBuilderEvents {
  /** Fired when a block is successfully placed */
  onBlockPlaced: (construction: ActiveConstruction, result: BlockPlacementResult) => void;
  /** Fired when a build phase completes */
  onPhaseComplete: (construction: ActiveConstruction, phase: BuildPhase) => void;
  /** Fired when the entire construction completes */
  onConstructionComplete: (construction: ActiveConstruction) => void;
  /** Fired when construction is paused (no materials) */
  onConstructionPaused: (construction: ActiveConstruction, reason: string) => void;
  /** Fired when construction is abandoned */
  onConstructionAbandoned: (construction: ActiveConstruction) => void;
}

// ─── BlockBuilder ───────────────────────────────────────────────────

/**
 * BlockBuilder — manages active block constructions.
 */
export class BlockBuilder {
  /** All active constructions */
  private constructions = new Map<string, ActiveConstruction>();

  /** Event callbacks */
  private events: Partial<BlockBuilderEvents> = {};

  /** Global build speed multiplier */
  private speedMultiplier = 1.0;

  /**
   * Set event handlers for construction progress.
   */
  setEvents(events: Partial<BlockBuilderEvents>): void {
    this.events = events;
  }

  /**
   * Set global build speed (1.0 = normal, 2.0 = double speed).
   */
  setSpeedMultiplier(multiplier: number): void {
    this.speedMultiplier = Math.max(0.1, multiplier);
  }

  /**
   * Start building a blueprint at a world position.
   * Returns the construction ID for tracking.
   */
  startConstruction(
    blueprint: ArchitectureBlueprint,
    agentEntityId: EntityId,
    worldPosition: { x: number; y: number; z: number },
    buildRate = 0.5, // seconds per block
  ): string {
    const id = `construct_${blueprint.id}_${Date.now()}`;

    const construction: ActiveConstruction = {
      id,
      blueprint,
      siteEntityId: null,
      agentEntityId,
      worldPosition: { ...worldPosition },
      currentPhase: 0,
      currentBlockIndex: 0,
      placedBlockIds: [],
      failedBlockIds: [],
      totalBlocks: blueprint.blocks.length,
      accumulatedCulture: 0,
      buildTimer: 0,
      buildRate,
      status: ConstructionStatus.Pending,
    };

    this.constructions.set(id, construction);
    return id;
  }

  /**
   * Update all active constructions. Called each game tick.
   *
   * @param dt - delta time in seconds
   * @param getInventory - function to get an agent's block inventory
   * @param deductBlock - function to deduct a block from inventory
   */
  update(
    dt: number,
    getInventory: (agentEntityId: EntityId) => BlockInventory | null,
    deductBlock: (agentEntityId: EntityId, material: BlockMaterial) => boolean,
  ): void {
    for (const construction of this.constructions.values()) {
      if (construction.status === ConstructionStatus.Complete ||
          construction.status === ConstructionStatus.Abandoned) {
        continue;
      }

      this.updateConstruction(construction, dt, getInventory, deductBlock);
    }
  }

  /**
   * Update a single construction.
   */
  private updateConstruction(
    construction: ActiveConstruction,
    dt: number,
    getInventory: (agentEntityId: EntityId) => BlockInventory | null,
    deductBlock: (agentEntityId: EntityId, material: BlockMaterial) => boolean,
  ): void {
    const blueprint = construction.blueprint;
    const phases = blueprint.phases;

    // Check if we've completed all phases
    if (construction.currentPhase >= phases.length) {
      construction.status = ConstructionStatus.Complete;
      this.events.onConstructionComplete?.(construction);
      return;
    }

    // Tick build timer
    construction.buildTimer += dt * this.speedMultiplier;

    // Place blocks at the build rate
    while (construction.buildTimer >= construction.buildRate) {
      construction.buildTimer -= construction.buildRate;

      const phase = phases[construction.currentPhase];
      if (!phase) break;

      // Check if current phase is done
      if (construction.currentBlockIndex >= phase.blockIds.length) {
        // Phase complete
        this.events.onPhaseComplete?.(construction, phase);
        construction.currentPhase++;
        construction.currentBlockIndex = 0;

        // Check if all phases done
        if (construction.currentPhase >= phases.length) {
          construction.status = ConstructionStatus.Complete;
          this.events.onConstructionComplete?.(construction);
          return;
        }
        continue;
      }

      // Get the next block to place
      const blockIndex = phase.blockIds[construction.currentBlockIndex];
      const block = blueprint.blocks[blockIndex];
      if (!block) {
        construction.currentBlockIndex++;
        continue;
      }

      // Try to place the block
      const result = this.tryPlaceBlock(construction, block, deductBlock);

      if (result.success) {
        construction.status = ConstructionStatus.Building;
        construction.placedBlockIds.push(block.id);
        construction.accumulatedCulture += result.culturalValueGained;
        construction.currentBlockIndex++;
        this.events.onBlockPlaced?.(construction, result);
      } else {
        // Can't place — check if we should pause or abandon
        construction.failedBlockIds.push(block.id);

        const inventory = getInventory(construction.agentEntityId);
        if (!inventory || getBlockCount(inventory, block.material) <= 0) {
          // No blocks of this material — pause and wait for refining
          construction.status = ConstructionStatus.Paused;
          construction.statusReason = `Need ${block.material} blocks`;
          this.events.onConstructionPaused?.(construction, construction.statusReason);

          // Check if we should abandon (too many failures)
          if (construction.failedBlockIds.length > construction.totalBlocks * 0.3) {
            construction.status = ConstructionStatus.Abandoned;
            construction.statusReason = 'Too many block shortages';
            this.events.onConstructionAbandoned?.(construction);
          }
          return;
        }

        // Skip this block and try next
        construction.currentBlockIndex++;
      }
    }
  }

  /**
   * Try to place a single block.
   */
  private tryPlaceBlock(
    construction: ActiveConstruction,
    block: Block,
    deductBlock: (agentEntityId: EntityId, material: BlockMaterial) => boolean,
  ): BlockPlacementResult {
    // Try to deduct the material from agent's inventory
    const deducted = deductBlock(construction.agentEntityId, block.material);

    if (!deducted) {
      return {
        success: false,
        block,
        worldPosition: {
          x: construction.worldPosition.x + block.position.x,
          y: construction.worldPosition.y + block.position.y,
          z: construction.worldPosition.z + block.position.z,
        },
        material: block.material,
        culturalValueGained: 0,
        reason: `No ${block.material} blocks available`,
      };
    }

    const culturalValue = getBlockCulturalValue(block.material, block.role);

    return {
      success: true,
      block,
      worldPosition: {
        x: construction.worldPosition.x + block.position.x,
        y: construction.worldPosition.y + block.position.y,
        z: construction.worldPosition.z + block.position.z,
      },
      material: block.material,
      culturalValueGained: culturalValue,
    };
  }

  // ─── Query API ──────────────────────────────────────────────────

  /**
   * Get all active constructions.
   */
  getActiveConstructions(): ActiveConstruction[] {
    return Array.from(this.constructions.values());
  }

  /**
   * Get constructions for a specific agent.
   */
  getAgentConstructions(agentEntityId: EntityId): ActiveConstruction[] {
    return Array.from(this.constructions.values()).filter(
      c => c.agentEntityId === agentEntityId
    );
  }

  /**
   * Get a specific construction by ID.
   */
  getConstruction(id: string): ActiveConstruction | undefined {
    return this.constructions.get(id);
  }

  /**
   * Get construction progress as a percentage.
   */
  getProgress(id: string): number {
    const construction = this.constructions.get(id);
    if (!construction || construction.totalBlocks === 0) return 0;
    return construction.placedBlockIds.length / construction.totalBlocks;
  }

  /**
   * Resume a paused construction (after materials become available).
   */
  resumeConstruction(id: string): boolean {
    const construction = this.constructions.get(id);
    if (!construction || construction.status !== ConstructionStatus.Paused) return false;

    construction.status = ConstructionStatus.Building;
    construction.statusReason = undefined;
    // Reset failed blocks so we retry them
    construction.failedBlockIds = [];
    return true;
  }

  /**
   * Cancel a construction and clean up.
   * Returns the blocks that were placed (for partial structure handling).
   */
  cancelConstruction(id: string): Block[] {
    const construction = this.constructions.get(id);
    if (!construction) return [];

    const placedBlocks = construction.blueprint.blocks.filter(
      b => construction.placedBlockIds.includes(b.id)
    );

    construction.status = ConstructionStatus.Abandoned;
    construction.statusReason = 'Cancelled by operator';
    this.events.onConstructionAbandoned?.(construction);

    return placedBlocks;
  }

  /**
   * Remove completed/abandoned constructions from tracking.
   */
  cleanup(): void {
    for (const [id, construction] of this.constructions) {
      if (construction.status === ConstructionStatus.Complete ||
          construction.status === ConstructionStatus.Abandoned) {
        this.constructions.delete(id);
      }
    }
  }

  /**
   * Check if an agent's inventory can support starting a blueprint.
   * Returns missing materials as a map.
   */
  checkMaterialRequirements(
    blueprint: ArchitectureBlueprint,
    inventory: BlockInventory,
  ): {
    canStart: boolean;
    canComplete: boolean;
    missing: Partial<Record<BlockMaterial, number>>;
    coverage: number;
  } {
    // Count required blocks by material
    const required: Partial<Record<BlockMaterial, number>> = {};
    for (const block of blueprint.blocks) {
      required[block.material] = (required[block.material] ?? 0) + 1;
    }

    // Check against inventory
    const missing: Partial<Record<BlockMaterial, number>> = {};
    let totalRequired = 0;
    let totalAvailable = 0;

    for (const [material, count] of Object.entries(required)) {
      const mat = material as BlockMaterial;
      const available = getBlockCount(inventory, mat);
      totalRequired += count ?? 0;
      totalAvailable += Math.min(available, count ?? 0);

      if (available < (count ?? 0)) {
        missing[mat] = (count ?? 0) - available;
      }
    }

    const coverage = totalRequired > 0 ? totalAvailable / totalRequired : 0;

    return {
      canStart: coverage >= 0.3, // Can start with 30% materials
      canComplete: Object.keys(missing).length === 0,
      missing,
      coverage,
    };
  }
}
