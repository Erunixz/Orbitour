// Visiting order for one day: the open path (no return to start) with the least
// total travel time. Brute force for small days, nearest neighbour plus 2-opt
// for bigger ones.

export type CostMatrix = number[][]

const BRUTE_FORCE_MAX = 8

export function pathCost(order: number[], cost: CostMatrix, start: number | null): number {
  let total = 0
  let prev = start
  for (const i of order) {
    if (prev !== null) total += cost[prev]![i]!
    prev = i
  }
  return total
}

function permutations(items: number[]): number[][] {
  if (items.length <= 1) return [items.slice()]
  const out: number[][] = []
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const perm of permutations(rest)) out.push([item, ...perm])
  })
  return out
}

function nearestNeighbour(nodes: number[], cost: CostMatrix, start: number | null): number[] {
  const left = new Set(nodes)
  const order: number[] = []
  let current = start
  if (current === null) {
    // Without a fixed start, begin at the node with the cheapest way out.
    current = nodes.reduce((best, n) => (rowMin(cost, n, nodes) < rowMin(cost, best, nodes) ? n : best), nodes[0]!)
    order.push(current)
    left.delete(current)
  }
  while (left.size > 0) {
    let best = -1
    for (const n of left) if (best === -1 || cost[current]![n]! < cost[current]![best]!) best = n
    order.push(best)
    left.delete(best)
    current = best
  }
  return order
}

function rowMin(cost: CostMatrix, n: number, nodes: number[]): number {
  let min = Infinity
  for (const m of nodes) if (m !== n) min = Math.min(min, cost[n]![m]!)
  return min
}

function twoOpt(order: number[], cost: CostMatrix, start: number | null): number[] {
  let best = order.slice()
  let bestCost = pathCost(best, cost, start)
  let improved = true
  while (improved) {
    improved = false
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const next = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)]
        const c = pathCost(next, cost, start)
        if (c < bestCost - 1e-9) {
          best = next
          bestCost = c
          improved = true
        }
      }
    }
  }
  return best
}

/**
 * Best order of `nodes` (indexes into `cost`). With `start`, the path begins
 * there (for example the hotel) without visiting it again.
 */
export function bestOrder(nodes: number[], cost: CostMatrix, start: number | null = null): number[] {
  if (nodes.length <= 2 && start === null) return nodes.slice()
  if (nodes.length <= BRUTE_FORCE_MAX) {
    let best = nodes.slice()
    let bestCost = Infinity
    for (const perm of permutations(nodes)) {
      const c = pathCost(perm, cost, start)
      if (c < bestCost) {
        best = perm
        bestCost = c
      }
    }
    return best
  }
  return twoOpt(nearestNeighbour(nodes, cost, start), cost, start)
}
