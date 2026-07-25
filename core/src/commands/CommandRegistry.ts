/**
 * CommandRegistry — a singleton registry that maps command type names to
 * their constructors, enabling serialization and deserialization of commands.
 *
 * Uses a command-factory approach for session
 * persistence.
 *
 * **Serialization flow:**
 * 1. A command implements {@link SerializableCommand} and returns a
 *    {@link CommandSnapshot} from `toJSON()`.
 * 2. The snapshot is persisted (e.g. to IndexedDB or a file).
 * 3. On load, `CommandRegistry` resolves the `type` field back to a
 *    constructor, which the caller can use to re-hydrate the command.
 *
 * @example
 * ```ts
 * // Registration (typically at module load time)
 * CommandRegistry.getInstance().register('MoveRegion', MoveRegionCommand);
 *
 * // Serialization
 * const snapshot = (cmd as SerializableCommand).toJSON();
 * const json = JSON.stringify(snapshot);
 *
 * // Deserialization
 * const data = JSON.parse(json) as CommandSnapshot;
 * const Ctor = CommandRegistry.getInstance().getConstructor(data.type);
 * ```
 *
 * @module CommandRegistry
 */

/**
 * A JSON-safe snapshot of a command's state, suitable for persistence.
 */
export interface CommandSnapshot {
  /** The registered type name (e.g. `'MoveRegion'`). */
  type: string;
  /** Arbitrary parameter bag capturing the command's state. */
  params: Record<string, unknown>;
  /** Unix-epoch millisecond timestamp of when the command was created. */
  timestamp: number;
}

/**
 * Interface that commands may implement to support serialization.
 *
 * This is intentionally separate from the base `Command` / `UndoableCommand`
 * interfaces so that serialization support remains opt-in and does not break
 * backwards compatibility.
 */
export interface SerializableCommand {
  /** Serialize this command to a JSON-safe snapshot. */
  toJSON(): CommandSnapshot;
}

/**
 * A constructor type for command classes.
 *
 * The constructor signature is intentionally loose (`...args: unknown[]`) so
 * that any command class can be registered regardless of its specific
 * constructor parameters.
 */
type CommandConstructor = new (...args: unknown[]) => unknown;

/**
 * CommandRegistry is a singleton that maintains a mapping from string type
 * names to command constructors.
 *
 * It is the cornerstone of the command serialization/deserialization pipeline,
 * allowing persisted {@link CommandSnapshot} objects to be re-hydrated into
 * live command instances.
 */
export class CommandRegistry {
  /** Singleton instance. */
  private static instance: CommandRegistry;

  /** Type name → constructor mapping. */
  private registry: Map<string, CommandConstructor> = new Map();

  /** Use {@link getInstance} instead. */
  private constructor() {}

  /**
   * Return the singleton instance, creating it on first access.
   */
  static getInstance(): CommandRegistry {
    if (!CommandRegistry.instance) {
      CommandRegistry.instance = new CommandRegistry();
    }
    return CommandRegistry.instance;
  }

  /**
   * Register a command constructor under the given type name.
   *
   * If a constructor is already registered for `type` it will be
   * silently replaced.
   *
   * @param type - A unique string identifier (e.g. `'MoveRegion'`).
   * @param ctor - The command class constructor.
   */
  register(type: string, ctor: CommandConstructor): void {
    this.registry.set(type, ctor);
  }

  /**
   * Look up the constructor for a given type name.
   *
   * @param type - The registered type name.
   * @returns The constructor, or `undefined` if the type is not registered.
   */
  getConstructor(type: string): CommandConstructor | undefined {
    return this.registry.get(type);
  }

  /**
   * Check whether a type name is registered.
   *
   * @param type - The type name to look up.
   */
  has(type: string): boolean {
    return this.registry.has(type);
  }

  /**
   * Return a sorted list of all currently registered type names.
   */
  getRegisteredTypes(): string[] {
    return [...this.registry.keys()].sort();
  }
}
