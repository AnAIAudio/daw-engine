import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";

export class ConnectIOCommand implements UndoableCommand {
  public readonly type = "ConnectIO";
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

    if (sourceIO.isConnectedTo(this.destId)) return; // Already connected

    // Simple circular check: direct loop
    if (this.sourceId === this.destId)
      throw new Error("Cannot connect IO to itself");

    // Prevent circular chains would require graph traversal.
    // For MVP, allow backend to handle or ignore. Worklets usually handle feedback loops with 1-block delay automatically.

    sourceIO.connect(this.destId);
  }

  async undo(): Promise<void> {
    const sourceIO = this.session.getIO(this.sourceId);
    if (!sourceIO) return;

    sourceIO.disconnect(this.destId);
  }

  async redo(): Promise<void> {
    return this.execute();
  }
}
