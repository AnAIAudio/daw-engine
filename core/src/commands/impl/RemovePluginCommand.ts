import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { ProcessorId } from "../../domain/types";
import { PluginInsert } from "../../processing/PluginInsert";
import { Processor } from "../../processing/Processor";

import { logger } from "../../utils/Logger";
export class RemovePluginCommand implements UndoableCommand {
  public readonly type = "RemovePlugin";
  private trackId: string;
  private processorId: ProcessorId;
  private removedProcessor: PluginInsert | null = null;
  private removedPosition: "pre" | "post" = "pre";
  private removedIndex: number = -1;
  private session: Session;

  constructor(session: Session, trackId: string, processorId: ProcessorId) {
    this.session = session;
    this.trackId = trackId;
    this.processorId = processorId;
  }

  async execute(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) throw new Error(`Track ${this.trackId} not found`);

    // Determine position
    let index = -1;
    let position: "pre" | "post" = "pre";

    if (
      track.route.preFaderProcessors.find(
        (p: Processor) => p.id === this.processorId,
      )
    ) {
      index = track.route.preFaderProcessors.findIndex(
        (p: Processor) => p.id === this.processorId,
      );
      position = "pre";
    } else if (
      track.route.postFaderProcessors.find(
        (p: Processor) => p.id === this.processorId,
      )
    ) {
      index = track.route.postFaderProcessors.findIndex(
        (p: Processor) => p.id === this.processorId,
      );
      position = "post";
    }

    if (index === -1) return;

    // Get processor from correct list
    const processor =
      position === "pre"
        ? track.route.preFaderProcessors[index]
        : track.route.postFaderProcessors[index];

    if (processor instanceof PluginInsert) {
      this.removedProcessor = processor;
      this.removedIndex = index;
      this.removedPosition = position;
      track.route.removeProcessor(this.processorId);
      logger.debug(
        "Command",
        `Removed plugin ${processor.name} from track ${track.name}`,
      );
    } else {
      logger.warn(
        "Command",
        `Target processor ${this.processorId} is not a plugin`,
      );
    }
  }

  async undo(): Promise<void> {
    if (!this.removedProcessor || this.removedIndex === -1) return;

    const track = this.session.getTrack(this.trackId);
    if (!track) return;

    track.route.addProcessor(
      this.removedProcessor,
      this.removedPosition,
      this.removedIndex,
    );
    logger.debug("Command", `Undid remove plugin for track ${track.name}`);
  }

  async redo(): Promise<void> {
    return this.execute();
  }
}
