import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { PluginManager } from "../../plugins/PluginManager";
import { PluginInsert } from "../../processing/PluginInsert";
import { ProcessorId, ProcessorPosition } from "../../domain/types";

import { logger } from "../../utils/Logger";
export class AddPluginCommand implements UndoableCommand {
  public readonly type = "AddPlugin";
  private trackId: string;
  private pluginTypeId: string;
  private index: number;
  private position: ProcessorPosition;
  private processor: PluginInsert | null = null;
  private session: Session;

  constructor(
    session: Session,
    trackId: string,
    pluginTypeId: string,
    index: number = 0,
    position: ProcessorPosition = "pre",
  ) {
    this.session = session;
    this.trackId = trackId;
    this.pluginTypeId = pluginTypeId;
    this.index = index;
    this.position = position;
  }

  public get createdProcessor(): PluginInsert | null {
    return this.processor;
  }

  async execute(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) throw new Error(`Track ${this.trackId} not found`);

    if (!this.processor) {
      const pluginManager = PluginManager.getInstance();
      const plugin = pluginManager.createPlugin(this.pluginTypeId);
      if (!plugin)
        throw new Error(`Plugin type ${this.pluginTypeId} not found`);

      this.processor = new PluginInsert(
        crypto.randomUUID() as ProcessorId,
        plugin,
      );
    }

    track.route.addProcessor(this.processor, this.position, this.index);
    logger.debug(
      "Command",
      `Added plugin ${this.processor.plugin.name} to track ${track.name} (${this.position})`,
    );
  }

  async undo(): Promise<void> {
    if (!this.processor) return;

    const track = this.session.getTrack(this.trackId);
    if (!track) return;

    track.route.removeProcessor(this.processor.id);
    logger.debug("Command", `Undid add plugin for track ${track.name}`);
  }

  async redo(): Promise<void> {
    return this.execute();
  }
}
