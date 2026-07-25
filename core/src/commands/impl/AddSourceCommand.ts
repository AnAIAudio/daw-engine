import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { Source } from "../../domain/Source";

export class AddSourceCommand implements UndoableCommand {
  private session: Session;
  private source: Source;

  constructor(session: Session, source: Source) {
    this.session = session;
    this.source = source;
  }

  public async execute(): Promise<void> {
    this.session.addSource(this.source);
  }

  public async undo(): Promise<void> {
    this.session.removeSource(this.source.id);
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
