import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";

export class DisconnectIOCommand implements UndoableCommand {
  public readonly type = "DisconnectIO";
  private sourceId: string;
  private destId: string;
  private session: Session;

  constructor(session: Session, sourceId: string, destId: string) {
    this.session = session;
    this.sourceId = sourceId;
    this.destId = destId;
  }

  async execute(): Promise<void> {
    const sourceIO = this.session.getIO(this.sourceId);
    if (!sourceIO) throw new Error(`Source IO ${this.sourceId} not found`);

    sourceIO.disconnect(this.destId);
  }

  async undo(): Promise<void> {
    const sourceIO = this.session.getIO(this.sourceId);
    if (!sourceIO) return;

    sourceIO.connect(this.destId);
  }

  async redo(): Promise<void> {
    return this.execute();
  }
}
