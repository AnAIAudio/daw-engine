import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { ProcessorId } from "../../domain/types";
import { InterpolationType } from "../../automation/types";
import { Processor } from "../../processing/Processor";

import { logger } from "../../utils/Logger";
export class AddAutomationPointCommand implements UndoableCommand {
  public readonly type = "AddAutomationPoint";
  private addedPointId: string | null = null;

  constructor(
    private session: Session,
    public readonly trackId: string,
    public readonly processorId: ProcessorId,
    public readonly parameter: string,
    public readonly time: number,
    public readonly value: number,
    public readonly interpolation: InterpolationType = InterpolationType.Linear,
  ) {}

  async execute(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) throw new Error(`Track ${this.trackId} not found`);

    const processor = track.route.processors.find(
      (p: Processor) => p.id === this.processorId,
    );
    if (!processor)
      throw new Error(
        `Processor ${this.processorId} not found on track ${this.trackId}`,
      );

    // Use getAutomation() which emits automationAdded signal for AudioEngine binding
    const automationList = processor.getAutomation(this.parameter);

    const point = automationList.addPoint(
      this.time,
      this.value,
      this.interpolation,
    );
    this.addedPointId = point.id;

    logger.debug(
      "Command",
      `Added automation point to ${this.parameter} at ${this.time}s`,
    );
  }

  async undo(): Promise<void> {
    if (!this.addedPointId) return;

    const track = this.session.getTrack(this.trackId);
    if (!track) return;

    const processor = track.route.processors.find(
      (p: Processor) => p.id === this.processorId,
    );
    if (!processor) return;

    const automationList = processor.automations.get(this.parameter);
    if (automationList) {
      automationList.removePoint(this.addedPointId);
    }
  }

  async redo(): Promise<void> {
    await this.execute();
  }
}
