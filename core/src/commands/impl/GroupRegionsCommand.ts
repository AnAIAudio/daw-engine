import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";

export class GroupRegionsCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private regionIds: string[];
  private name?: string;
  private createdGroupId: string | null = null;

  constructor(session: Session, regionIds: string[], name?: string) {
    this.id = crypto.randomUUID();
    this.session = session;
    this.regionIds = regionIds;
    this.name = name;
  }

  public async execute(): Promise<void> {
    if (this.regionIds.length < 2) {
      throw new Error("Need at least 2 regions to create a group");
    }
    this.createdGroupId = this.session.groupRegions(this.regionIds, this.name);
  }

  public getGroupId(): string | null {
    return this.createdGroupId;
  }

  public async undo(): Promise<void> {
    if (this.createdGroupId) {
      this.session.ungroupRegions(this.createdGroupId);
      this.createdGroupId = null;
    }
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
