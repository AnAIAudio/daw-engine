/**
 * ProcessingGraph — a directed acyclic graph (DAG) for modeling signal-processing
 * node execution order.
 *
 * The graph is a standalone utility with no audio-framework dependencies,
 * making it suitable for unit testing and headless use.
 *
 * Key capabilities:
 * - Add / remove nodes and directed edges (from → to means "from depends on to")
 * - Topological sort via Kahn's algorithm — produces a valid execution order
 * - Cycle detection via iterative DFS
 * - Parallel-group extraction — nodes at the same "depth" can run concurrently
 *
 * @module ProcessingGraph
 */

/**
 * A node in the processing graph.
 *
 * `process()` is optional — the graph is purely structural; callers decide
 * whether to invoke processing logic.
 */
export interface GraphNode {
  /** Unique identifier for this node. */
  id: string;
  /** Optional processing callback invoked during graph execution. */
  process?(): void;
}

/**
 * ProcessingGraph models a DAG of {@link GraphNode}s connected by directed
 * dependency edges.
 *
 * An edge `from → to` means "node `from` depends on node `to`" — i.e. `to`
 * must be processed **before** `from`.
 *
 * @example
 * ```ts
 * const graph = new ProcessingGraph();
 * graph.addNode({ id: 'input' });
 * graph.addNode({ id: 'eq' });
 * graph.addNode({ id: 'compressor' });
 * graph.addNode({ id: 'output' });
 *
 * graph.addEdge('eq', 'input');          // eq depends on input
 * graph.addEdge('compressor', 'eq');     // compressor depends on eq
 * graph.addEdge('output', 'compressor'); // output depends on compressor
 *
 * const order = graph.topologicalSort(); // [input, eq, compressor, output]
 * ```
 */
export class ProcessingGraph {
  /** All registered nodes keyed by id. */
  private nodes: Map<string, GraphNode> = new Map();

  /**
   * Adjacency list storing **dependencies** (incoming edges).
   * `edges.get(nodeId)` → set of node ids that `nodeId` depends on.
   */
  private edges: Map<string, Set<string>> = new Map();

  // ---------------------------------------------------------------
  // Node management
  // ---------------------------------------------------------------

  /**
   * Register a node in the graph.
   *
   * If a node with the same `id` already exists it will be replaced,
   * but its edges are preserved.
   *
   * @param node - The graph node to add.
   */
  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
    if (!this.edges.has(node.id)) {
      this.edges.set(node.id, new Set());
    }
  }

  /**
   * Remove a node and all edges that reference it (both incoming and
   * outgoing).
   *
   * @param nodeId - The id of the node to remove.
   */
  removeNode(nodeId: string): void {
    this.nodes.delete(nodeId);
    this.edges.delete(nodeId);
    // Remove references to this node from all other edge sets
    for (const deps of this.edges.values()) {
      deps.delete(nodeId);
    }
  }

  /**
   * Return the node with the given id, or `undefined` if it does not exist.
   *
   * @param nodeId - The id to look up.
   */
  getNode(nodeId: string): GraphNode | undefined {
    return this.nodes.get(nodeId);
  }

  /**
   * The total number of nodes currently in the graph.
   */
  get nodeCount(): number {
    return this.nodes.size;
  }

  // ---------------------------------------------------------------
  // Edge management
  // ---------------------------------------------------------------

  /**
   * Add a directed dependency edge: `from` depends on `to`.
   *
   * Both node ids must already exist in the graph; otherwise the call is a
   * no-op.
   *
   * @param from - The node that has the dependency.
   * @param to   - The node that must be processed first.
   */
  addEdge(from: string, to: string): void {
    if (!this.nodes.has(from) || !this.nodes.has(to)) {
      return;
    }
    const deps = this.edges.get(from);
    if (deps) {
      deps.add(to);
    }
  }

  /**
   * Remove a directed dependency edge.
   *
   * @param from - The dependent node.
   * @param to   - The dependency to remove.
   */
  removeEdge(from: string, to: string): void {
    const deps = this.edges.get(from);
    if (deps) {
      deps.delete(to);
    }
  }

  // ---------------------------------------------------------------
  // Topological sort (Kahn's algorithm)
  // ---------------------------------------------------------------

  /**
   * Return the nodes in a valid execution order (dependencies first) using
   * Kahn's algorithm.
   *
   * @throws {Error} If the graph contains a cycle (not all nodes can be
   *   sorted).
   * @returns An array of {@link GraphNode} in topological order.
   */
  topologicalSort(): GraphNode[] {
    if (this.nodes.size === 0) {
      return [];
    }

    // Build in-degree map (number of dependencies each node has)
    const inDegree = new Map<string, number>();
    for (const id of this.nodes.keys()) {
      inDegree.set(id, 0);
    }

    // For Kahn's algorithm we need the *forward* adjacency: for each node,
    // which other nodes depend on it. We also need the in-degree — the
    // number of dependencies each node has.
    const forwardAdj = new Map<string, string[]>();
    for (const id of this.nodes.keys()) {
      forwardAdj.set(id, []);
    }

    for (const [nodeId, deps] of this.edges) {
      inDegree.set(nodeId, deps.size);
      for (const depId of deps) {
        forwardAdj.get(depId)?.push(nodeId);
      }
    }

    // Seed the queue with nodes that have zero in-degree
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) {
        queue.push(id);
      }
    }

    const sorted: GraphNode[] = [];

    while (queue.length > 0) {
      // Sort the queue for deterministic output (alphabetical by id)
      queue.sort();
      const id = queue.shift()!;
      const node = this.nodes.get(id);
      if (node) {
        sorted.push(node);
      }

      const dependents = forwardAdj.get(id) ?? [];
      for (const depId of dependents) {
        const newDeg = (inDegree.get(depId) ?? 1) - 1;
        inDegree.set(depId, newDeg);
        if (newDeg === 0) {
          queue.push(depId);
        }
      }
    }

    if (sorted.length !== this.nodes.size) {
      throw new Error(
        "ProcessingGraph contains a cycle — topological sort is not possible",
      );
    }

    return sorted;
  }

  // ---------------------------------------------------------------
  // Parallel groups
  // ---------------------------------------------------------------

  /**
   * Partition the graph into groups of nodes that can be executed in
   * parallel.
   *
   * Each group contains nodes whose dependencies have all been satisfied by
   * earlier groups. Within a group the nodes are independent and can run
   * concurrently.
   *
   * @throws {Error} If the graph contains a cycle.
   * @returns An array of arrays — each inner array is a parallel group
   *   ordered from first-to-execute to last.
   */
  getParallelGroups(): GraphNode[][] {
    if (this.nodes.size === 0) {
      return [];
    }

    // Build in-degree and forward adjacency (same as topologicalSort)
    const inDegree = new Map<string, number>();
    const forwardAdj = new Map<string, string[]>();

    for (const id of this.nodes.keys()) {
      inDegree.set(id, 0);
      forwardAdj.set(id, []);
    }
    for (const [nodeId, deps] of this.edges) {
      inDegree.set(nodeId, deps.size);
      for (const depId of deps) {
        forwardAdj.get(depId)?.push(nodeId);
      }
    }

    // BFS by levels
    let currentLevel: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) {
        currentLevel.push(id);
      }
    }

    const groups: GraphNode[][] = [];
    let processed = 0;

    while (currentLevel.length > 0) {
      // Sort for deterministic ordering
      currentLevel.sort();

      const group: GraphNode[] = [];
      const nextLevel: string[] = [];

      for (const id of currentLevel) {
        const node = this.nodes.get(id);
        if (node) {
          group.push(node);
          processed++;
        }

        const dependents = forwardAdj.get(id) ?? [];
        for (const depId of dependents) {
          const newDeg = (inDegree.get(depId) ?? 1) - 1;
          inDegree.set(depId, newDeg);
          if (newDeg === 0) {
            nextLevel.push(depId);
          }
        }
      }

      if (group.length > 0) {
        groups.push(group);
      }

      currentLevel = nextLevel;
    }

    if (processed !== this.nodes.size) {
      throw new Error(
        "ProcessingGraph contains a cycle — parallel grouping is not possible",
      );
    }

    return groups;
  }

  // ---------------------------------------------------------------
  // Cycle detection (iterative DFS)
  // ---------------------------------------------------------------

  /**
   * Detect whether the graph contains any cycles using iterative DFS.
   *
   * @returns `true` if a cycle exists, `false` otherwise.
   */
  detectCycles(): boolean {
    const WHITE = 0; // unvisited
    const GRAY = 1; // in current DFS path
    const BLACK = 2; // fully processed

    const color = new Map<string, number>();
    for (const id of this.nodes.keys()) {
      color.set(id, WHITE);
    }

    for (const startId of this.nodes.keys()) {
      if (color.get(startId) !== WHITE) {
        continue;
      }

      // Iterative DFS using an explicit stack.
      // Each stack entry is [nodeId, isBacktrack].
      const stack: Array<[string, boolean]> = [[startId, false]];

      while (stack.length > 0) {
        const [nodeId, isBacktrack] = stack.pop()!;

        if (isBacktrack) {
          color.set(nodeId, BLACK);
          continue;
        }

        if (color.get(nodeId) === GRAY) {
          // Already being visited in this path — cycle detected
          return true;
        }

        if (color.get(nodeId) === BLACK) {
          continue;
        }

        color.set(nodeId, GRAY);
        // Push a backtrack marker so we set BLACK when we unwind
        stack.push([nodeId, true]);

        // Push all dependencies (neighbors in the dependency direction)
        const deps = this.edges.get(nodeId) ?? new Set<string>();
        for (const depId of deps) {
          const depColor = color.get(depId);
          if (depColor === GRAY) {
            return true; // back edge → cycle
          }
          if (depColor === WHITE) {
            stack.push([depId, false]);
          }
        }
      }
    }

    return false;
  }

  // ---------------------------------------------------------------
  // Dependency queries
  // ---------------------------------------------------------------

  /**
   * Return the ids of all nodes that `nodeId` directly depends on
   * (its prerequisites).
   *
   * @param nodeId - The node to query.
   * @returns An array of dependency node ids, or an empty array if the node
   *   has no dependencies or does not exist.
   */
  getDependencies(nodeId: string): string[] {
    const deps = this.edges.get(nodeId);
    return deps ? [...deps] : [];
  }

  /**
   * Return the ids of all nodes that directly depend on `nodeId`
   * (its consumers / dependents).
   *
   * @param nodeId - The node to query.
   * @returns An array of dependent node ids.
   */
  getDependents(nodeId: string): string[] {
    const result: string[] = [];
    for (const [id, deps] of this.edges) {
      if (deps.has(nodeId)) {
        result.push(id);
      }
    }
    return result;
  }

  // ---------------------------------------------------------------
  // Housekeeping
  // ---------------------------------------------------------------

  /**
   * Remove all nodes and edges from the graph.
   */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
  }
}
