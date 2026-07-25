import { Command } from "../Command";
import { Session } from "../../domain/Session";
import { PluginInsert } from "../../processing/PluginInsert";

export class SetPluginParameterCommand implements Command {
  private previousValue: number;

  constructor(
    private session: Session,
    private trackId: string,
    private processorId: string,
    private parameterId: string,
    private value: number,
  ) {
    // Capture previous value for undo
    const track = this.session.getTrack(this.trackId);
    if (track) {
      const proc = track.route.processors.find(
        (p) => p.id === this.processorId,
      );
      if (proc && proc instanceof PluginInsert) {
        const param = proc.plugin.getParameter(this.parameterId);
        if (param) {
          this.previousValue = param.value;
        } else {
          this.previousValue = 0; // Fallback
        }
      } else {
        this.previousValue = 0;
      }
    } else {
      this.previousValue = 0;
    }
  }

  public async execute(): Promise<void> {
    this.applyValue(this.value);
  }

  public async undo(): Promise<void> {
    this.applyValue(this.previousValue);
  }

  public async redo(): Promise<void> {
    this.applyValue(this.value);
  }

  private applyValue(val: number) {
    const track = this.session.getTrack(this.trackId);
    if (!track) return;

    const proc = track.route.processors.find((p) => p.id === this.processorId);
    if (!proc || !(proc instanceof PluginInsert)) return;

    proc.plugin.setParameter(this.parameterId, val);
  }
}
