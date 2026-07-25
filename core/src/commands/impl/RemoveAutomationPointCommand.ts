import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { ProcessorId } from "../../domain/types";
import { AutomationPoint } from "../../automation/types";
import { Processor } from "../../processing/Processor";

import { logger } from "../../utils/Logger";
export class RemoveAutomationPointCommand implements UndoableCommand {
  public readonly type = "RemoveAutomationPoint";

  // State to restore
  private deletedPoint: AutomationPoint | null = null;

  constructor(
    private session: Session,
    public readonly trackId: string,
    public readonly processorId: ProcessorId,
    public readonly parameter: string,
    public readonly pointId: string,
  ) {}

  async execute(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) throw new Error(`Track ${this.trackId} not found`);

    const processor = track.route.processors.find(
      (p: Processor) => p.id === this.processorId,
    );
    if (!processor) throw new Error(`Processor ${this.processorId} not found`);

    const automationList = processor.automations.get(this.parameter);
    if (!automationList)
      throw new Error(`val parameter ${this.parameter} not found`);

    // Store for undo
    const points = automationList.getPoints();
    const point = points.find((p: AutomationPoint) => p.id === this.pointId);
    if (point) {
      this.deletedPoint = { ...point };
    } else {
      // Already gone?
      logger.warn(
        "RemoveAutomationPointCommand",
        `Point ${this.pointId} not found to remove`,
      );
      return;
    }

    automationList.removePoint(this.pointId);
  }

  async undo(): Promise<void> {
    if (!this.deletedPoint) return;

    const track = this.session.getTrack(this.trackId);
    if (!track) return;

    const processor = track.route.processors.find(
      (p: Processor) => p.id === this.processorId,
    );
    if (!processor) return;

    const automationList = processor.automations.get(this.parameter);
    if (automationList) {
      // Re-add with original ID
      // AutomationList.addPoint generates new ID. We need a way to restore exact point or accept new ID.
      // If we accept new ID, then redo might fail if it relies on ID.
      // We should add method `restorePoint` or allow specifying ID in `addPoint`.
      automationList.addPoint(
        this.deletedPoint.time,
        this.deletedPoint.value,
        this.deletedPoint.interpolation,
        this.deletedPoint.id, // We need to update AutomationList to accept ID
      );
    }
  }

  async redo(): Promise<void> {
    // Redo is just execute again (removing by ID)
    // If we restored with original ID, this works.
    const track = this.session.getTrack(this.trackId);
    if (!track) return;
    const processor = track.route.processors.find(
      (p: Processor) => p.id === this.processorId,
    );
    if (!processor) return;
    const automationList = processor.automations.get(this.parameter);
    if (automationList) {
      automationList.removePoint(this.pointId);
    }
  }
}
