import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { ProcessorId } from "../../domain/types";
import { Processor } from "../../processing/Processor";
import { AutomationPoint } from "../../automation/types";

export class MoveAutomationPointCommand implements UndoableCommand {
  public readonly type = "MoveAutomationPoint";

  // State to restore on undo
  private originalTime: number | null = null;
  private originalValue: number | null = null;

  constructor(
    private session: Session,
    public readonly trackId: string,
    public readonly processorId: ProcessorId,
    public readonly parameter: string,
    public readonly pointId: string,
    public readonly newTime: number,
    public readonly newValue: number,
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

    // Find point
    const points = automationList.getPoints();
    const point = points.find((p: AutomationPoint) => p.id === this.pointId);

    if (!point) throw new Error(`Point ${this.pointId} not found`);

    // Store original state if first run
    if (this.originalTime === null) {
      this.originalTime = point.time;
      this.originalValue = point.value;
    }

    // We need to update the point in the list.
    // AutomationList doesn't expose update method directly, but we can remove and re-add or update in place if reference is robust.
    // However, AutomationList sorts by time. If we change time, we MUST re-sort.
    // Simplest way: Remove and Add (preserving ID? AutomationList.addPoint generates new ID usually).
    // Let's check AutomationList source.
    // We might need to add `updatePoint` method to AutomationList.

    // For now, let's assume we can modify the point logic via a new method on AutomationList
    // Or we implement a remove/add sequence here, but that changes ID which is bad for UI keying.

    // Let's assume we will add `updatePoint` to AutomationList.
    automationList.updatePoint(this.pointId, this.newTime, this.newValue);
  }

  async undo(): Promise<void> {
    if (this.originalTime === null || this.originalValue === null) return;

    const track = this.session.getTrack(this.trackId);
    if (!track) return;

    const processor = track.route.processors.find(
      (p: Processor) => p.id === this.processorId,
    );
    if (!processor) return;

    const automationList = processor.automations.get(this.parameter);
    if (automationList) {
      automationList.updatePoint(
        this.pointId,
        this.originalTime,
        this.originalValue,
      );
    }
  }

  async redo(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) return;
    const processor = track.route.processors.find(
      (p: Processor) => p.id === this.processorId,
    );
    if (!processor) return;
    const automationList = processor.automations.get(this.parameter);
    if (automationList) {
      automationList.updatePoint(this.pointId, this.newTime, this.newValue);
    }
  }
}
