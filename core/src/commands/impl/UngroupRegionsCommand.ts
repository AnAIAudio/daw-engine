import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";

export class UngroupRegionsCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private groupId: string;
  private savedRegionIds: string[] = [];
  private savedName: string = "";

  constructor(session: Session, groupId: string) {
    this.id = crypto.randomUUID();
    this.session = session;
    this.groupId = groupId;
  }

  public async execute(): Promise<void> {
    const group = this.session.getRegionGroup(this.groupId);
    if (!group) {
      throw new Error(`Region group ${this.groupId} not found`);
    }

    // Save state for undo
    this.savedRegionIds = group.getRegionIds();
    this.savedName = group.name;

    this.session.ungroupRegions(this.groupId);
  }

  public async undo(): Promise<void> {
    if (this.savedRegionIds.length > 0) {
      this.session.groupRegions(
        this.savedRegionIds,
        this.savedName,
        this.groupId,
      );
    }
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
