/**
 * Walking the campus graph.
 *
 * Plain Dijkstra with a binary heap. The graph is a few thousand nodes, which
 * is small enough that A* would buy nothing you could measure and cost a
 * heuristic to get wrong.
 */

export interface Graph {
  nodes: [number, number][];
  edges: [number, number, number][];
}

export interface Path {
  /** Weighted cost, which is metres for a footpath and more for a road. */
  cost: number;
  /** Actual ground distance in metres. */
  metres: number;
  nodes: number[];
}

class Heap {
  #items: [number, number][] = [];

  push(node: number, priority: number): void {
    this.#items.push([priority, node]);
    let i = this.#items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.#items[parent]![0] <= this.#items[i]![0]) break;
      [this.#items[parent], this.#items[i]] = [this.#items[i]!, this.#items[parent]!];
      i = parent;
    }
  }

  pop(): [number, number] | undefined {
    const top = this.#items[0];
    const last = this.#items.pop();
    if (this.#items.length && last) {
      this.#items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.#items.length && this.#items[left]![0] < this.#items[smallest]![0])
          smallest = left;
        if (right < this.#items.length && this.#items[right]![0] < this.#items[smallest]![0])
          smallest = right;
        if (smallest === i) break;
        [this.#items[smallest], this.#items[i]] = [this.#items[i]!, this.#items[smallest]!];
        i = smallest;
      }
    }
    return top;
  }

  get size(): number {
    return this.#items.length;
  }
}

/** Adjacency built once per map, since routing usually happens in batches. */
export function adjacencyOf(graph: Graph): Map<number, [number, number][]> {
  const adjacency = new Map<number, [number, number][]>();
  const add = (from: number, to: number, weight: number) => {
    const list = adjacency.get(from);
    if (list) list.push([to, weight]);
    else adjacency.set(from, [[to, weight]]);
  };
  for (const [a, b, weight] of graph.edges) {
    add(a, b, weight);
    add(b, a, weight);
  }
  return adjacency;
}

export function shortestPath(
  graph: Graph,
  from: number,
  to: number,
  adjacency = adjacencyOf(graph),
): Path | null {
  if (from === to) return { cost: 0, metres: 0, nodes: [from] };

  const distance = new Float64Array(graph.nodes.length).fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(graph.nodes.length).fill(-1);
  const settled = new Uint8Array(graph.nodes.length);
  const queue = new Heap();

  distance[from] = 0;
  queue.push(from, 0);

  while (queue.size) {
    const [cost, node] = queue.pop()!;
    if (settled[node]) continue;
    settled[node] = 1;
    if (node === to) break;
    for (const [next, weight] of adjacency.get(node) ?? []) {
      const candidate = cost + weight;
      if (candidate >= distance[next]!) continue;
      distance[next] = candidate;
      previous[next] = node;
      queue.push(next, candidate);
    }
  }

  if (!Number.isFinite(distance[to]!)) return null;

  const nodes: number[] = [];
  for (let at = to; at !== -1; at = previous[at]!) nodes.unshift(at);

  let metres = 0;
  for (let i = 1; i < nodes.length; i++) {
    const [ax, ay] = graph.nodes[nodes[i - 1]!]!;
    const [bx, by] = graph.nodes[nodes[i]!]!;
    metres += Math.hypot(bx - ax, by - ay);
  }

  return { cost: Math.round(distance[to]!), metres: Math.round(metres), nodes };
}
