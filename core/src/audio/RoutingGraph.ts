import { Session } from "../domain/Session";
import { TrackType } from "../domain/Track";
import { Signal } from "../lib/Signal";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A directed connection between two nodes in the routing graph.
 */
export interface GraphEdge {
  /** Source track / bus ID. */
  sourceId: string;
  /** Target track / bus ID. */
  targetId: string;
  /** Output port name on the source. */
  sourcePort: string;
  /** Input port name on the target. */
  targetPort: string;
  /** Connection type. */
  type: "audio" | "midi" | "sidechain";
}

/**
 * A node in the routing graph, representing a track, bus, aux, master,
 * or send point in the signal chain.
 */
export interface GraphNode {
  id: string;
  name: string;
  type: "track" | "bus" | "aux" | "master" | "send";
  /** Total processing latency (in samples) introduced by this node. */
  latency: number;
}

// ─── RoutingGraph ─────────────────────────────────────────────────────────────

/**
 * RoutingGraph provides high-level routing analysis for a DAW session.
 *
 * It models the signal flow as a directed graph where nodes are tracks /
 * buses and edges are audio / MIDI / sidechain connections.  The class
 * exposes query methods (`feeds`, `signalSources`,
 * `signalDestinations`) as well as topological sorting, cycle detection,
 * and automatic latency compensation.
 */
export class RoutingGraph {
  private _nodes: Map<string, GraphNode> = new Map();
  private _edges: GraphEdge[] = [];

  public readonly graphChanged = new Signal<void>();

  // ─── Build from session ──────────────────────────────────────────────

  /**
   * Populate the graph from a live Session by inspecting its tracks,
   * send buses, and master bus.
   *
   * All existing nodes / edges are cleared first.
   */
  buildFromSession(session: Session): void {
    this._nodes.clear();
    this._edges = [];

    // Add master bus node
    this._nodes.set(session.masterBus.id, {
      id: session.masterBus.id,
      name: "Master",
      type: "master",
      latency: session.masterBus.getProcessorLatency(),
    });

    // Add track / bus nodes
    for (const track of session.tracks) {
      let nodeType: GraphNode["type"];
      switch (track.type) {
        case TrackType.BUS:
          nodeType = "bus";
          break;
        case TrackType.AUX:
          nodeType = "aux";
          break;
        default:
          nodeType = "track";
          break;
      }

      this._nodes.set(track.id, {
        id: track.id,
        name: track.name,
        type: nodeType,
        latency: track.route.getProcessorLatency(),
      });

      // Every track / bus feeds the master by default
      const edgeType: GraphEdge["type"] =
        track.type === TrackType.MIDI ? "midi" : "audio";
      this._edges.push({
        sourceId: track.id,
        targetId: session.masterBus.id,
        sourcePort: `${track.name} Out`,
        targetPort: "Master In",
        type: edgeType,
      });
    }

    // Add send bus connections
    for (const send of session.sendBuses) {
      // The send creates a connection from its source track to its
      // destination.  We model the send itself as a "send" node.
      const sendNodeId = `send-${send.id}`;
      this._nodes.set(sendNodeId, {
        id: sendNodeId,
        name: `Send (${send.id})`,
        type: "send",
        latency: 0,
      });

      // Source track -> send node
      this._edges.push({
        sourceId: send.sourceTrackId,
        targetId: sendNodeId,
        sourcePort: "Send Out",
        targetPort: "Send In",
        type: "audio",
      });

      // Send node -> destination (bus / track input IO)
      // Locate the track/bus whose route.input.id matches destId
      const destTrack = session.tracks.find(
        (t) => t.route.input.id === send.destId,
      );
      const destNodeId = destTrack ? destTrack.id : send.destId; // fallback to raw destId

      if (this._nodes.has(destNodeId)) {
        this._edges.push({
          sourceId: sendNodeId,
          targetId: destNodeId,
          sourcePort: "Send Out",
          targetPort: "Bus In",
          type: "audio",
        });
      }
    }

    this.graphChanged.emit();
  }

  // ─── Node / Edge accessors ───────────────────────────────────────────

  getNode(id: string): GraphNode | undefined {
    return this._nodes.get(id);
  }

  getNodes(): GraphNode[] {
    return Array.from(this._nodes.values());
  }

  getEdges(): GraphEdge[] {
    return [...this._edges];
  }

  getEdgesFrom(nodeId: string): GraphEdge[] {
    return this._edges.filter((e) => e.sourceId === nodeId);
  }

  getEdgesTo(nodeId: string): GraphEdge[] {
    return this._edges.filter((e) => e.targetId === nodeId);
  }

  // ─── Manual graph building ───────────────────────────────────────────

  addNode(node: GraphNode): void {
    this._nodes.set(node.id, node);
    this.graphChanged.emit();
  }

  removeNode(id: string): void {
    this._nodes.delete(id);
    this._edges = this._edges.filter(
      (e) => e.sourceId !== id && e.targetId !== id,
    );
    this.graphChanged.emit();
  }

  addEdge(edge: GraphEdge): void {
    this._edges.push(edge);
    this.graphChanged.emit();
  }

  removeEdge(sourceId: string, targetId: string): void {
    this._edges = this._edges.filter(
      (e) => !(e.sourceId === sourceId && e.targetId === targetId),
    );
    this.graphChanged.emit();
  }

  // ─── Routing analysis ────────────────────────────────────────────────

  /**
   * Does `sourceId` feed into `targetId` through any path?
   * Uses BFS from source looking for target.
   */
  feeds(sourceId: string, targetId: string): boolean {
    if (sourceId === targetId) return false;

    const visited = new Set<string>();
    const queue: string[] = [sourceId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === targetId) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      for (const edge of this._edges) {
        if (edge.sourceId === current && !visited.has(edge.targetId)) {
          queue.push(edge.targetId);
        }
      }
    }
    return false;
  }

  /**
   * Is there a direct (single-hop) connection from source to target?
   */
  directFeeds(sourceId: string, targetId: string): boolean {
    return this._edges.some(
      (e) => e.sourceId === sourceId && e.targetId === targetId,
    );
  }

  /**
   * All upstream nodes that eventually feed into `nodeId`.
   */
  signalSources(nodeId: string): string[] {
    const visited = new Set<string>();
    const queue: string[] = [nodeId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of this._edges) {
        if (edge.targetId === current && !visited.has(edge.sourceId)) {
          visited.add(edge.sourceId);
          queue.push(edge.sourceId);
        }
      }
    }
    return Array.from(visited);
  }

  /**
   * All downstream nodes that `nodeId` eventually feeds into.
   */
  signalDestinations(nodeId: string): string[] {
    const visited = new Set<string>();
    const queue: string[] = [nodeId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of this._edges) {
        if (edge.sourceId === current && !visited.has(edge.targetId)) {
          visited.add(edge.targetId);
          queue.push(edge.targetId);
        }
      }
    }
    return Array.from(visited);
  }

  // ─── Topological operations ──────────────────────────────────────────

  /**
   * Return node IDs in a valid processing order using Kahn's algorithm
   * (topological sort). Sources are processed before their consumers.
   *
   * @throws {Error} If the graph contains a cycle.
   */
  getProcessingOrder(): string[] {
    const nodeIds = Array.from(this._nodes.keys());
    if (nodeIds.length === 0) return [];

    // Build adjacency lists
    const inDegree = new Map<string, number>();
    const forwardAdj = new Map<string, string[]>();

    for (const id of nodeIds) {
      inDegree.set(id, 0);
      forwardAdj.set(id, []);
    }

    for (const edge of this._edges) {
      if (!this._nodes.has(edge.sourceId) || !this._nodes.has(edge.targetId)) {
        continue;
      }
      inDegree.set(edge.targetId, (inDegree.get(edge.targetId) ?? 0) + 1);
      forwardAdj.get(edge.sourceId)!.push(edge.targetId);
    }

    // Seed queue with zero in-degree nodes
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }
    // Sort for deterministic output
    queue.sort();

    const sorted: string[] = [];
    while (queue.length > 0) {
      queue.sort();
      const id = queue.shift()!;
      sorted.push(id);

      for (const depId of forwardAdj.get(id) ?? []) {
        const newDeg = (inDegree.get(depId) ?? 1) - 1;
        inDegree.set(depId, newDeg);
        if (newDeg === 0) queue.push(depId);
      }
    }

    if (sorted.length !== nodeIds.length) {
      throw new Error(
        "RoutingGraph contains a cycle — topological sort is not possible",
      );
    }

    return sorted;
  }

  /**
   * Detect whether the graph contains any cycles using iterative DFS with
   * a three-color marking scheme.
   */
  hasCycle(): boolean {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;

    const color = new Map<string, number>();
    for (const id of this._nodes.keys()) {
      color.set(id, WHITE);
    }

    // Build forward adjacency for efficient traversal
    const adj = new Map<string, string[]>();
    for (const id of this._nodes.keys()) {
      adj.set(id, []);
    }
    for (const edge of this._edges) {
      if (adj.has(edge.sourceId)) {
        adj.get(edge.sourceId)!.push(edge.targetId);
      }
    }

    for (const startId of this._nodes.keys()) {
      if (color.get(startId) !== WHITE) continue;

      const stack: Array<[string, boolean]> = [[startId, false]];

      while (stack.length > 0) {
        const [nodeId, isBacktrack] = stack.pop()!;

        if (isBacktrack) {
          color.set(nodeId, BLACK);
          continue;
        }

        const nodeColor = color.get(nodeId);
        if (nodeColor === GRAY) return true;
        if (nodeColor === BLACK) continue;

        color.set(nodeId, GRAY);
        stack.push([nodeId, true]);

        for (const neighbor of adj.get(nodeId) ?? []) {
          const neighborColor = color.get(neighbor);
          if (neighborColor === GRAY) return true;
          if (neighborColor === WHITE) {
            stack.push([neighbor, false]);
          }
        }
      }
    }

    return false;
  }

  /**
   * Compute total latency along the shortest signal path from `sourceId`
   * to `targetId` by summing node latencies.  Uses BFS to find the path.
   *
   * Returns -1 if no path exists.
   */
  getLatencyForPath(sourceId: string, targetId: string): number {
    if (sourceId === targetId) {
      const node = this._nodes.get(sourceId);
      return node ? node.latency : 0;
    }

    // BFS to find path with maximum accumulated latency
    // (we want the actual signal path, not the shortest hop count)
    interface QueueEntry {
      nodeId: string;
      latency: number;
    }

    const visited = new Set<string>();
    const queue: QueueEntry[] = [
      { nodeId: sourceId, latency: this._nodes.get(sourceId)?.latency ?? 0 },
    ];
    let result = -1;

    while (queue.length > 0) {
      const { nodeId, latency } = queue.shift()!;

      if (nodeId === targetId) {
        result = Math.max(result, latency);
        continue;
      }

      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      for (const edge of this._edges) {
        if (edge.sourceId === nodeId) {
          const targetNode = this._nodes.get(edge.targetId);
          const targetLatency = targetNode ? targetNode.latency : 0;
          queue.push({
            nodeId: edge.targetId,
            latency: latency + targetLatency,
          });
        }
      }
    }

    return result;
  }

  /**
   * Compute the maximum latency across any path from a source node to
   * the master (or any terminal node). This is the worst-case latency
   * that must be compensated for.
   */
  getMaxLatency(): number {
    // Find terminal nodes (nodes with no outgoing edges)
    const hasOutgoing = new Set<string>();
    for (const edge of this._edges) {
      hasOutgoing.add(edge.sourceId);
    }
    const terminals = Array.from(this._nodes.keys()).filter(
      (id) => !hasOutgoing.has(id),
    );

    // Find source nodes (nodes with no incoming edges)
    const hasIncoming = new Set<string>();
    for (const edge of this._edges) {
      hasIncoming.add(edge.targetId);
    }
    const sources = Array.from(this._nodes.keys()).filter(
      (id) => !hasIncoming.has(id),
    );

    // Compute max latency over all source -> terminal paths
    let maxLatency = 0;
    for (const src of sources) {
      for (const dst of terminals) {
        const pathLatency = this.getLatencyForPath(src, dst);
        if (pathLatency > maxLatency) {
          maxLatency = pathLatency;
        }
      }
    }

    // If graph is a single connected component, also check by using
    // longest-path via topological order for efficiency
    try {
      const order = this.getProcessingOrder();
      const dist = new Map<string, number>();
      for (const id of order) {
        dist.set(id, this._nodes.get(id)?.latency ?? 0);
      }
      for (const id of order) {
        const currentDist = dist.get(id)!;
        for (const edge of this._edges) {
          if (edge.sourceId === id) {
            const targetNode = this._nodes.get(edge.targetId);
            const targetLatency = targetNode ? targetNode.latency : 0;
            const newDist = currentDist + targetLatency;
            if (newDist > (dist.get(edge.targetId) ?? 0)) {
              dist.set(edge.targetId, newDist);
            }
          }
        }
      }
      for (const d of dist.values()) {
        if (d > maxLatency) maxLatency = d;
      }
    } catch {
      // Graph has a cycle — fall back to the BFS result above
    }

    return maxLatency;
  }

  // ─── Latency compensation ────────────────────────────────────────────

  /**
   * Compute the per-node compensation delay so that all signal paths
   * arrive time-aligned at the master / terminal nodes.
   *
   * For each node, the compensation delay is:
   *   maxPathLatency - pathLatencyThroughThisNode
   *
   * where `maxPathLatency` is the longest cumulative latency path in the
   * entire graph.
   */
  computeCompensationDelays(): Map<string, number> {
    const delays = new Map<string, number>();
    const maxLatency = this.getMaxLatency();

    // For each node, compute its path latency from itself to any
    // terminal (i.e. the remaining latency after this node).
    // The compensation delay = maxLatency - (latency from source
    // through this node to terminal).
    //
    // A simpler and more robust approach: compute the longest path
    // from each node to any terminal, then compensation =
    // maxLatency - longestDownstreamPath.

    // Find terminal nodes
    const hasOutgoing = new Set<string>();
    for (const edge of this._edges) {
      hasOutgoing.add(edge.sourceId);
    }
    const terminals = Array.from(this._nodes.keys()).filter(
      (id) => !hasOutgoing.has(id),
    );

    // Use reverse topological order to compute longest downstream path
    let order: string[];
    try {
      order = this.getProcessingOrder();
    } catch {
      // Cycle present — return zero compensation for all nodes
      for (const id of this._nodes.keys()) {
        delays.set(id, 0);
      }
      return delays;
    }

    // longestDown[id] = longest path from id to any terminal (inclusive)
    const longestDown = new Map<string, number>();
    for (const id of this._nodes.keys()) {
      longestDown.set(id, this._nodes.get(id)?.latency ?? 0);
    }

    // Build forward adjacency
    const forwardAdj = new Map<string, string[]>();
    for (const id of this._nodes.keys()) {
      forwardAdj.set(id, []);
    }
    for (const edge of this._edges) {
      if (forwardAdj.has(edge.sourceId)) {
        forwardAdj.get(edge.sourceId)!.push(edge.targetId);
      }
    }

    // Process in reverse topological order
    for (let i = order.length - 1; i >= 0; i--) {
      const id = order[i];
      const nodeLatency = this._nodes.get(id)?.latency ?? 0;
      let maxDown = 0;
      for (const neighbor of forwardAdj.get(id) ?? []) {
        const downLatency = longestDown.get(neighbor) ?? 0;
        if (downLatency > maxDown) {
          maxDown = downLatency;
        }
      }
      longestDown.set(id, nodeLatency + maxDown);
    }

    // Compensation delay = maxLatency - longestDownstreamPath
    for (const id of this._nodes.keys()) {
      const downstream = longestDown.get(id) ?? 0;
      delays.set(id, Math.max(0, maxLatency - downstream));
    }

    return delays;
  }

  // ─── Visualization helpers ───────────────────────────────────────────

  /**
   * Assign depth levels to each node for visualization (e.g. source
   * tracks at level 0, buses at level 1, master at level 2).
   *
   * Uses BFS from source nodes (zero in-degree).
   */
  getLevels(): Map<string, number> {
    const levels = new Map<string, number>();

    // Build in-degree and forward adjacency
    const inDegree = new Map<string, number>();
    const forwardAdj = new Map<string, string[]>();
    for (const id of this._nodes.keys()) {
      inDegree.set(id, 0);
      forwardAdj.set(id, []);
    }
    for (const edge of this._edges) {
      if (!this._nodes.has(edge.sourceId) || !this._nodes.has(edge.targetId)) {
        continue;
      }
      inDegree.set(edge.targetId, (inDegree.get(edge.targetId) ?? 0) + 1);
      forwardAdj.get(edge.sourceId)!.push(edge.targetId);
    }

    // BFS from source nodes
    const queue: Array<{ id: string; level: number }> = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) {
        queue.push({ id, level: 0 });
        levels.set(id, 0);
      }
    }

    while (queue.length > 0) {
      const { id, level } = queue.shift()!;
      for (const neighbor of forwardAdj.get(id) ?? []) {
        const existingLevel = levels.get(neighbor) ?? -1;
        const newLevel = level + 1;
        if (newLevel > existingLevel) {
          levels.set(neighbor, newLevel);
          queue.push({ id: neighbor, level: newLevel });
        }
      }
    }

    return levels;
  }

  /**
   * Export the graph as a plain JSON structure for persistence or
   * visualization.
   */
  toJSON(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    return {
      nodes: Array.from(this._nodes.values()),
      edges: [...this._edges],
    };
  }

  /**
   * Restore a RoutingGraph from a JSON snapshot.
   */
  static fromJSON(data: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  }): RoutingGraph {
    const graph = new RoutingGraph();
    for (const node of data.nodes) {
      graph._nodes.set(node.id, node);
    }
    graph._edges = [...data.edges];
    return graph;
  }
}
